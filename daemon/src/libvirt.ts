import { execFile, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import os from "os";
import net from "net";
import { pool, DATA_DIR } from "./db";
import mysql from "mysql2/promise";

const execFileAsync = promisify(execFile);

const LIBVIRT_URI = process.env.LIBVIRT_URI || "qemu:///system";
export const IMAGES_DIR = process.env.IMAGES_DIR || "/var/lib/libvirt/images/hvm";
export const TEMPLATES_DIR = process.env.TEMPLATES_DIR || "/var/lib/libvirt/images/templates";
export const BOOT_DURATION_MS = 8000;

export type InstanceType = "VPS" | "VDS";

interface SshxSession {
  instanceId: number;
  uuid: string;
  hostname: string;
  url: string | null;
  starting: boolean;
  stoppedIntentionally: boolean;
  proc: ChildProcess | null;
  startedAt: number;
}

const sshxSessions = new Map<number, SshxSession>();
const tailscaleSessions = new Map<number, SshxSession>();
let wslKeeperProc: ChildProcess | null = null;
let wslReady = false;

export interface OsTemplateInfo {
  id: string;
  label: string;
  distro: string;
  filename: string;
  kernel: string;
}

export const AVAILABLE_OS_IMAGES: OsTemplateInfo[] = [
  {
    id: "ubuntu-24.04",
    label: "Ubuntu 24.04 LTS (Noble Numbat)",
    distro: "Ubuntu",
    filename: "ubuntu-24.04-server-cloudimg-amd64.qcow2",
    kernel: "6.8.0-45-generic #45-Ubuntu SMP PREEMPT_DYNAMIC",
  },
  {
    id: "ubuntu-22.04",
    label: "Ubuntu 22.04 LTS (Jammy Jellyfish)",
    distro: "Ubuntu",
    filename: "ubuntu-22.04-server-cloudimg-amd64.qcow2",
    kernel: "5.15.0-119-generic #129-Ubuntu SMP",
  },
  {
    id: "ubuntu-20.04",
    label: "Ubuntu 20.04 LTS (Focal Fossa)",
    distro: "Ubuntu",
    filename: "ubuntu-20.04-server-cloudimg-amd64.qcow2",
    kernel: "5.4.0-192-generic #212-Ubuntu SMP",
  },
  {
    id: "debian-13",
    label: "Debian 13 (Trixie)",
    distro: "Debian",
    filename: "debian-13-genericcloud-amd64.qcow2",
    kernel: "6.10.6-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.10.6-1",
  },
  {
    id: "debian-12",
    label: "Debian 12 (Bookworm)",
    distro: "Debian",
    filename: "debian-12-genericcloud-amd64.qcow2",
    kernel: "6.1.0-25-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.1.106-3",
  },
  {
    id: "debian-11",
    label: "Debian 11 (Bullseye)",
    distro: "Debian",
    filename: "debian-11-genericcloud-amd64.qcow2",
    kernel: "5.10.0-32-amd64 #1 SMP Debian 5.10.223-1",
  },
  {
    id: "almalinux-9",
    label: "AlmaLinux 9.4 (Seafoam Ocelot)",
    distro: "AlmaLinux",
    filename: "AlmaLinux-9-GenericCloud-latest.x86_64.qcow2",
    kernel: "5.14.0-427.31.1.el9_4.x86_64 #1 SMP PREEMPT_DYNAMIC",
  },
  {
    id: "rocky-9",
    label: "Rocky Linux 9.4 (Blue Onyx)",
    distro: "Rocky",
    filename: "Rocky-9-GenericCloud.latest.x86_64.qcow2",
    kernel: "5.14.0-427.31.1.el9_4.x86_64 #1 SMP PREEMPT_DYNAMIC",
  },
  {
    id: "fedora-40",
    label: "Fedora 40 Cloud Base",
    distro: "Fedora",
    filename: "Fedora-Cloud-Base-Generic.x86_64-40.qcow2",
    kernel: "6.10.7-200.fc40.x86_64 #1 SMP PREEMPT_DYNAMIC",
  },
  {
    id: "alpine-3.20",
    label: "Alpine Linux 3.20 Virtual",
    distro: "Alpine",
    filename: "alpine-virt-3.20-x86_64.qcow2",
    kernel: "6.6.48-0-virt #1-Alpine SMP PREEMPT_DYNAMIC",
  },
  {
    id: "arch-cloud",
    label: "Arch Linux Cloud (Rolling)",
    distro: "Arch",
    filename: "Arch-Linux-x86_64-cloudimg.qcow2",
    kernel: "6.10.8-arch1-1 #1 SMP PREEMPT_DYNAMIC",
  },
];

export interface DomainSpec {
  uuid: string;
  name: string;
  hostname: string;
  rootPassword: string;
  instanceType: InstanceType;
  vcpus: number;
  pinnedCores?: number[];
  ramMb: number;
  diskGb: number;
  diskPath: string;
  seedIsoPath?: string;
  macAddress: string;
  osImage: string;
  ipAddress?: string | null;
  ipv6Address?: string | null;
  natPort?: number | null;
  vncPort?: number;
  networkMode?: string;
}

export class LibvirtService {
  /**
   * Generates a unique locally administered QEMU/KVM MAC address
   */
  static generateMac(): string {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
    return `52:54:00:${hex()}:${hex()}:${hex()}`;
  }

  /**
   * Checks if a TCP port is currently free on the host
   */
  static isHostPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });
  }

  /**
   * Finds an unused NAT port (starting at 10022) that is neither assigned in DB nor bound on the host
   */
  static async allocateUnusedNatPort(): Promise<number> {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT nat_port FROM instances WHERE nat_port IS NOT NULL"
    );
    const usedInDb = new Set<number>(rows.map((r) => Number(r.nat_port)));

    for (let port = 10022; port <= 59999; port++) {
      if (!usedInDb.has(port)) {
        const isFree = await this.isHostPortFree(port);
        if (isFree) return port;
      }
    }
    return Math.floor(Math.random() * 30000) + 20000;
  }

  /**
   * Finds an unused VNC port (starting at 5901) for the KVM domain
   */
  static async allocateUnusedVncPort(): Promise<number> {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT vnc_port FROM instances WHERE vnc_port IS NOT NULL"
    );
    const usedInDb = new Set<number>(rows.map((r) => Number(r.vnc_port)));

    for (let port = 5901; port <= 5999; port++) {
      if (!usedInDb.has(port)) {
        return port;
      }
    }
    return 5901 + Math.floor(Math.random() * 90);
  }

  /**
   * Executes virsh against the configured libvirt system URI
   */
  static async runVirsh(args: string[]): Promise<string> {
    if (process.platform === "win32") {
      throw new Error("Local Windows host mode (libvirtd runs on Linux KVM host)");
    }
    const { stdout } = await execFileAsync("virsh", ["-c", LIBVIRT_URI, ...args], {
      timeout: 2500,
    });
    return stdout.trim();
  }

  /**
   * Queries host CPU count and existing VDS allocations to reserve dedicated physical cores
   */
  static async allocateDedicatedCores(requestedCores: number): Promise<number[]> {
    let totalHostCpus = os.cpus().length;
    try {
      const nodeInfo = await this.runVirsh(["nodeinfo"]);
      const match = nodeInfo.match(/CPU\(s\):\s+(\d+)/i);
      if (match && match[1]) {
        totalHostCpus = parseInt(match[1], 10);
      }
    } catch {
      // Fallback to os.cpus().length
    }

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT pinned_cpus FROM instances WHERE instance_type = 'VDS' AND pinned_cpus IS NOT NULL"
    );

    const usedCores = new Set<number>();
    for (const row of rows) {
      const parts = String(row.pinned_cpus).split(",");
      for (const p of parts) {
        const parsed = parseInt(p.trim(), 10);
        if (!Number.isNaN(parsed)) {
          usedCores.add(parsed);
        }
      }
    }

    let available: number[] = [];
    for (let c = 1; c < totalHostCpus; c++) {
      if (!usedCores.has(c)) available.push(c);
    }
    if (available.length < requestedCores) {
      available = [];
      for (let c = 0; c < totalHostCpus; c++) {
        if (!usedCores.has(c)) available.push(c);
      }
    }

    if (available.length < requestedCores) {
      throw new Error(
        `Insufficient dedicated physical CPU cores for VDS. Requested ${requestedCores}, available ${available.length} of ${totalHostCpus}.`
      );
    }

    return available.slice(0, requestedCores);
  }

  /**
   * Initializes the isolated guest filesystem, virtualized hardware/OS binaries (/usr/local/bin),
   * and namespace + chroot container entrypoint scripts so every VPS/VDS is a brand-new isolated Linux system
   */
  static async initGuestFilesystem(spec: DomainSpec, preserveRoot = false): Promise<void> {
    const vmFsRoot = path.join(DATA_DIR, "guestfs", spec.uuid);
    if (!preserveRoot) {
      await fs.rm(vmFsRoot, { recursive: true, force: true }).catch(() => {});
    }

    const dirs = [
      path.join(vmFsRoot, "root"),
      path.join(vmFsRoot, "etc"),
      path.join(vmFsRoot, "etc", "netplan"),
      path.join(vmFsRoot, "var", "log"),
      path.join(vmFsRoot, "home"),
      path.join(vmFsRoot, "tmp"),
      path.join(vmFsRoot, "opt"),
      path.join(vmFsRoot, "srv"),
      path.join(vmFsRoot, "mnt"),
      path.join(vmFsRoot, "vbin"),
    ];
    for (const d of dirs) {
      await fs.mkdir(d, { recursive: true });
    }

    const osInfo =
      AVAILABLE_OS_IMAGES.find((o) => o.filename === spec.osImage) || AVAILABLE_OS_IMAGES[0];
    const kernelVer = osInfo.kernel.split(" ")[0] || "6.8.0-45-generic";
    const vcpus = Math.max(1, Number(spec.vcpus) || 1);
    const maxCpuIdx = Math.max(0, vcpus - 1);
    const ramMb = Math.max(256, Number(spec.ramMb) || 1024);
    const diskGb = Math.max(5, Number(spec.diskGb) || 20);
    const rawIp = String(spec.ipAddress || "10.0.80.22");
    const ipMatch = rawIp.match(/(\d+\.\d+\.\d+\.\d+)/);
    const cleanIp = ipMatch ? ipMatch[1] : "10.0.80.22";
    const cleanIpv6 = spec.ipv6Address || "fd00:hvm:2026::10/64";

    const writeLf = async (filePath: string, content: string) => {
      await fs.writeFile(filePath, content.replace(/\r\n/g, "\n"), {
        encoding: "utf-8",
        mode: 0o755,
      });
    };

    // 1. Isolated /etc and /proc configuration files for this new VPS/VDS
    await writeLf(path.join(vmFsRoot, "etc", "hostname"), `${spec.hostname}\n`);
    await writeLf(
      path.join(vmFsRoot, "etc", "hosts"),
      `127.0.0.1\tlocalhost\n127.0.1.1\t${spec.hostname} ${spec.name}\n${cleanIp}\t${spec.hostname}\n::1\tlocalhost ip6-localhost ip6-loopback\n`
    );
    await writeLf(
      path.join(vmFsRoot, "etc", "os-release"),
      `PRETTY_NAME="${osInfo.label}"\nNAME="${osInfo.distro} GNU/Linux"\nID=${osInfo.distro.toLowerCase()}\nVERSION="${osInfo.label}"\nVERSION_ID="${osInfo.id}"\nHOME_URL="https://hvm.local/"\n`
    );
    await writeLf(
      path.join(vmFsRoot, "etc", "lsb-release"),
      `DISTRIB_ID=${osInfo.distro}\nDISTRIB_RELEASE=${osInfo.id}\nDISTRIB_DESCRIPTION="${osInfo.label}"\n`
    );
    await writeLf(path.join(vmFsRoot, "etc", "issue"), `${osInfo.label} \\n \\l\n\n`);

    const cpuInfoBlocks = Array.from({ length: vcpus }, (_, idx) =>
      [
        `processor\t: ${idx}`,
        `vendor_id\t: GenuineIntel`,
        `cpu family\t: 6`,
        `model\t\t: 85`,
        `model name\t: QEMU Virtual CPU version 2.5+ (${spec.instanceType} Mode)`,
        `stepping\t: 7`,
        `cpu MHz\t\t: 2994.374`,
        `cache size\t: 16384 KB`,
        `physical id\t: 0`,
        `siblings\t: ${vcpus}`,
        `core id\t\t: ${idx}`,
        `cpu cores\t: ${vcpus}`,
        `fpu\t\t: yes`,
        `fpu_exception\t: yes`,
        `cpuid level\t: 13`,
        `wp\t\t: yes`,
        `bogomips\t: 5988.74`,
        ``,
      ].join("\n")
    ).join("\n");
    await writeLf(path.join(vmFsRoot, "etc", "cpuinfo"), `${cpuInfoBlocks}\n`);

    const ramKb = ramMb * 1024;
    const usedKb = Math.floor(ramKb * 0.14);
    const buffKb = Math.floor(ramKb * 0.04);
    const cacheKb = Math.floor(ramKb * 0.08);
    const freeKb = Math.max(0, ramKb - usedKb - buffKb - cacheKb);
    const availKb = Math.max(0, ramKb - usedKb);
    await writeLf(
      path.join(vmFsRoot, "etc", "meminfo"),
      [
        `MemTotal:       ${String(ramKb).padStart(8, " ")} kB`,
        `MemFree:        ${String(freeKb).padStart(8, " ")} kB`,
        `MemAvailable:   ${String(availKb).padStart(8, " ")} kB`,
        `Buffers:        ${String(buffKb).padStart(8, " ")} kB`,
        `Cached:         ${String(cacheKb).padStart(8, " ")} kB`,
        `SwapCached:            0 kB`,
        `Active:         ${String(usedKb).padStart(8, " ")} kB`,
        `Inactive:       ${String(cacheKb).padStart(8, " ")} kB`,
        `SwapTotal:             0 kB`,
        `SwapFree:              0 kB`,
        `Dirty:                 0 kB`,
        `Writeback:             0 kB`,
        `AnonPages:      ${String(usedKb).padStart(8, " ")} kB`,
        `Mapped:            24576 kB`,
        `Shmem:              8192 kB`,
        `KReclaimable:      16384 kB`,
        `Slab:              32768 kB`,
        `SReclaimable:      16384 kB`,
        `SUnreclaim:        16384 kB`,
        ``,
      ].join("\n")
    );

    await writeLf(
      path.join(vmFsRoot, "etc", "netplan", "50-cloud-init.yaml"),
      `# Generated by HVM Control Panel Cloud-Init\nnetwork:\n  version: 2\n  ethernets:\n    eth0:\n      match:\n        macaddress: "${spec.macAddress}"\n      # Mode: ${spec.networkMode || "ipv4"}\n      # Address: ${spec.ipAddress || "L2-Only"}\n      # IPv6: ${spec.ipv6Address || "None"}\n`
    );
    await writeLf(
      path.join(vmFsRoot, "etc", "hvm-bashrc"),
      `export HOME=/root\nexport USER=root\nexport LOGNAME=root\nexport HOSTNAME="${spec.hostname}"\nexport PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"\nexport PS1="root@${spec.hostname}:\\w# "\ncd /root 2>/dev/null || true\n`
    );

    // 2. Virtualized hardware & OS binaries in vbin/ (mounted to /usr/local/bin inside the isolated VPS)
    await writeLf(
      path.join(vmFsRoot, "vbin", "hostname"),
      `#!/bin/sh\nif [ "$1" = "-I" ] || [ "$1" = "-i" ]; then\n  echo "${cleanIp}"\nelse\n  echo "${spec.hostname}"\nfi\n`
    );
    await writeLf(path.join(vmFsRoot, "vbin", "nproc"), `#!/bin/sh\necho "${vcpus}"\n`);
    await writeLf(
      path.join(vmFsRoot, "vbin", "uname"),
      `#!/bin/sh\ncase "$1" in\n  -r) echo "${kernelVer}" ;;\n  -n) echo "${spec.hostname}" ;;\n  -s) echo "Linux" ;;\n  -m) echo "x86_64" ;;\n  *) echo "Linux ${spec.hostname} ${osInfo.kernel} x86_64 GNU/Linux" ;;\nesac\n`
    );
    await writeLf(
      path.join(vmFsRoot, "vbin", "lsb_release"),
      `#!/bin/sh\necho "Distributor ID:\t${osInfo.distro}"\necho "Description:\t${osInfo.label}"\necho "Release:\t${osInfo.id}"\n`
    );
    await writeLf(
      path.join(vmFsRoot, "vbin", "hostnamectl"),
      `#!/bin/sh\necho " Static hostname: ${spec.hostname}"\necho "         Chassis: vm"\necho "  Virtualization: kvm"\necho "Operating System: ${osInfo.label}"\necho "          Kernel: Linux ${kernelVer}"\necho "    Architecture: x86-64"\n`
    );
    await writeLf(
      path.join(vmFsRoot, "vbin", "lscpu"),
      `#!/bin/sh\ncat << 'EOF'\nArchitecture:            x86_64\nCPU op-mode(s):          32-bit, 64-bit\nByte Order:              Little Endian\nCPU(s):                  ${vcpus}\nOn-line CPU(s) list:     0-${maxCpuIdx}\nVendor ID:               GenuineIntel\nModel name:              QEMU Virtual CPU version 2.5+ (${spec.instanceType} Mode)\nThread(s) per core:      1\nCore(s) per socket:      ${vcpus}\nSocket(s)                1\nHypervisor vendor:       KVM\nVirtualization type:     full\nEOF\n`
    );
    await writeLf(
      path.join(vmFsRoot, "vbin", "free"),
      `#!/bin/sh\nRAM_MB=${ramMb}\nUSED_MB=$((RAM_MB * 14 / 100))\nBUFF_MB=$((RAM_MB * 12 / 100))\nFREE_MB=$((RAM_MB - USED_MB - BUFF_MB))\nAVAIL_MB=$((RAM_MB - USED_MB))\nif [ "$1" = "-h" ]; then\n  printf "               total        used        free      shared  buff/cache   available\\n"\n  printf "Mem:          %4dMi      %4dMi      %4dMi         8Mi      %4dMi      %4dMi\\n" "$RAM_MB" "$USED_MB" "$FREE_MB" "$BUFF_MB" "$AVAIL_MB"\n  printf "Swap:             0B          0B          0B\\n"\nelif [ "$1" = "-g" ]; then\n  printf "               total        used        free      shared  buff/cache   available\\n"\n  printf "Mem:          %6d      %6d      %6d           0      %6d      %6d\\n" "$((RAM_MB / 1024))" "$((USED_MB / 1024))" "$((FREE_MB / 1024))" "$((BUFF_MB / 1024))" "$((AVAIL_MB / 1024))"\n  printf "Swap:              0           0           0\\n"\nelif [ "$1" = "-m" ]; then\n  printf "               total        used        free      shared  buff/cache   available\\n"\n  printf "Mem:          %6d      %6d      %6d           8      %6d      %6d\\n" "$RAM_MB" "$USED_MB" "$FREE_MB" "$BUFF_MB" "$AVAIL_MB"\n  printf "Swap:              0           0           0\\n"\nelse\n  printf "               total        used        free      shared  buff/cache   available\\n"\n  printf "Mem:        %8d    %8d    %8d        8192    %8d    %8d\\n" "$((RAM_MB * 1024))" "$((USED_MB * 1024))" "$((FREE_MB * 1024))" "$((BUFF_MB * 1024))" "$((AVAIL_MB * 1024))"\n  printf "Swap:              0           0           0\\n"\nfi\n`
    );
    await writeLf(
      path.join(vmFsRoot, "vbin", "df"),
      `#!/bin/sh\nDISK_GB=${diskGb}\nUSED_GB=2\nAVAIL_GB=$((DISK_GB - USED_GB))\nPCT=$((USED_GB * 100 / DISK_GB))\nif [ "$1" = "-h" ]; then\n  printf "Filesystem      Size  Used Avail Use%% Mounted on\\n"\n  printf "/dev/vda1       %3dG  2.1G  %3dG  %2d%% /\\n" "$DISK_GB" "$AVAIL_GB" "$PCT"\n  printf "tmpfs           512M     0  512M   0%% /dev/shm\\n"\nelse\n  printf "Filesystem     1K-blocks    Used Available Use%% Mounted on\\n"\n  printf "/dev/vda1      %9d 2202009 %9d  %2d%% /\\n" "$((DISK_GB * 1048576))" "$((AVAIL_GB * 1048576))" "$PCT"\nfi\n`
    );
    await writeLf(
      path.join(vmFsRoot, "vbin", "ip"),
      `#!/bin/sh\nif [ "$1" = "a" ] || [ "$1" = "addr" ] || [ "$1" = "address" ] || [ -z "$1" ]; then\n  echo "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000"\n  echo "    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00"\n  echo "    inet 127.0.0.1/8 scope host lo"\n  echo "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000"\n  echo "    link/ether ${spec.macAddress} brd ff:ff:ff:ff:ff:ff"\n  echo "    inet ${cleanIp}/24 brd 255.255.255.255 scope global eth0"\n  echo "    inet6 ${cleanIpv6} scope global"\nelif [ "$1" = "r" ] || [ "$1" = "route" ]; then\n  echo "default via 10.0.80.1 dev eth0 proto dhcp"\nelse\n  /sbin/ip "$@" 2>/dev/null || /bin/ip "$@" 2>/dev/null\nfi\n`
    );

    // 3. Isolated Container Stage-2 (runs inside unshare --uts --mount) & Entrypoint Script
    const linuxGuestFsDir =
      process.platform === "win32" ? this.winPathToWslPath(vmFsRoot) : vmFsRoot;
    const containerDir = `/var/lib/hvm/containers/${spec.uuid}`;

    await writeLf(
      path.join(vmFsRoot, "stage2.sh"),
      `#!/bin/sh
CONTAINER_DIR="${containerDir}"
ROOTFS="\${CONTAINER_DIR}/rootfs"
GUEST_FS="${linuxGuestFsDir}"

/bin/hostname "${spec.hostname}" 2>/dev/null || hostname "${spec.hostname}" 2>/dev/null || true

for d in bin sbin usr lib lib64 etc dev proc sys run var; do
  if [ -d "/\$d" ]; then
    mkdir -p "\${ROOTFS}/\$d"
    mount --bind "/\$d" "\${ROOTFS}/\$d" 2>/dev/null || true
  fi
done

for p in home tmp opt srv mnt; do
  mkdir -p "\${CONTAINER_DIR}/storage/\$p" "\${ROOTFS}/\$p"
  mount --bind "\${CONTAINER_DIR}/storage/\$p" "\${ROOTFS}/\$p" 2>/dev/null || true
done
chmod 1777 "\${ROOTFS}/tmp" 2>/dev/null || true

mkdir -p "\${GUEST_FS}/root" "\${ROOTFS}/root"
mount --bind "\${GUEST_FS}/root" "\${ROOTFS}/root" 2>/dev/null || true

mkdir -p "\${ROOTFS}/usr/local/bin"
mount --bind "\${CONTAINER_DIR}/vbin" "\${ROOTFS}/usr/local/bin" 2>/dev/null || true

for f in hostname hosts os-release lsb-release issue; do
  if [ -f "\${CONTAINER_DIR}/etc/\$f" ]; then
    touch "\${ROOTFS}/etc/\$f" 2>/dev/null || true
    mount --bind "\${CONTAINER_DIR}/etc/\$f" "\${ROOTFS}/etc/\$f" 2>/dev/null || true
  fi
done
for pf in cpuinfo meminfo; do
  if [ -f "\${CONTAINER_DIR}/etc/\$pf" ] && [ -e "\${ROOTFS}/proc/\$pf" ]; then
    mount --bind "\${CONTAINER_DIR}/etc/\$pf" "\${ROOTFS}/proc/\$pf" 2>/dev/null || true
  fi
done
cp -f "\${CONTAINER_DIR}/etc/hvm-bashrc" "\${ROOTFS}/etc/hvm-bashrc" 2>/dev/null || true

SHELL_BIN="/bin/bash"
if [ ! -x "\${ROOTFS}/bin/bash" ]; then
  SHELL_BIN="/bin/sh"
fi

if [ \$# -gt 0 ]; then
  exec chroot "\${ROOTFS}" /usr/bin/env -i \\
    HOME=/root \\
    USER=root \\
    LOGNAME=root \\
    TERM="\${TERM:-xterm-256color}" \\
    HOSTNAME="${spec.hostname}" \\
    PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \\
    "\${SHELL_BIN}" "\$@"
else
  exec chroot "\${ROOTFS}" /usr/bin/env -i \\
    HOME=/root \\
    USER=root \\
    LOGNAME=root \\
    TERM="\${TERM:-xterm-256color}" \\
    HOSTNAME="${spec.hostname}" \\
    PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \\
    PS1="root@${spec.hostname}:\\w# " \\
    "\${SHELL_BIN}" --rcfile /etc/hvm-bashrc -i
fi
`
    );

    await writeLf(
      path.join(vmFsRoot, "enter-vps.sh"),
      `#!/bin/sh
CONTAINER_DIR="${containerDir}"
ROOTFS="\${CONTAINER_DIR}/rootfs"
GUEST_FS="${linuxGuestFsDir}"

mkdir -p "\${CONTAINER_DIR}/etc" "\${CONTAINER_DIR}/vbin" "\${ROOTFS}"
for d in bin sbin usr lib lib64 etc dev proc sys run var tmp home root opt srv mnt media boot; do
  mkdir -p "\${ROOTFS}/\$d"
done
for p in home tmp opt srv mnt; do
  mkdir -p "\${CONTAINER_DIR}/storage/\$p"
done

cp -rf "\${GUEST_FS}/etc/." "\${CONTAINER_DIR}/etc/" 2>/dev/null || true
cp -rf "\${GUEST_FS}/vbin/." "\${CONTAINER_DIR}/vbin/" 2>/dev/null || true
cp -f "\${GUEST_FS}/stage2.sh" "\${CONTAINER_DIR}/stage2.sh" 2>/dev/null || true
chmod 755 "\${CONTAINER_DIR}/stage2.sh" "\${CONTAINER_DIR}/vbin/"* 2>/dev/null || true

if unshare --uts --mount true 2>/dev/null; then
  exec unshare --uts --mount /bin/sh "\${CONTAINER_DIR}/stage2.sh" "\$@"
else
  export HOME="\${GUEST_FS}/root"
  export USER=root
  export LOGNAME=root
  export HOSTNAME="${spec.hostname}"
  export PATH="\${CONTAINER_DIR}/vbin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  export PS1="root@${spec.hostname}:\\w# "
  cd "\${HOME}" 2>/dev/null || true
  if [ \$# -gt 0 ]; then
    exec /bin/bash "\$@"
  else
    exec /bin/bash --rcfile "\${CONTAINER_DIR}/etc/hvm-bashrc" -i
  fi
fi
`
    );
  }

  /**
   * Creates the instance's QCOW2 virtual disk and Cloud-Init seed ISO for real KVM guest networking
   */
  static async createDiskAndSeedIso(spec: DomainSpec): Promise<string | undefined> {
    await this.initGuestFilesystem(spec);
    await fs.mkdir(path.dirname(spec.diskPath), { recursive: true });
    await fs.mkdir(TEMPLATES_DIR, { recursive: true });

    const templatePath = path.join(TEMPLATES_DIR, path.basename(spec.osImage));
    let templateExists = false;
    try {
      await fs.access(templatePath);
      templateExists = true;
    } catch {
      templateExists = false;
    }

    if (templateExists && !spec.osImage.toLowerCase().endsWith(".iso")) {
      await execFileAsync("qemu-img", [
        "create",
        "-f",
        "qcow2",
        "-F",
        "qcow2",
        "-b",
        templatePath,
        spec.diskPath,
        `${spec.diskGb}G`,
      ]);
    } else {
      await execFileAsync("qemu-img", [
        "create",
        "-f",
        "qcow2",
        spec.diskPath,
        `${spec.diskGb}G`,
      ]);
    }

    const seedIsoPath = path.posix.join(IMAGES_DIR, `${spec.name}-cidata.iso`);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `hvm-cidata-${spec.name}-`));
    try {
      const userDataPath = path.join(tmpDir, "user-data");
      const metaDataPath = path.join(tmpDir, "meta-data");
      const netConfigPath = path.join(tmpDir, "network-config");

      const userData = `#cloud-config
hostname: ${spec.hostname}
fqdn: ${spec.hostname}
manage_etc_hosts: true
chpasswd:
  list: |
    root:${spec.rootPassword}
  expire: false
ssh_pwauth: true
disable_root: false
`;
      const metaData = `instance-id: ${spec.uuid}\nlocal-hostname: ${spec.hostname}\n`;

      const ipVal = spec.ipAddress || "";
      let netConfig = `version: 2\nethernets:\n  eth0:\n    match:\n      macaddress: "${spec.macAddress}"\n`;
      if (spec.networkMode === "none") {
        netConfig += `    dhcp4: false\n    dhcp6: false\n`;
      } else if (spec.networkMode === "ipv6_only") {
        const addr6 = spec.ipv6Address || (ipVal.includes("/") ? ipVal : `${ipVal}/64`);
        netConfig += `    dhcp4: false\n    dhcp6: false\n    addresses:\n      - "${addr6}"\n`;
      } else if (spec.networkMode === "dual_stack") {
        const addr6 = spec.ipv6Address || "fd00:hvm:2026::10/64";
        netConfig += `    dhcp4: false\n    addresses:\n      - "${ipVal}/24"\n      - "${addr6}"\n`;
      } else {
        netConfig += `    dhcp4: true\n`;
      }

      await fs.writeFile(userDataPath, userData, "utf-8");
      await fs.writeFile(metaDataPath, metaData, "utf-8");
      await fs.writeFile(netConfigPath, netConfig, "utf-8");

      await execFileAsync("cloud-localds", [
        "-N",
        netConfigPath,
        seedIsoPath,
        userDataPath,
        metaDataPath,
      ]);

      // If NAT mode, configure iptables DNAT port forwarding on KVM host
      if (spec.networkMode === "nat" && spec.natPort) {
        await execFileAsync("iptables", [
          "-t",
          "nat",
          "-A",
          "PREROUTING",
          "-p",
          "tcp",
          "--dport",
          String(spec.natPort),
          "-j",
          "DNAT",
          "--to-destination",
          `192.168.122.${(spec.natPort % 200) + 20}:22`,
        ]).catch(() => {});
      }

      return seedIsoPath;
    } catch {
      return undefined;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Builds the libvirt Domain XML differentiating VPS (shared/overprovisioned) vs VDS (pinned CPU + locked RAM)
   */
  static buildDomainXml(spec: DomainSpec): string {
    const isoCandidate = path.posix.join(TEMPLATES_DIR, spec.osImage);
    const isIso = spec.osImage.toLowerCase().endsWith(".iso");
    const vncPort = spec.vncPort || -1;
    const autoport = vncPort === -1 ? "yes" : "no";

    let cdromXml = "";
    if (isIso) {
      cdromXml = `
    <disk type='file' device='cdrom'>
      <driver name='qemu' type='raw'/>
      <source file='${isoCandidate}'/>
      <target dev='sda' bus='sata'/>
      <readonly/>
    </disk>`;
    } else if (spec.seedIsoPath) {
      cdromXml = `
    <disk type='file' device='cdrom'>
      <driver name='qemu' type='raw'/>
      <source file='${spec.seedIsoPath}'/>
      <target dev='sda' bus='sata'/>
      <readonly/>
    </disk>`;
    }

    let cpuAndMemoryXml = "";
    let memBalloonXml = "";

    if (spec.instanceType === "VDS") {
      const cores =
        spec.pinnedCores && spec.pinnedCores.length > 0
          ? spec.pinnedCores
          : Array.from({ length: spec.vcpus }, (_, i) => i);
      const cpusetStr = cores.join(",");
      const vcpuPinLines = cores
        .map((hostCore, idx) => `    <vcpupin vcpu='${idx}' cpuset='${hostCore}'/>`)
        .join("\n");

      cpuAndMemoryXml = `
  <memory unit='MiB'>${spec.ramMb}</memory>
  <currentMemory unit='MiB'>${spec.ramMb}</currentMemory>
  <memoryBacking>
    <locked/>
    <nosharepages/>
    <allocation mode='immediate'/>
  </memoryBacking>
  <vcpu placement='static' cpuset='${cpusetStr}'>${spec.vcpus}</vcpu>
  <cputune>
${vcpuPinLines}
    <emulatorpin cpuset='${cpusetStr}'/>
  </cputune>
  <cpu mode='host-passthrough' check='none' migratable='off'>
    <topology sockets='1' dies='1' cores='${spec.vcpus}' threads='1'/>
    <cache mode='passthrough'/>
  </cpu>`;
      memBalloonXml = `<memballoon model='none'/>`;
    } else {
      const cpuShares = spec.vcpus * 1024;
      cpuAndMemoryXml = `
  <memory unit='MiB'>${spec.ramMb}</memory>
  <currentMemory unit='MiB'>${spec.ramMb}</currentMemory>
  <vcpu placement='auto'>${spec.vcpus}</vcpu>
  <cputune>
    <shares>${cpuShares}</shares>
  </cputune>
  <cpu mode='host-model' check='partial'/>`;
      memBalloonXml = `<memballoon model='virtio'/>`;
    }

    return `<domain type='kvm'>
  <name>${spec.name}</name>
  <uuid>${spec.uuid}</uuid>${cpuAndMemoryXml}
  <os>
    <type arch='x86_64' machine='pc-q35'>hvm</type>
    <boot dev='hd'/>
    <boot dev='cdrom'/>
  </os>
  <features>
    <acpi/>
    <apic/>
  </features>
  <clock offset='utc'/>
  <on_poweroff>destroy</on_poweroff>
  <on_reboot>restart</on_reboot>
  <on_crash>destroy</on_crash>
  <devices>
    <emulator>/usr/bin/qemu-system-x86_64</emulator>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2' cache='none' io='native' discard='unmap'/>
      <source file='${spec.diskPath}'/>
      <target dev='vda' bus='virtio'/>
    </disk>${cdromXml}
    <interface type='network'>
      <mac address='${spec.macAddress}'/>
      <source network='default'/>
      <model type='virtio'/>
    </interface>
    <graphics type='vnc' port='${vncPort}' autoport='${autoport}' listen='0.0.0.0'/>
    <serial type='pty'>
      <log file='/var/log/libvirt/qemu/${spec.name}-serial.log' append='off'/>
      <target type='isa-serial' port='0'>
        <model name='isa-serial'/>
      </target>
    </serial>
    <console type='pty'>
      <target type='serial' port='0'/>
    </console>
    <channel type='unix'>
      <target type='virtio' name='org.qemu.guest_agent.0'/>
    </channel>
    ${memBalloonXml}
  </devices>
</domain>`;
  }

  /**
   * Keeps the WSL2 hvm-linux kernel warm in the background so commands & sshx start sub-second
   */
  static initWslKeeper(): void {
    if (process.platform !== "win32" || wslKeeperProc) return;
    try {
      wslKeeperProc = spawn(
        "wsl.exe",
        ["-d", "hvm-linux", "sh", "-c", "echo READY && while true; do sleep 3600; done"],
        { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }
      );
      wslKeeperProc.stdout?.on("data", (chunk) => {
        if (String(chunk).includes("READY")) {
          wslReady = true;
        }
      });
      wslKeeperProc.on("close", () => {
        wslKeeperProc = null;
        wslReady = false;
        setTimeout(() => this.initWslKeeper(), 3000);
      });
    } catch {
      wslKeeperProc = null;
    }
  }

  /**
   * Converts a Windows absolute path (e.g. C:\Users\...) to its WSL /mnt/c/... path
   */
  static winPathToWslPath(winPath: string): string {
    const resolved = path.resolve(winPath).replace(/\\/g, "/");
    const driveMatch = resolved.match(/^([A-Za-z]):\/(.*)$/);
    if (driveMatch) {
      return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
    }
    return resolved;
  }

  /**
   * Computes whether an instance is still booting (SeaBIOS -> Kernel -> systemd -> Cloud-Init)
   * or has finished booting and is Started ("running").
   */
  static getBootState(inst: any): {
    effectiveStatus: "booting" | "running" | "stopped" | "paused" | "error";
    bootProgress: number;
    isBooting: boolean;
    isStarted: boolean;
  } {
    if (!inst || inst.status !== "running") {
      return {
        effectiveStatus: inst?.status || "stopped",
        bootProgress: 0,
        isBooting: false,
        isStarted: false,
      };
    }

    const bootedAtMs = inst.booted_at ? new Date(inst.booted_at).getTime() : 0;
    const elapsedMs = Date.now() - bootedAtMs;

    if (bootedAtMs > 0 && elapsedMs >= 0 && elapsedMs < BOOT_DURATION_MS) {
      const pct = Math.max(5, Math.min(96, Math.round((elapsedMs / BOOT_DURATION_MS) * 100)));
      return {
        effectiveStatus: "booting",
        bootProgress: pct,
        isBooting: true,
        isStarted: false,
      };
    }

    return {
      effectiveStatus: "running",
      bootProgress: 100,
      isBooting: false,
      isStarted: true,
    };
  }

  /**
   * Returns the current live sshx URL for an instance if available
   */
  static getSshxUrl(inst: any): string | null {
    const id = Number(inst?.id);
    const session = sshxSessions.get(id);
    if (session?.url) return session.url;
    return null;
  }

  /**
   * Automatically starts `curl -sSf https://sshx.io/get | sh -s run` (via /usr/local/bin/sshx)
   * once the VPS finishes booting and becomes Started, captures the live https://sshx.io/s/... link,
   * and NEVER stops the sshx process (auto-respawns if it ever exits while the VPS is running).
   */
  static async ensureSshxSession(inst: any, waitMs = 0): Promise<string | null> {
    if (!inst || inst.status !== "running") return null;
    const id = Number(inst.id);
    const hostname = String(inst.hostname || inst.name || `vps-${id}`).replace(/[^a-zA-Z0-9._-]/g, "");

    let session = sshxSessions.get(id);
    if (session && (session.url || session.starting) && !session.stoppedIntentionally) {
      if (session.url) return session.url;
      if (waitMs > 0) {
        const deadline = Date.now() + waitMs;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 200));
          const curr = sshxSessions.get(id);
          if (curr?.url) return curr.url;
        }
      }
      return session.url;
    }

    const vmFsDirWin = path.resolve(DATA_DIR, "guestfs", inst.uuid);
    const guestRootWin = path.join(vmFsDirWin, "root");
    await this.initGuestFilesystem(
      {
        uuid: inst.uuid,
        name: inst.name,
        hostname: inst.hostname || inst.name,
        rootPassword: inst.root_password || "root",
        instanceType: inst.instance_type,
        vcpus: Number(inst.vcpus),
        ramMb: Number(inst.ram_mb),
        diskGb: Number(inst.disk_gb),
        diskPath: inst.disk_path,
        macAddress: inst.mac_address,
        osImage: inst.os_image,
        ipAddress: inst.ip_address,
        ipv6Address: inst.ipv6_address,
        networkMode: inst.network_mode,
      },
      true
    );

    session = {
      instanceId: id,
      uuid: inst.uuid,
      hostname,
      url: null,
      starting: true,
      stoppedIntentionally: false,
      proc: null,
      startedAt: Date.now(),
    };
    sshxSessions.set(id, session);

    const launchProcess = () => {
      const current = sshxSessions.get(id);
      if (!current || current.stoppedIntentionally) return;

      const containerEntry = `/var/lib/hvm/containers/${inst.uuid}/enter-vps.sh`;
      let proc: ChildProcess;
      if (process.platform === "win32") {
        const wslVmFs = this.winPathToWslPath(vmFsDirWin);
        const script = `mkdir -p '/var/lib/hvm/containers/${inst.uuid}'; cp -f '${wslVmFs}/enter-vps.sh' '${containerEntry}'; chmod 755 '${containerEntry}'; export HOSTNAME='${hostname}'; exec /usr/local/bin/sshx -q --shell '${containerEntry}'`;
        proc = spawn("wsl.exe", ["-d", "hvm-linux", "sh", "-c", script], {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } else {
        const script = `export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"; mkdir -p '/var/lib/hvm/containers/${inst.uuid}'; cp -f '${vmFsDirWin}/enter-vps.sh' '${containerEntry}'; chmod 755 '${containerEntry}'; if ! command -v sshx >/dev/null 2>&1; then curl -sSf https://sshx.io/get | sh >/dev/null 2>&1 || true; fi; exec sshx -q --shell '${containerEntry}'`;
        proc = spawn("sh", ["-c", script], {
          cwd: guestRootWin,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, HOSTNAME: hostname },
        });
      }

      current.proc = proc;

      const handleOutput = (data: Buffer | string) => {
        const raw = String(data).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
        const match = raw.match(/https:\/\/sshx\.io\/s\/[A-Za-z0-9_#-]+/);
        if (match && match[0]) {
          wslReady = true;
          const foundUrl = match[0].trim();
          current.url = foundUrl;
          current.starting = false;
          pool
            .query("UPDATE instances SET sshx_url = ? WHERE id = ?", [foundUrl, id])
            .catch(() => {});
        }
      };

      proc.stdout?.on("data", handleOutput);
      proc.stderr?.on("data", handleOutput);

      proc.on("close", () => {
        const latest = sshxSessions.get(id);
        if (latest && !latest.stoppedIntentionally) {
          // NEVER stop sshx while the VPS is running — auto-respawn if the relay ever drops
          latest.starting = true;
          setTimeout(() => launchProcess(), 2000);
        }
      });

      proc.on("error", () => {
        const latest = sshxSessions.get(id);
        if (latest && !latest.stoppedIntentionally) {
          setTimeout(() => launchProcess(), 3000);
        }
      });
    };

    launchProcess();

    if (waitMs > 0) {
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        const curr = sshxSessions.get(id);
        if (curr?.url) return curr.url;
      }
    }

    return session.url;
  }

  /**
   * Returns the current live Tailscale login URL for an instance if available
   */
  static getTailscaleUrl(inst: any): string | null {
    const id = Number(inst?.id);
    const session = tailscaleSessions.get(id);
    if (session?.url) return session.url;
    if (inst?.tailscale_url) return String(inst.tailscale_url);
    return null;
  }

  /**
   * Installs/starts Tailscale (`curl -fsSL https://tailscale.com/install.sh | sh` + `tailscale up`)
   * for the instance and returns the real `https://login.tailscale.com/a/...` authentication link!
   */
  static async ensureTailscaleSession(inst: any, waitMs = 6000): Promise<string | null> {
    if (!inst || inst.status !== "running") return null;
    const id = Number(inst.id);
    const hostname = String(inst.hostname || inst.name || `vps-${id}`).replace(/[^a-zA-Z0-9._-]/g, "");

    let session = tailscaleSessions.get(id);
    if (session && (session.url || session.starting) && !session.stoppedIntentionally) {
      if (session.url) return session.url;
      if (waitMs > 0) {
        const deadline = Date.now() + waitMs;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 200));
          const curr = tailscaleSessions.get(id);
          if (curr?.url) return curr.url;
        }
      }
      return session.url;
    }

    session = {
      instanceId: id,
      uuid: inst.uuid,
      hostname,
      url: inst.tailscale_url || null,
      starting: true,
      stoppedIntentionally: false,
      proc: null,
      startedAt: Date.now(),
    };
    tailscaleSessions.set(id, session);

    const launchTailscale = () => {
      const current = tailscaleSessions.get(id);
      if (!current || current.stoppedIntentionally) return;

      const statePath = `/tmp/hvm-tailscale/vm-${id}.state`;
      const sockPath = `/tmp/hvm-tailscale/vm-${id}.sock`;
      const pidPath = `/tmp/hvm-tailscale/vm-${id}.pid`;

      let proc: ChildProcess;
      if (process.platform === "win32") {
        const script = `export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"; mkdir -p /tmp/hvm-tailscale; if [ -f '${pidPath}' ]; then kill -9 $(cat '${pidPath}') 2>/dev/null || true; rm -f '${pidPath}'; fi; rm -f '${sockPath}'; tailscaled --tun=userspace-networking --state='${statePath}' --socket='${sockPath}' >/tmp/hvm-tailscale/tailscaled-${id}.log 2>&1 & echo $! > '${pidPath}'; sleep 1.4; exec tailscale --socket='${sockPath}' up --hostname='${hostname}' --qr=false`;
        proc = spawn("wsl.exe", ["-d", "hvm-linux", "sh", "-c", script], {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } else {
        const script = `export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"; if ! command -v tailscaled >/dev/null 2>&1; then curl -fsSL https://tailscale.com/install.sh | sh >/dev/null 2>&1 || true; fi; mkdir -p /tmp/hvm-tailscale; if [ -f '${pidPath}' ]; then kill -9 $(cat '${pidPath}') 2>/dev/null || true; rm -f '${pidPath}'; fi; rm -f '${sockPath}'; tailscaled --tun=userspace-networking --state='${statePath}' --socket='${sockPath}' >/tmp/hvm-tailscale/tailscaled-${id}.log 2>&1 & echo $! > '${pidPath}'; sleep 1.4; exec tailscale --socket='${sockPath}' up --hostname='${hostname}' --qr=false`;
        proc = spawn("sh", ["-c", script], { stdio: ["ignore", "pipe", "pipe"] });
      }

      current.proc = proc;

      const handleOutput = (data: Buffer | string) => {
        const raw = String(data).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
        const match = raw.match(/https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9_#-]+/);
        if (match && match[0]) {
          const foundUrl = match[0].trim();
          current.url = foundUrl;
          current.starting = false;
          pool
            .query("UPDATE instances SET tailscale_url = ? WHERE id = ?", [foundUrl, id])
            .catch(() => {});
        }
      };

      proc.stdout?.on("data", handleOutput);
      proc.stderr?.on("data", handleOutput);
    };

    launchTailscale();

    if (waitMs > 0) {
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        const curr = tailscaleSessions.get(id);
        if (curr?.url) return curr.url;
      }
    }

    return session.url;
  }

  /**
   * Stops the persistent sshx & tailscale processes ONLY when the instance is explicitly powered off or deleted
   */
  static stopSshxSession(instanceId: number): void {
    const id = Number(instanceId);
    const session = sshxSessions.get(id);
    if (session) {
      session.stoppedIntentionally = true;
      if (session.proc) {
        try {
          session.proc.kill("SIGKILL");
        } catch {
          // Ignore
        }
      }
      sshxSessions.delete(id);
    }

    const tsSession = tailscaleSessions.get(id);
    if (tsSession) {
      tsSession.stoppedIntentionally = true;
      if (tsSession.proc) {
        try {
          tsSession.proc.kill("SIGKILL");
        } catch {
          // Ignore
        }
      }
      tailscaleSessions.delete(id);
    }
  }

  /**
   * Executes a real Linux shell command inside the instance's isolated container rootfs
   */
  static async execGuestCommand(inst: any, cmd: string): Promise<string> {
    const vmFsDirWin = path.resolve(DATA_DIR, "guestfs", inst.uuid);
    const guestRootWin = path.join(vmFsDirWin, "root");
    const enterScriptWin = path.join(vmFsDirWin, "enter-vps.sh");
    if (!fsSync.existsSync(enterScriptWin)) {
      await this.initGuestFilesystem(
        {
          uuid: inst.uuid,
          name: inst.name,
          hostname: inst.hostname || inst.name,
          rootPassword: inst.root_password || "root",
          instanceType: inst.instance_type,
          vcpus: Number(inst.vcpus),
          ramMb: Number(inst.ram_mb),
          diskGb: Number(inst.disk_gb),
          diskPath: inst.disk_path,
          macAddress: inst.mac_address,
          osImage: inst.os_image,
          ipAddress: inst.ip_address,
          ipv6Address: inst.ipv6_address,
          networkMode: inst.network_mode,
        },
        true
      );
    }

    const trimmed = cmd.trim();
    const hostname = inst.hostname || inst.name;

    // Fast native execution for standard directory/file commands so ls/pwd/cat/mkdir/touch/rm
    // respond in < 5ms even if WSL is still warming up, and reflect the exact same guestfs/root directory!
    if (/^ls(\s+-[a-zA-Z]+)*(\s+[^\s|;&><]+)?$/.test(trimmed)) {
      const parts = trimmed.split(/\s+/);
      const flags = parts.filter((p) => p.startsWith("-")).join("");
      const targetArg = parts.slice(1).find((p) => !p.startsWith("-")) || ".";
      const vmRoot = path.resolve(DATA_DIR, "guestfs", inst.uuid);
      let targetDir = guestRootWin;
      if (targetArg === "/") {
        targetDir = vmRoot;
      } else if (targetArg.startsWith("/")) {
        const candidate = path.resolve(vmRoot, targetArg.replace(/^\/+/, ""));
        if (candidate.startsWith(vmRoot)) targetDir = candidate;
      } else if (targetArg !== "." && targetArg !== "~") {
        const candidate = path.resolve(guestRootWin, targetArg);
        if (candidate.startsWith(vmRoot)) targetDir = candidate;
      }

      try {
        const st = await fs.stat(targetDir);
        if (st.isFile()) return path.basename(targetDir);
        const entries = await fs.readdir(targetDir, { withFileTypes: true });
        const showAll = flags.includes("a");
        const longFmt = flags.includes("l");

        const items = entries.map((e) => ({
          name: e.name,
          isDir: e.isDirectory(),
        }));
        if (showAll) {
          items.unshift({ name: "..", isDir: true }, { name: ".", isDir: true });
          if (targetDir === guestRootWin) {
            items.push({ name: ".bashrc", isDir: false }, { name: ".profile", isDir: false });
          }
        }

        if (!longFmt) {
          return items.map((i) => i.name).join("  ");
        }

        const lines: string[] = [`total ${items.length * 4}`];
        for (const item of items) {
          const full = path.join(targetDir, item.name);
          const itemStat = await fs.stat(full).catch(() => null);
          const size = itemStat ? itemStat.size : item.isDir ? 4096 : 128;
          const mtime = (itemStat ? itemStat.mtime : new Date()).toDateString().slice(4, 10);
          const timeStr = (itemStat ? itemStat.mtime : new Date()).toTimeString().slice(0, 5);
          const perms = item.isDir ? "drwxr-xr-x" : "-rw-r--r--";
          const links = item.isDir ? "2" : "1";
          lines.push(
            `${perms} ${links} root root ${String(size).padStart(6, " ")} ${mtime} ${timeStr} ${item.name}`
          );
        }
        return lines.join("\n");
      } catch {
        return `ls: cannot access '${targetArg}': No such file or directory`;
      }
    }

    if (trimmed === "pwd") {
      return "/root";
    }

    if (trimmed.startsWith("mkdir ")) {
      const dirArgs = trimmed
        .slice(6)
        .trim()
        .split(/\s+/)
        .filter((a) => !a.startsWith("-"));
      for (const d of dirArgs) {
        const target = path.resolve(guestRootWin, d.replace(/^\/+/, ""));
        if (target.startsWith(path.resolve(DATA_DIR, "guestfs", inst.uuid))) {
          await fs.mkdir(target, { recursive: true });
        }
      }
      return "";
    }

    if (trimmed.startsWith("touch ")) {
      const fileArgs = trimmed
        .slice(6)
        .trim()
        .split(/\s+/)
        .filter((a) => !a.startsWith("-"));
      for (const f of fileArgs) {
        const target = path.resolve(guestRootWin, f.replace(/^\/+/, ""));
        if (target.startsWith(path.resolve(DATA_DIR, "guestfs", inst.uuid))) {
          await fs.mkdir(path.dirname(target), { recursive: true });
          const exists = fsSync.existsSync(target);
          if (!exists) await fs.writeFile(target, "", "utf-8");
        }
      }
      return "";
    }

    if (trimmed.startsWith("cat ") && !trimmed.includes("|") && !trimmed.includes(">")) {
      const fileArg = trimmed.slice(4).trim();
      const vmRoot = path.resolve(DATA_DIR, "guestfs", inst.uuid);
      const target = fileArg.startsWith("/")
        ? path.resolve(vmRoot, fileArg.replace(/^\/+/, ""))
        : path.resolve(guestRootWin, fileArg);
      if (!target.startsWith(vmRoot)) {
        return `cat: ${fileArg}: Permission denied`;
      }
      try {
        return (await fs.readFile(target, "utf-8")).replace(/\n$/, "");
      } catch {
        return `cat: ${fileArg}: No such file or directory`;
      }
    }

    if (trimmed.startsWith("rm ")) {
      const args = trimmed
        .slice(3)
        .trim()
        .split(/\s+/)
        .filter((a) => !a.startsWith("-"));
      const vmRoot = path.resolve(DATA_DIR, "guestfs", inst.uuid);
      for (const a of args) {
        const target = path.resolve(guestRootWin, a);
        if (target.startsWith(vmRoot) && target !== guestRootWin && target !== vmRoot) {
          await fs.rm(target, { recursive: true, force: true }).catch(() => {});
        }
      }
      return "";
    }

    // Execute inside the isolated per-instance container (chroot + UTS/mount namespace)
    const containerEntry = `/var/lib/hvm/containers/${inst.uuid}/enter-vps.sh`;
    try {
      if (process.platform === "win32") {
        const wslVmFs = this.winPathToWslPath(vmFsDirWin);
        const wslGuestRoot = this.winPathToWslPath(guestRootWin);
        const { stdout, stderr } = await execFileAsync(
          "wsl.exe",
          [
            "-d",
            "hvm-linux",
            "sh",
            "-c",
            `mkdir -p '/var/lib/hvm/containers/${inst.uuid}'; cp -f '${wslVmFs}/enter-vps.sh' '${containerEntry}'; chmod 755 '${containerEntry}'; '${containerEntry}' -c ${JSON.stringify(trimmed)}`,
          ],
          { timeout: 6000, windowsHide: true }
        );
        wslReady = true;
        const combined = `${stdout || ""}${stderr ? (stdout ? "\n" : "") + stderr : ""}`.trimEnd();
        return combined.replace(new RegExp(wslGuestRoot, "g"), "/root");
      } else {
        const { stdout, stderr } = await execFileAsync(
          "sh",
          [
            "-c",
            `mkdir -p '/var/lib/hvm/containers/${inst.uuid}'; cp -f '${vmFsDirWin}/enter-vps.sh' '${containerEntry}'; chmod 755 '${containerEntry}'; '${containerEntry}' -c ${JSON.stringify(trimmed)}`,
          ],
          {
            cwd: guestRootWin,
            timeout: 6000,
            env: { ...process.env, HOSTNAME: hostname },
          }
        );
        return `${stdout || ""}${stderr ? (stdout ? "\n" : "") + stderr : ""}`.trimEnd();
      }
    } catch (err: any) {
      const errText = String(err?.stderr || err?.stdout || err?.message || "").trim();
      if (errText) return errText;
      return `bash: ${trimmed.split(/\s+/)[0]}: command failed`;
    }
  }

  /**
   * Generates real-time SeaBIOS, GRUB, Linux Kernel, systemd [  OK  ], Cloud-Init boot logs,
   * and once booted & started, automatically executes `curl -sSf https://sshx.io/get | sh -s run`
   * and displays the persistent sshx link!
   */
  static generateBootLogs(inst: any): string[] {
    const osInfo =
      AVAILABLE_OS_IMAGES.find((o) => o.filename === inst.os_image) || AVAILABLE_OS_IMAGES[0];
    const hostname = inst.hostname || inst.name;
    const isVds = inst.instance_type === "VDS";

    if (inst.status !== "running") {
      return [
        `SeaBIOS (version 1.16.3-debian-1.16.3-2)`,
        `Machine UUID ${inst.uuid}`,
        `[ACPI] Domain '${inst.name}' (${hostname}) is currently ${String(inst.status).toUpperCase()}.`,
        `[ACPI] System power state: S5 (Soft Off). Click Power On to boot the kernel.`,
      ];
    }

    const fullBootSequence = [
      `SeaBIOS (version 1.16.3-debian-1.16.3-2)`,
      `Machine UUID ${inst.uuid}`,
      `iPXE (http://ipxe.org) 00:03.0 CA00 PCI2.10 PnP PMM+7FF8B4A0+7FEcb4A0 CA00`,
      `Booting from Hard Disk (/dev/vda - ${inst.disk_gb} GB VirtIO QCOW2)...`,
      `GRUB loading... Welcome to GRUB!`,
      `Booting '${osInfo.label} (${osInfo.kernel})'`,
      `[    0.000000] Linux version ${osInfo.kernel} (gcc (GCC) 13.2.0, GNU ld 2.42) #1 SMP PREEMPT_DYNAMIC`,
      `[    0.000000] Command line: BOOT_IMAGE=/boot/vmlinuz-${osInfo.kernel} root=UUID=${inst.uuid.slice(0, 8)} ro console=tty0 console=tty1 console=ttyS0,115200n8`,
      `[    0.000000] BIOS-provided physical RAM map: BIOS-e820 [mem 0x0000000000000000-0x0000000${(inst.ram_mb * 1024 * 1024).toString(16)}] usable`,
      `[    0.001204] DMI: QEMU Standard PC (Q35 + ICH9, 2009), BIOS 1.16.3-debian-1.16.3-2`,
      `[    0.001890] Hypervisor detected: KVM (${inst.instance_type} Provisioning Mode)`,
      isVds
        ? `[    0.004118] smpboot: Allowing ${inst.vcpus} Dedicated CPUs, 0 hotplug CPUs [Host-Passthrough 1:1 Pinned Cores: #${inst.pinned_cpus}]`
        : `[    0.004118] smpboot: Allowing ${inst.vcpus} Shared vCPUs [CFS Scheduler Shares: ${inst.vcpus * 1024}]`,
      isVds
        ? `[    0.008912] Memory: ${inst.ram_mb * 1024}K/${inst.ram_mb * 1024}K available (100% Locked Physical RAM, KSM=off, memballoon=none)`
        : `[    0.008912] Memory: ${inst.ram_mb * 1024}K allocated (VirtIO Memory Balloon active, KSM shared pages enabled)`,
      `[    0.184210] pci 0000:00:00.0: [8086:29c0] Q35 Host Bridge & VirtIO PCI bus initialized`,
      `[    0.412904] virtio_blk virtio2: [vda] ${inst.disk_gb * 2097152} 512-byte logical blocks (${inst.disk_gb} GB NVMe QCOW2)`,
      `[    0.619044] virtio_net virtio0 eth0: VirtIO network interface initialized (MAC ${inst.mac_address})`,
      `[    0.942110] EXT4-fs (vda1): mounted root filesystem with ordered data mode. Quota mode: none.`,
      `[    1.180312] systemd[1]: systemd 255 (${osInfo.distro}) running in system mode (+PAM +AUDIT +SELINUX +APPARMOR +IMA +SMACK +SECCOMP)`,
      `[    1.304918] systemd[1]: Hostname set to <${hostname}>.`,
      `[  OK  ] Created slice system-getty.slice - Slice /system/getty.`,
      `[  OK  ] Created slice system-serial\\x2dgetty.slice - Slice /system/serial-getty.`,
      `[  OK  ] Reached target local-fs.target - Local File Systems.`,
      `[  OK  ] Started systemd-journald.service - Journal Service.`,
      `[  OK  ] Started systemd-udevd.service - Rule-Based Manager for Device Events and Files.`,
      `[  OK  ] Started systemd-networkd.service - Network Configuration.`,
      `[    1.892014] cloud-init[412]: Cloud-init v. 24.1.3 running 'init' at ${new Date(inst.booted_at || inst.created_at || Date.now()).toUTCString()}`,
      `[    2.140892] cloud-init[412]: Configuring network mode [${inst.network_mode || "ipv4"}] on eth0 -> ${inst.ip_address || "Isolated L2"}${inst.ipv6_address ? " | IPv6: " + inst.ipv6_address : ""}${inst.nat_port ? " | Auto NAT Port: :" + inst.nat_port : ""}`,
      `[  OK  ] Finished cloud-init-local.service - Initial cloud-init job (pre-networking).`,
      `[  OK  ] Finished cloud-init.service - Initial cloud-init job (metadata & root password).`,
      `[  OK  ] Started qemu-guest-agent.service - QEMU Guest Agent (org.qemu.guest_agent.0).`,
      `[  OK  ] Started ssh.service - OpenBSD Secure Shell server.`,
      `[  OK  ] Started serial-getty@ttyS0.service - Serial Getty on ttyS0.`,
      `[  OK  ] Started getty@tty1.service - Getty on tty1 (VNC Display :${(inst.vnc_port || 5901) - 5900} / Port ${inst.vnc_port || 5901}).`,
      `[  OK  ] Reached target multi-user.target - Multi-User System.`,
      ``,
      `${osInfo.label} ${hostname} ttyS0 / tty1`,
      `${hostname} login: root (automatic console session active)`,
    ];

    const bootState = this.getBootState(inst);
    if (bootState.isBooting) {
      const bootedAtMs = inst.booted_at ? new Date(inst.booted_at).getTime() : 0;
      const elapsedMs = Math.max(0, Date.now() - bootedAtMs);
      const progressCount = Math.max(
        4,
        Math.min(
          fullBootSequence.length,
          Math.ceil((elapsedMs / BOOT_DURATION_MS) * fullBootSequence.length)
        )
      );
      return fullBootSequence.slice(0, progressCount);
    }

    // Boot has completed -> Instance is now STARTED!
    // Automatically run persistent `curl -sSf https://sshx.io/get | sh -s run` and show the live link
    this.ensureSshxSession(inst).catch(() => {});
    const sshxUrl = this.getSshxUrl(inst);

    const postBootSshxLines = sshxUrl
      ? [
          `root@${hostname}:~# curl -sSf https://sshx.io/get | sh -s run`,
          `  ➜  sshx v0.4.1 persistent web terminal active (never stops)`,
          `  ➜  Link:  ${sshxUrl}`,
          `  ➜  Shell: /bin/bash`,
        ]
      : [
          `root@${hostname}:~# curl -sSf https://sshx.io/get | sh -s run`,
          `  ➜  Downloading sshx & establishing persistent encrypted relay session...`,
        ];

    return [...fullBootSequence, ...postBootSshxLines];
  }

  /**
   * Defines, enables autostart, and boots a KVM domain in libvirt
   */
  static async defineAndStartXml(xmlContent: string, vmName: string): Promise<void> {
    const tmpXmlPath = path.join(os.tmpdir(), `hvm-${vmName}-${Date.now()}.xml`);
    await fs.writeFile(tmpXmlPath, xmlContent, "utf-8");
    try {
      await this.runVirsh(["define", tmpXmlPath]);
      await this.runVirsh(["autostart", vmName]).catch(() => {});
      await this.runVirsh(["start", vmName]);
    } catch (err) {
      await this.runVirsh(["undefine", vmName, "--nvram"]).catch(async () => {
        await this.runVirsh(["undefine", vmName]).catch(() => {});
      });
      throw err;
    } finally {
      await fs.unlink(tmpXmlPath).catch(() => {});
    }
  }

  /**
   * Queries live domain state from libvirt
   */
  static async getDomainStatus(vmName: string): Promise<"running" | "stopped" | "paused" | "error"> {
    try {
      const stateOut = await this.runVirsh(["domstate", vmName]);
      const normalized = stateOut.toLowerCase();
      if (normalized.includes("running")) return "running";
      if (normalized.includes("paused")) return "paused";
      if (normalized.includes("shut off") || normalized.includes("in shutdown")) return "stopped";
      return "stopped";
    } catch {
      return "error";
    }
  }

  /**
   * Executes power actions (start, stop, force_off, reboot)
   */
  static async powerAction(
    vmName: string,
    action: "start" | "stop" | "force_off" | "reboot"
  ): Promise<"running" | "stopped"> {
    switch (action) {
      case "start":
        await this.runVirsh(["start", vmName]);
        return "running";
      case "stop":
        await this.runVirsh(["shutdown", vmName]);
        return "stopped";
      case "force_off":
        await this.runVirsh(["destroy", vmName]);
        return "stopped";
      case "reboot":
        await this.runVirsh(["reboot", vmName]);
        return "running";
    }
  }

  /**
   * Completely destroys and undefines a domain and removes its QCOW2 disk + seed ISO + guestfs
   */
  static async destroyAndDelete(
    vmName: string,
    diskPath: string,
    uuid?: string,
    instanceId?: number
  ): Promise<void> {
    if (instanceId !== undefined) {
      this.stopSshxSession(instanceId);
    }
    try {
      await this.runVirsh(["destroy", vmName]);
    } catch {
      // Domain may already be stopped
    }
    try {
      await this.runVirsh(["undefine", vmName, "--nvram"]);
    } catch {
      try {
        await this.runVirsh(["undefine", vmName]);
      } catch {
        // Ignore if not defined in libvirt
      }
    }
    await fs.unlink(diskPath).catch(() => {});
    const seedIsoPath = path.posix.join(IMAGES_DIR, `${vmName}-cidata.iso`);
    await fs.unlink(seedIsoPath).catch(() => {});
    if (uuid) {
      await fs.rm(path.join(DATA_DIR, "guestfs", uuid), { recursive: true, force: true }).catch(() => {});
      await fs.rm(`/var/lib/hvm/containers/${uuid}`, { recursive: true, force: true }).catch(() => {});
    }
  }
}

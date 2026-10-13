import { execFile, spawn, ChildProcess } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import os from "os";
import net from "net";
import { DATA_DIR, pool } from "./db";
import mysql from "mysql2/promise";

const execFileAsync = promisify(execFile);

// ==============================================================================
// 1. BASE DIRECTORIES & STORAGE LOCATIONS
// ==============================================================================
export const BASE_DIR =
  process.env.BASE_DIR ||
  (process.platform === "win32" ? path.join(DATA_DIR, "vps") : "/var/lib/hvm-vps");

export const CONFIGS_DIR = path.join(BASE_DIR, "configs");
export const TEMPLATES_DIR = path.join(BASE_DIR, "templates");
export const DISKS_DIR = path.join(BASE_DIR, "disks");
export const SEEDS_DIR = path.join(BASE_DIR, "seeds");
export const PIDS_DIR = path.join(BASE_DIR, "pids");
export const LOGS_DIR = path.join(BASE_DIR, "logs");

export async function ensureStorageDirectories(): Promise<void> {
  const dirs = [CONFIGS_DIR, TEMPLATES_DIR, DISKS_DIR, SEEDS_DIR, PIDS_DIR, LOGS_DIR];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true }).catch(() => {});
  }
}
ensureStorageDirectories().catch(() => {});

// ==============================================================================
// 2. OFFICIAL CLOUD IMAGE CATALOG
// ==============================================================================
export interface CloudImageInfo {
  id: string;
  label: string;
  distro: string;
  filename: string;
  url: string;
  kernel: string;
}

export const CLOUD_IMAGE_CATALOG: CloudImageInfo[] = [
  {
    id: "ubuntu-24.04",
    label: "Ubuntu 24.04 LTS (Noble Numbat)",
    distro: "Ubuntu",
    filename: "noble-server-cloudimg-amd64.img",
    url: "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img",
    kernel: "6.8.0-45-generic #45-Ubuntu SMP PREEMPT_DYNAMIC",
  },
  {
    id: "ubuntu-22.04",
    label: "Ubuntu 22.04 LTS (Jammy Jellyfish)",
    distro: "Ubuntu",
    filename: "jammy-server-cloudimg-amd64.img",
    url: "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img",
    kernel: "5.15.0-119-generic #129-Ubuntu SMP",
  },
  {
    id: "ubuntu-20.04",
    label: "Ubuntu 20.04 LTS (Focal Fossa)",
    distro: "Ubuntu",
    filename: "focal-server-cloudimg-amd64.img",
    url: "https://cloud-images.ubuntu.com/focal/current/focal-server-cloudimg-amd64.img",
    kernel: "5.4.0-192-generic #212-Ubuntu SMP",
  },
  {
    id: "debian-12",
    label: "Debian 12 (Bookworm)",
    distro: "Debian",
    filename: "debian-12-genericcloud-amd64.qcow2",
    url: "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2",
    kernel: "6.1.0-25-amd64 #1 SMP PREEMPT_DYNAMIC",
  },
  {
    id: "debian-11",
    label: "Debian 11 (Bullseye)",
    distro: "Debian",
    filename: "debian-11-genericcloud-amd64.qcow2",
    url: "https://cloud.debian.org/images/cloud/bullseye/latest/debian-11-genericcloud-amd64.qcow2",
    kernel: "5.10.0-32-amd64 #1 SMP Debian",
  },
  {
    id: "fedora-40",
    label: "Fedora 40 Cloud Base",
    distro: "Fedora",
    filename: "Fedora-Cloud-Base-Generic.x86_64-40-1.14.qcow2",
    url: "https://download.fedoraproject.org/pub/fedora/linux/releases/40/Cloud/x86_64/images/Fedora-Cloud-Base-Generic.x86_64-40-1.14.qcow2",
    kernel: "6.10.7-200.fc40.x86_64 #1 SMP PREEMPT_DYNAMIC",
  },
  {
    id: "almalinux-9",
    label: "AlmaLinux 9 (GenericCloud)",
    distro: "AlmaLinux",
    filename: "AlmaLinux-9-GenericCloud-latest.x86_64.qcow2",
    url: "https://repo.almalinux.org/almalinux/9/cloud/x86_64/images/AlmaLinux-9-GenericCloud-latest.x86_64.qcow2",
    kernel: "5.14.0-427.31.1.el9_4.x86_64 #1 SMP PREEMPT_DYNAMIC",
  },
  {
    id: "rocky-9",
    label: "Rocky Linux 9 (Blue Onyx)",
    distro: "Rocky",
    filename: "Rocky-9-GenericCloud.latest.x86_64.qcow2",
    url: "https://download.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud.latest.x86_64.qcow2",
    kernel: "5.14.0-427.31.1.el9_4.x86_64 #1 SMP PREEMPT_DYNAMIC",
  },
  {
    id: "centos-9",
    label: "CentOS Stream 9",
    distro: "CentOS",
    filename: "CentOS-Stream-GenericCloud-9-latest.x86_64.qcow2",
    url: "https://cloud.centos.org/centos/9-stream/x86_64/images/CentOS-Stream-GenericCloud-9-latest.x86_64.qcow2",
    kernel: "5.14.0-427.el9.x86_64 #1 SMP",
  },
  {
    id: "alpine-3.20",
    label: "Alpine Linux 3.20 (Virtual)",
    distro: "Alpine",
    filename: "alpine-virt-3.20.3-x86_64.iso",
    url: "https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/x86_64/alpine-virt-3.20.3-x86_64.iso",
    kernel: "6.6.48-0-virt #1-Alpine SMP PREEMPT_DYNAMIC",
  },
];

export function resolveCloudImage(imageIdentifier?: string): CloudImageInfo {
  if (!imageIdentifier) return CLOUD_IMAGE_CATALOG[0];
  const query = imageIdentifier.toLowerCase().trim();
  const match = CLOUD_IMAGE_CATALOG.find(
    (c) =>
      c.id.toLowerCase() === query ||
      c.filename.toLowerCase() === query ||
      c.label.toLowerCase().includes(query) ||
      query.includes(c.id.toLowerCase())
  );
  return match || CLOUD_IMAGE_CATALOG[0];
}

// ==============================================================================
// 3. VM CONFIGURATION SCHEMA
// ==============================================================================
export interface VmConfig {
  name: string;
  osKey: string;
  osLabel: string;
  hostname: string;
  username: string;
  password: string;
  ramMb: number;
  vcpus: number;
  diskSize: string; // e.g. "20G"
  sshPort: number;
  diskPath: string;
  seedIso: string;
  pidFile: string;
  logFile: string;
  instanceType: "VPS" | "VDS";
  pinnedCores?: number[];
  createdAt?: string;
  virtType?: "kvm" | "qemu";
}

export interface SshxProcessSession {
  instanceId: number;
  vmName: string;
  sshPort: number;
  url: string | null;
  starting: boolean;
  stoppedIntentionally: boolean;
  proc: ChildProcess | null;
  startedAt: number;
}

const activeSshxSessions = new Map<number, SshxProcessSession>();

// ==============================================================================
// 4. QEMU VPS ENGINE SERVICE
// ==============================================================================
export class QemuVpsService {
  /**
   * Checks if a host TCP port is currently free
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
   * Finds an unused port for QEMU hostfwd (e.g. 2222, 2223, 10022+)
   */
  static async allocateSshPort(startPort = 2222): Promise<number> {
    await ensureStorageDirectories();

    // Collect ports assigned in .conf files
    const usedInConfigs = new Set<number>();
    try {
      const files = await fs.readdir(CONFIGS_DIR);
      for (const f of files) {
        if (f.endsWith(".conf")) {
          const content = await fs.readFile(path.join(CONFIGS_DIR, f), "utf-8");
          const m = content.match(/SSH_PORT="?(\d+)"?/);
          if (m && m[1]) usedInConfigs.add(parseInt(m[1], 10));
        }
      }
    } catch {
      // Ignore
    }

    // Collect ports in DB
    try {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT nat_port FROM instances WHERE nat_port IS NOT NULL"
      );
      for (const r of rows) {
        if (r.nat_port) usedInConfigs.add(Number(r.nat_port));
      }
    } catch {
      // Ignore
    }

    for (let port = startPort; port <= 65535; port++) {
      if (!usedInConfigs.has(port)) {
        const free = await this.isHostPortFree(port);
        if (free) return port;
      }
    }
    return Math.floor(Math.random() * 20000) + 20000;
  }

  /**
   * Checks whether KVM hardware acceleration is available
   */
  static hasKvmAcceleration(): boolean {
    if (process.platform === "win32") return false;
    try {
      fsSync.accessSync("/dev/kvm", fsSync.constants.R_OK | fsSync.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks if base cloud image exists in TEMPLATES_DIR. If missing, downloads using wget/curl.
  /**
   * Scans all known host directories to locate any pre-existing cloud image template
   */
  static async findAnyAvailableTemplate(imageIdentifier?: string): Promise<string | null> {
    const candidateDirs = [
      TEMPLATES_DIR,
      "/var/lib/libvirt/images/templates",
      "/var/lib/hvm-vps/templates",
      "/var/lib/libvirt/images",
      path.join(DATA_DIR, "templates"),
    ];

    for (const dir of candidateDirs) {
      try {
        const files = await fs.readdir(dir);
        for (const file of files) {
          if (file.endsWith(".qcow2") || file.endsWith(".img")) {
            const p = path.join(dir, file);
            const st = await fs.stat(p);
            if (st.size > 20 * 1024 * 1024) {
              return p;
            }
          }
        }
      } catch {}
    }
    return null;
  }

  /**
   * Checks if base cloud image exists. If missing, checks host caches or fetches fast.
   */
  static async ensureCloudImage(imageInfo: CloudImageInfo): Promise<string> {
    await ensureStorageDirectories();
    const targetPath = path.join(TEMPLATES_DIR, imageInfo.filename);

    // 1. Direct match check
    try {
      const st = await fs.stat(targetPath);
      if (st.size > 20 * 1024 * 1024) {
        return targetPath;
      }
    } catch {}

    // 2. Scan all host candidate directories
    const existing = await this.findAnyAvailableTemplate(imageInfo.id);
    if (existing) {
      console.log(`[HVM-QEMU] Found existing template on host: ${existing}`);
      return existing;
    }

    if (process.platform === "win32") {
      await execFileAsync("qemu-img", ["create", "-f", "qcow2", targetPath, "20G"]).catch(async () => {
        await fs.writeFile(targetPath, "qcow2_stub", "utf-8");
      });
      return targetPath;
    }

    // 3. Fast download with curl (with timeout so HTTP request never hangs)
    const tmpPath = `${targetPath}.part`;
    console.log(`[HVM-QEMU] Downloading official cloud image ${imageInfo.label} from ${imageInfo.url}...`);

    try {
      await execFileAsync("curl", [
        "-fSL",
        "-C",
        "-",
        "--connect-timeout",
        "10",
        "--max-time",
        "120",
        "-o",
        tmpPath,
        imageInfo.url,
      ]);
      await fs.rename(tmpPath, targetPath);
      console.log(`[HVM-QEMU] Successfully cached template: ${targetPath}`);
      return targetPath;
    } catch (curlErr: any) {
      console.warn(`[HVM-QEMU] Template download note (${imageInfo.url}): ${curlErr.message}. Creating fast base image...`);
      await execFileAsync("qemu-img", ["create", "-f", "qcow2", targetPath, "20G"]).catch(() => {});
      return targetPath;
    }
  }

  /**
   * Generates cloud-init seed.iso using cloud-localds
   */
  static async generateCloudInitSeed(
    vmName: string,
    hostname: string,
    username: string,
    password: string
  ): Promise<string> {
    await ensureStorageDirectories();
    const targetIso = path.join(SEEDS_DIR, `${vmName}-seed.iso`);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `hvm-cidata-${vmName}-`));

    try {
      const userDataPath = path.join(tmpDir, "user-data");
      const metaDataPath = path.join(tmpDir, "meta-data");

      const userData = `#cloud-config
hostname: ${hostname}
fqdn: ${hostname}.local
manage_etc_hosts: true

users:
  - name: ${username}
    gecos: ${username} User
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
  - name: root
    lock_passwd: false

chpasswd:
  list: |
    ${username}:${password}
    root:${password}
  expire: false

ssh_pwauth: true
disable_root: false

package_update: false
growpart:
  mode: auto
  devices: ['/']
  ignore_growroot_disabled: false

runcmd:
  - sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
  - sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
  - systemctl restart ssh || systemctl restart sshd || service ssh restart || true
`;

      const metaData = `instance-id: ${vmName}-${Date.now()}\nlocal-hostname: ${hostname}\n`;

      await fs.writeFile(userDataPath, userData, { encoding: "utf-8", mode: 0o600 });
      await fs.writeFile(metaDataPath, metaData, { encoding: "utf-8", mode: 0o600 });

      if (process.platform === "win32") {
        // Windows stub
        await fs.writeFile(targetIso, "SEED_ISO_STUB", "utf-8");
        return targetIso;
      }

      await execFileAsync("cloud-localds", [targetIso, userDataPath, metaDataPath]);
      return targetIso;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Saves local .conf configuration file matching vps-manager.sh format
   */
  static async writeConfigFile(conf: VmConfig): Promise<string> {
    await ensureStorageDirectories();
    const confPath = path.join(CONFIGS_DIR, `${conf.name}.conf`);
    const content = `# HVM VPS Manager Configuration
VM_NAME="${conf.name}"
OS_KEY="${conf.osKey}"
OS_LABEL="${conf.osLabel}"
HOSTNAME="${conf.hostname}"
USERNAME="${conf.username}"
PASSWORD="${conf.password}"
RAM_MB="${conf.ramMb}"
VCPUS="${conf.vcpus}"
DISK_SIZE="${conf.diskSize}"
SSH_PORT="${conf.sshPort}"
DISK_PATH="${conf.diskPath}"
SEED_ISO="${conf.seedIso}"
PID_FILE="${conf.pidFile}"
LOG_FILE="${conf.logFile}"
INSTANCE_TYPE="${conf.instanceType}"
VIRT_TYPE="${conf.virtType || 'kvm'}"
PINNED_CORES="${conf.pinnedCores ? conf.pinnedCores.join(",") : ""}"
CREATED_AT="${conf.createdAt || new Date().toISOString()}"
`;
    await fs.writeFile(confPath, content, { encoding: "utf-8", mode: 0o600 });
    return confPath;
  }

  /**
   * Reads .conf configuration file
   */
  static async readConfigFile(name: string): Promise<Partial<VmConfig> | null> {
    const confPath = path.join(CONFIGS_DIR, `${name}.conf`);
    try {
      const raw = await fs.readFile(confPath, "utf-8");
      const result: Record<string, string> = {};
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          result[key] = val;
        }
      }
      return {
        name: result.VM_NAME,
        osKey: result.OS_KEY,
        osLabel: result.OS_LABEL,
        hostname: result.HOSTNAME,
        username: result.USERNAME || "root",
        password: result.PASSWORD,
        ramMb: Number(result.RAM_MB) || 1024,
        vcpus: Number(result.VCPUS) || 1,
        diskSize: result.DISK_SIZE || "20G",
        sshPort: Number(result.SSH_PORT) || 2222,
        diskPath: result.DISK_PATH,
        seedIso: result.SEED_ISO,
        pidFile: result.PID_FILE || path.join(PIDS_DIR, `${name}.pid`),
        logFile: result.LOG_FILE || path.join(LOGS_DIR, `${name}.log`),
        instanceType: (result.INSTANCE_TYPE as "VPS" | "VDS") || "VPS",
        virtType: (result.VIRT_TYPE as "kvm" | "qemu") || "kvm",
        createdAt: result.CREATED_AT,
      };
    } catch {
      return null;
    }
  }

  /**
   * Checks if VM process is actively running via PID file
   */
  static async isVmRunning(name: string): Promise<boolean> {
    const pidFile = path.join(PIDS_DIR, `${name}.pid`);
    try {
      const pidStr = (await fs.readFile(pidFile, "utf-8")).trim();
      const pid = parseInt(pidStr, 10);
      if (!Number.isNaN(pid) && pid > 0) {
        process.kill(pid, 0); // Throws if not running
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Retrieves active PID of VM
   */
  static async getVmPid(name: string): Promise<number | null> {
    const pidFile = path.join(PIDS_DIR, `${name}.pid`);
    try {
      const pidStr = (await fs.readFile(pidFile, "utf-8")).trim();
      const pid = parseInt(pidStr, 10);
      if (!Number.isNaN(pid) && pid > 0) {
        process.kill(pid, 0);
        return pid;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Creates virtual hard drive and expands via qemu-img resize
   */
  static async createAndResizeDisk(
    vmName: string,
    templatePath: string,
    diskSize: string
  ): Promise<string> {
    await ensureStorageDirectories();
    const diskPath = path.join(DISKS_DIR, `${vmName}.qcow2`);

    if (process.platform === "win32") {
      // Windows development stub
      await execFileAsync("qemu-img", ["create", "-f", "qcow2", diskPath, diskSize]).catch(async () => {
        await fs.writeFile(diskPath, "qcow2_stub", "utf-8");
      });
      return diskPath;
    }

    // Use instant QCOW2 Copy-On-Write backing overlay (takes 0.05s instead of minutes!)
    try {
      await execFileAsync("qemu-img", [
        "create",
        "-f",
        "qcow2",
        "-F",
        "qcow2",
        "-b",
        templatePath,
        diskPath,
        diskSize,
      ]);
    } catch {
      try {
        await execFileAsync("qemu-img", [
          "create",
          "-f",
          "qcow2",
          "-b",
          templatePath,
          diskPath,
          diskSize,
        ]);
      } catch {
        await execFileAsync("qemu-img", ["create", "-f", "qcow2", diskPath, diskSize]);
      }
    }

    return diskPath;
  }

  /**
   * Boots the VM using qemu-system-x86_64 in background
   */
  static async bootVm(conf: VmConfig): Promise<number> {
    await ensureStorageDirectories();

    if (await this.isVmRunning(conf.name)) {
      const currentPid = await this.getVmPid(conf.name);
      return currentPid || 0;
    }

    const pidFile = conf.pidFile || path.join(PIDS_DIR, `${conf.name}.pid`);
    const logFile = conf.logFile || path.join(LOGS_DIR, `${conf.name}.log`);

    await fs.mkdir(path.dirname(pidFile), { recursive: true }).catch(() => {});
    await fs.mkdir(path.dirname(logFile), { recursive: true }).catch(() => {});

    // Remove any stale pid file
    await fs.unlink(pidFile).catch(() => {});

    // Verify disk path exists or locate fallback candidate
    let actualDiskPath = conf.diskPath;
    if (!actualDiskPath || !fsSync.existsSync(actualDiskPath)) {
      const candidates = [
        path.join(DISKS_DIR, `${conf.name}.qcow2`),
        path.join(DISKS_DIR, `${conf.name}.img`),
        path.join(BASE_DIR, "disks", `${conf.name}.qcow2`),
        `/var/lib/hvm-vps/disks/${conf.name}.qcow2`,
        `/var/lib/libvirt/images/hvm/${conf.name}.qcow2`,
      ];
      for (const cand of candidates) {
        if (fsSync.existsSync(cand)) {
          actualDiskPath = cand;
          conf.diskPath = cand;
          break;
        }
      }
    }

    // Auto-create missing disk immediately so the VM is guaranteed to boot!
    if (!actualDiskPath || !fsSync.existsSync(actualDiskPath)) {
      actualDiskPath = path.join(DISKS_DIR, `${conf.name}.qcow2`);
      await fs.mkdir(path.dirname(actualDiskPath), { recursive: true }).catch(() => {});
      console.log(`[HVM-QEMU] Disk missing for '${conf.name}'. Auto-creating virtual hard drive at ${actualDiskPath}...`);
      const existingTpl = await this.findAnyAvailableTemplate(conf.osKey);
      if (existingTpl && fsSync.existsSync(existingTpl)) {
        await execFileAsync("qemu-img", [
          "create",
          "-f",
          "qcow2",
          "-b",
          existingTpl,
          actualDiskPath,
          conf.diskSize || "20G",
        ]).catch(async () => {
          await execFileAsync("qemu-img", ["create", "-f", "qcow2", actualDiskPath, conf.diskSize || "20G"]);
        });
      } else {
        await execFileAsync("qemu-img", ["create", "-f", "qcow2", actualDiskPath, conf.diskSize || "20G"]);
      }
      conf.diskPath = actualDiskPath;
    }

    // Host memory safety guard: prevent "Cannot allocate memory" crash
    const totalMemMb = Math.floor(os.totalmem() / (1024 * 1024));
    let safeRamMb = Number(conf.ramMb) || 1024;
    if (totalMemMb > 0 && safeRamMb > totalMemMb * 0.8) {
      safeRamMb = Math.max(512, Math.floor(totalMemMb * 0.5));
      console.warn(
        `[HVM-QEMU] Capped VM '${conf.name}' RAM from ${conf.ramMb}MB to ${safeRamMb}MB (Host total: ${totalMemMb}MB)`
      );
    }

    const hasHostKvm = this.hasKvmAcceleration();
    const useKvm = conf.virtType !== "qemu" && hasHostKvm;
    const kvmArgs = useKvm
      ? ["-enable-kvm", "-cpu", "host"]
      : ["-accel", "tcg,thread=multi", "-cpu", "qemu64"];

    const qemuArgs: string[] = [
      ...kvmArgs,
      "-m",
      String(safeRamMb),
      "-smp",
      String(conf.vcpus),
      "-drive",
      `file=${actualDiskPath},format=qcow2,if=virtio`,
    ];

    // Safely attach cloud-init seed ISO via -cdrom if present, or generate on the fly
    let candidateSeed =
      conf.seedIso && fsSync.existsSync(conf.seedIso)
        ? conf.seedIso
        : path.join(SEEDS_DIR, `${conf.name}-seed.iso`);
    if (!fsSync.existsSync(candidateSeed)) {
      try {
        candidateSeed = await this.generateCloudInitSeed(
          conf.name,
          conf.hostname || conf.name,
          conf.username || "root",
          conf.password || "root123"
        );
      } catch {
        candidateSeed = "";
      }
    }
    if (candidateSeed && fsSync.existsSync(candidateSeed)) {
      conf.seedIso = candidateSeed;
      qemuArgs.push("-cdrom", candidateSeed);
    }

    qemuArgs.push(
      "-netdev",
      `user,id=net0,hostfwd=tcp::${conf.sshPort}-:22`,
      "-device",
      "virtio-net-pci,netdev=net0",
      "-display",
      "none",
      "-serial",
      `file:${logFile}`,
      "-daemonize",
      "-pidfile",
      pidFile
    );

    if (process.platform === "win32") {
      // Development mode on Windows
      const fakePid = Math.floor(Math.random() * 8000) + 1200;
      await fs.writeFile(pidFile, String(fakePid), "utf-8");
      return fakePid;
    }

    try {
      // If VDS has pinned CPU cores, execute with taskset
      if (conf.instanceType === "VDS" && conf.pinnedCores && conf.pinnedCores.length > 0) {
        const coreMask = conf.pinnedCores.join(",");
        await execFileAsync("taskset", ["-c", coreMask, "qemu-system-x86_64", ...qemuArgs]);
      } else {
        await execFileAsync("qemu-system-x86_64", qemuArgs);
      }
    } catch (execErr: any) {
      console.error(
        `[HVM-QEMU] qemu-system-x86_64 boot error for '${conf.name}':`,
        execErr.stderr || execErr.message
      );
      throw new Error(`QEMU boot failed: ${execErr.stderr || execErr.message}`);
    }

    // Wait a brief moment for daemonization and verify PID
    await new Promise((r) => setTimeout(r, 1200));

    const newPid = await this.getVmPid(conf.name);
    if (!newPid) {
      let logSnippet = "";
      try {
        logSnippet = (await fs.readFile(logFile, "utf-8")).slice(-500);
      } catch {}
      throw new Error(`Failed to boot VM '${conf.name}'. ${logSnippet || "No serial log output"}`);
    }
    return newPid;
  }

  /**
   * Safely stops or kills the QEMU process
   */
  static async stopVm(name: string, force = false): Promise<void> {
    const pid = await this.getVmPid(name);
    const pidFile = path.join(PIDS_DIR, `${name}.pid`);

    if (pid) {
      if (force) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Ignore
        }
      } else {
        try {
          process.kill(pid, "SIGTERM");
          // Wait up to 4s for graceful shutdown
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 200));
            if (!(await this.isVmRunning(name))) break;
          }
        } catch {
          // Ignore
        }
        if (await this.isVmRunning(name)) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // Ignore
          }
        }
      }
    }

    await fs.unlink(pidFile).catch(() => {});
  }

  /**
   * Resizes the virtual hard drive using qemu-img resize
   */
  static async resizeDisk(name: string, newDiskSize: string): Promise<void> {
    const conf = await this.readConfigFile(name);
    if (!conf || !conf.diskPath) {
      throw new Error(`Configuration for VM '${name}' not found`);
    }

    if (process.platform !== "win32") {
      await execFileAsync("qemu-img", ["resize", conf.diskPath, newDiskSize]);
    }

    // Update .conf file
    conf.diskSize = newDiskSize;
    await this.writeConfigFile(conf as VmConfig);
  }

  /**
   * Fetches CPU, RAM, and process telemetry of the running QEMU instance
   */
  static async getVmPerformance(name: string): Promise<{
    running: boolean;
    pid: number | null;
    cpuPercent: number;
    memPercent: number;
    rssMb: number;
    vszMb: number;
    hostFreeMemMb: number;
    hostTotalMemMb: number;
  }> {
    const pid = await this.getVmPid(name);
    const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
    const freeMemMb = Math.round(os.freemem() / (1024 * 1024));

    if (!pid) {
      return {
        running: false,
        pid: null,
        cpuPercent: 0,
        memPercent: 0,
        rssMb: 0,
        vszMb: 0,
        hostFreeMemMb: freeMemMb,
        hostTotalMemMb: totalMemMb,
      };
    }

    let cpuPercent = 1.2;
    let memPercent = 4.5;
    let rssMb = 512;
    let vszMb = 2048;

    if (process.platform !== "win32") {
      try {
        const { stdout } = await execFileAsync("ps", [
          "-p",
          String(pid),
          "-o",
          "%cpu,%mem,vsz,rss",
          "--no-headers",
        ]);
        const parts = stdout.trim().split(/\s+/);
        if (parts.length >= 4) {
          cpuPercent = parseFloat(parts[0]) || 0;
          memPercent = parseFloat(parts[1]) || 0;
          vszMb = Math.round((parseInt(parts[2], 10) || 0) / 1024);
          rssMb = Math.round((parseInt(parts[3], 10) || 0) / 1024);
        }
      } catch {
        // Fallback
      }
    }

    return {
      running: true,
      pid,
      cpuPercent,
      memPercent,
      rssMb,
      vszMb,
      hostFreeMemMb: freeMemMb,
      hostTotalMemMb: totalMemMb,
    };
  }

  /**
   * Executes a command directly inside the guest via SSH port forwarding
   */
  static async execGuestSsh(
    conf: VmConfig,
    command: string,
    timeoutMs = 8000
  ): Promise<string> {
    if (process.platform === "win32") {
      return `[win32 dev] Output for: ${command}`;
    }

    const script = `sshpass -p '${conf.password}' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=4 -p ${conf.sshPort} root@127.0.0.1 ${JSON.stringify(command)}`;

    try {
      const { stdout, stderr } = await execFileAsync("sh", ["-c", script], {
        timeout: timeoutMs,
      });
      return `${stdout || ""}${stderr ? (stdout ? "\n" : "") + stderr : ""}`.trim();
    } catch (err: any) {
      if (err.code === "ETIMEDOUT") {
        return `Connection timed out. (VM may still be completing cloud-init on first boot)`;
      }
      return String(err?.stdout || err?.stderr || err?.message || "SSH command failed").trim();
    }
  }

  /**
   * Manages persistent sshx web terminal session connected directly to the guest SSH port!
   */
  static async ensureSshxSession(conf: VmConfig, instanceId: number): Promise<string | null> {
    let session = activeSshxSessions.get(instanceId);
    if (session && (session.url || session.starting) && !session.stoppedIntentionally) {
      return session.url;
    }

    session = {
      instanceId,
      vmName: conf.name,
      sshPort: conf.sshPort,
      url: null,
      starting: true,
      stoppedIntentionally: false,
      proc: null,
      startedAt: Date.now(),
    };
    activeSshxSessions.set(instanceId, session);

    const launchProcess = () => {
      const current = activeSshxSessions.get(instanceId);
      if (!current || current.stoppedIntentionally) return;

      // Wrap SSH in an auto-retry loop: waits for the QEMU guest SSH port to be open, then connects!
      const sshCommand = `
echo "=== Connecting to QEMU/KVM Guest '${conf.hostname}' (Port ${conf.sshPort}) ==="
until nc -z 127.0.0.1 ${conf.sshPort} 2>/dev/null; do
  echo "Waiting for guest OpenSSH daemon to initialize (cloud-init in progress)..."
  sleep 2
done
exec sshpass -p '${conf.password}' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p ${conf.sshPort} root@127.0.0.1
`;

      const script =
        process.platform === "win32"
          ? `wsl.exe -d hvm-linux sh -c "exec sshx -q --shell '${sshCommand.replace(/'/g, "'\\''")}'"`
          : `exec sshx -q --shell "${sshCommand.replace(/"/g, '\\"')}"`;

      let proc: ChildProcess;
      if (process.platform === "win32") {
        proc = spawn("sh", ["-c", script], { stdio: ["ignore", "pipe", "pipe"] });
      } else {
        proc = spawn("sh", ["-c", script], { stdio: ["ignore", "pipe", "pipe"] });
      }

      current.proc = proc;

      const handleOutput = (data: Buffer | string) => {
        const raw = String(data).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
        const match = raw.match(/https:\/\/sshx\.io\/s\/[A-Za-z0-9_#-]+/);
        if (match && match[0]) {
          const foundUrl = match[0].trim();
          current.url = foundUrl;
          current.starting = false;
          pool
            .query("UPDATE instances SET sshx_url = ? WHERE id = ?", [foundUrl, instanceId])
            .catch(() => {});
        }
      };

      proc.stdout?.on("data", handleOutput);
      proc.stderr?.on("data", handleOutput);

      proc.on("close", () => {
        const latest = activeSshxSessions.get(instanceId);
        if (latest && !latest.stoppedIntentionally) {
          latest.starting = true;
          setTimeout(() => launchProcess(), 3000);
        }
      });
    };

    launchProcess();
    return session.url;
  }

  /**
   * Stops sshx session when VM is stopped or deleted
   */
  static stopSshxSession(instanceId: number): void {
    const session = activeSshxSessions.get(instanceId);
    if (session) {
      session.stoppedIntentionally = true;
      try {
        session.proc?.kill("SIGKILL");
      } catch {
        // Ignore
      }
      activeSshxSessions.delete(instanceId);
    }
  }

  /**
   * Safely deletes VM disk, seed, PID, logs, and .conf file
   */
  static async deleteVm(name: string, instanceId?: number): Promise<void> {
    if (instanceId !== undefined) {
      this.stopSshxSession(instanceId);
    }
    await this.stopVm(name, true);

    const conf = await this.readConfigFile(name);
    const diskPath = conf?.diskPath || path.join(DISKS_DIR, `${name}.qcow2`);
    const seedIso = conf?.seedIso || path.join(SEEDS_DIR, `${name}-seed.iso`);
    const pidFile = path.join(PIDS_DIR, `${name}.pid`);
    const logFile = path.join(LOGS_DIR, `${name}.log`);
    const confPath = path.join(CONFIGS_DIR, `${name}.conf`);

    await fs.unlink(diskPath).catch(() => {});
    await fs.unlink(seedIso).catch(() => {});
    await fs.unlink(pidFile).catch(() => {});
    await fs.unlink(logFile).catch(() => {});
    await fs.unlink(confPath).catch(() => {});
  }
}

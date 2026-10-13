import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import fsSync from "fs";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

export interface ServerEnvironmentInfo {
  hostname: string;
  os: string;
  kernel: string;
  cpuModel: string;
  cpuCores: number;
  ram: string;
  disk: string;
  virt: string;
  serverType: string;
  machineType: string;
  productName: string;
  sysVendor: string;
  boardName: string;
  hypervisorDetected: boolean;
  score: number;
  assessment: "Bare Metal" | "Container" | "VDS" | "VPS" | "Unknown";
  resultText: string;
  hasKvm: boolean;
  recommendedEngine: "kvm" | "qemu";
  rawOutput: string;
  detectedAt: string;
}

let cachedEnvironment: ServerEnvironmentInfo | null = null;
let lastDetectedAt = 0;

export class EnvironmentDetector {
  /**
   * Checks whether /dev/kvm is available and readable/writable by the process
   */
  static checkKvmAvailable(): boolean {
    if (process.platform === "win32") return false;
    try {
      fsSync.accessSync("/dev/kvm", fsSync.constants.R_OK | fsSync.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads a system file safely, returning trimmed string or fallback
   */
  private static async readSysFile(filePath: string, fallback = ""): Promise<string> {
    try {
      const data = await fs.readFile(filePath, "utf-8");
      return data.trim();
    } catch {
      return fallback;
    }
  }

  /**
   * Detects the full host environment following hopingboyz detect-server.sh logic
   */
  static async detect(forceRefresh = false): Promise<ServerEnvironmentInfo> {
    const now = Date.now();
    if (!forceRefresh && cachedEnvironment && now - lastDetectedAt < 30000) {
      return cachedEnvironment;
    }

    const host = os.hostname() || "localhost";
    let prettyOs = "Linux";
    let kernelVer = os.release() || "unknown";

    if (process.platform === "win32") {
      prettyOs = `Windows ${os.release()} (${os.arch()})`;
    } else {
      try {
        const osRelease = await fs.readFile("/etc/os-release", "utf-8").catch(() => "");
        const match = osRelease.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
        if (match && match[1]) {
          prettyOs = match[1];
        } else {
          const { stdout } = await execFileAsync("uname", ["-o"]).catch(() => ({ stdout: "Linux" }));
          prettyOs = stdout.trim() || "Linux";
        }
      } catch {
        prettyOs = "Linux";
      }

      try {
        const { stdout } = await execFileAsync("uname", ["-r"]).catch(() => ({ stdout: os.release() }));
        kernelVer = stdout.trim() || os.release();
      } catch {
        kernelVer = os.release();
      }
    }

    // CPU Model & Cores
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model?.trim() || "Generic Processor";
    const cpuCores = cpus.length || 1;

    // RAM
    let ramStr = `${Math.round(os.totalmem() / (1024 * 1024 * 1024))} GiB`;
    if (process.platform !== "win32") {
      try {
        const { stdout } = await execFileAsync("free", ["-h"]);
        const m = stdout.match(/^Mem:\s+(\S+)/m);
        if (m && m[1]) ramStr = m[1];
      } catch {}
    }

    // Disk
    let diskStr = "Unknown";
    if (process.platform !== "win32") {
      try {
        const { stdout } = await execFileAsync("df", ["-h", "/"]);
        const lines = stdout.trim().split("\n");
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          if (parts[1]) diskStr = parts[1];
        }
      } catch {}
    }

    // DMI Information
    const productName = await this.readSysFile("/sys/class/dmi/id/product_name", "Standard PC");
    const sysVendor = await this.readSysFile("/sys/class/dmi/id/sys_vendor", "QEMU");
    const boardName = await this.readSysFile("/sys/class/dmi/id/board_name", "Motherboard");
    const dmiInfo = `${productName} ${sysVendor} ${boardName}`.toLowerCase();

    // Virtualization Detection
    let virt = "none";
    if (process.platform !== "win32") {
      try {
        const { stdout } = await execFileAsync("systemd-detect-virt").catch(() => ({ stdout: "" }));
        const trimmed = stdout.trim().toLowerCase();
        if (trimmed && trimmed !== "none") {
          virt = trimmed;
        }
      } catch {}

      // Fallbacks matching detect-server.sh
      if (virt === "none") {
        if (fsSync.existsSync("/.dockerenv")) {
          virt = "docker";
        } else {
          try {
            const envData = await fs.readFile("/proc/1/environ", "utf-8").catch(() => "");
            if (envData.includes("container=lxc")) virt = "lxc";
          } catch {}
          if (virt === "none" && fsSync.existsSync("/proc/vz") && !fsSync.existsSync("/proc/bc")) {
            virt = "openvz";
          }
        }
      }
    }

    // Hypervisor flag in /proc/cpuinfo
    let hypervisorDetected = false;
    let score = 0;
    if (process.platform !== "win32") {
      try {
        const cpuinfo = await fs.readFile("/proc/cpuinfo", "utf-8");
        if (/flags|Features/i.test(cpuinfo) && /hypervisor/i.test(cpuinfo)) {
          hypervisorDetected = true;
          score += 2;
        }
      } catch {}
    }

    // Server Type Classification
    let serverType = "Unknown";
    switch (virt) {
      case "docker":
        serverType = "Docker Container";
        break;
      case "lxc":
        serverType = "LXC Container";
        break;
      case "podman":
        serverType = "Podman Container";
        break;
      case "openvz":
        serverType = "OpenVZ Container";
        break;
      case "kvm":
        serverType = "KVM VPS";
        break;
      case "qemu":
        serverType = "QEMU VPS";
        break;
      case "vmware":
        serverType = "VMware VM";
        break;
      case "xen":
        serverType = "Xen VPS";
        break;
      case "oracle":
        serverType = "VirtualBox VM";
        break;
      case "microsoft":
        serverType = "Hyper-V VPS";
        break;
      case "amazon":
        serverType = "Amazon EC2";
        break;
      case "google":
        serverType = "Google Cloud VM";
        break;
      case "none":
        serverType = "Bare Metal Server";
        break;
      default:
        serverType = virt ? `${virt.toUpperCase()} Virtualization` : "Standard Server";
        break;
    }

    // Machine Type Detection
    let machineType = "Standard";
    if (dmiInfo.includes("q35")) {
      machineType = "Q35";
    } else if (dmiInfo.includes("i440fx")) {
      machineType = "i440FX";
    } else if (dmiInfo.includes("kvm")) {
      machineType = "KVM";
    } else if (dmiInfo.includes("qemu")) {
      machineType = "QEMU";
    } else if (dmiInfo.includes("vmware")) {
      machineType = "VMware";
    } else if (dmiInfo.includes("virtualbox")) {
      machineType = "VirtualBox";
    } else if (dmiInfo.includes("xen")) {
      machineType = "Xen";
    } else if (dmiInfo.includes("hyper-v") || dmiInfo.includes("microsoft")) {
      machineType = "Hyper-V";
    } else if (dmiInfo.includes("proxmox")) {
      machineType = "Proxmox";
    } else if (dmiInfo.includes("openstack")) {
      machineType = "OpenStack";
    } else if (dmiInfo.includes("amazon")) {
      machineType = "Amazon EC2";
    } else if (dmiInfo.includes("google")) {
      machineType = "Google Cloud";
    } else if (dmiInfo.includes("azure")) {
      machineType = "Microsoft Azure";
    } else if (virt !== "none") {
      machineType = virt.toUpperCase();
    }

    // VPS / VDS Assessment Calculation
    let assessment: "Bare Metal" | "Container" | "VDS" | "VPS" | "Unknown" = "Unknown";
    if (["docker", "lxc", "podman", "openvz"].includes(virt)) {
      assessment = "Container";
    } else if (virt === "none") {
      assessment = "Bare Metal";
    } else {
      if (/epyc/i.test(cpuModel)) score += 2;
      if (/xeon/i.test(cpuModel)) score += 1;
      if (cpuCores >= 8) score += 1;
      if (hypervisorDetected) score += 1;

      assessment = score >= 4 ? "VDS" : "VPS";
    }

    let resultText = "";
    if (assessment === "Bare Metal") {
      resultText = "Bare Metal Server";
    } else if (assessment === "Container") {
      resultText = "Container Environment";
    } else {
      resultText = `${assessment} (${serverType})`;
    }

    const hasKvm = this.checkKvmAvailable();
    const recommendedEngine: "kvm" | "qemu" = hasKvm ? "kvm" : "qemu";

    // Formatted terminal display matching hopingboyz detect-server.sh
    const rawOutput = [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "              ADVANCED SERVER DETECTOR v3.0",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      `Hostname       : ${host}`,
      `Operating Sys  : ${prettyOs}`,
      `Kernel         : ${kernelVer}`,
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `Server Type    : ${serverType}`,
      `Virtualization : ${virt}`,
      `Machine Type   : ${machineType}`,
      "",
      `Product Name   : ${productName || "Unknown"}`,
      `System Vendor  : ${sysVendor || "Unknown"}`,
      `Board Name     : ${boardName || "Unknown"}`,
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `CPU Model      : ${cpuModel}`,
      `CPU Cores      : ${cpuCores}`,
      `RAM            : ${ramStr}`,
      `Disk Size      : ${diskStr}`,
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `Environment    : ${assessment}`,
      `Detection Score: ${score}`,
      `KVM Acceleration: ${hasKvm ? "Available (/dev/kvm enabled)" : "Disabled / Non-KVM (TCG Mode)"}`,
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `RESULT: ${resultText}`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ].join("\n");

    const envInfo: ServerEnvironmentInfo = {
      hostname: host,
      os: prettyOs,
      kernel: kernelVer,
      cpuModel,
      cpuCores,
      ram: ramStr,
      disk: diskStr,
      virt,
      serverType,
      machineType,
      productName,
      sysVendor,
      boardName,
      hypervisorDetected,
      score,
      assessment,
      resultText,
      hasKvm,
      recommendedEngine,
      rawOutput,
      detectedAt: new Date().toISOString(),
    };

    cachedEnvironment = envInfo;
    lastDetectedAt = now;
    return envInfo;
  }
}

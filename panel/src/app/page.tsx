"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Server,
  Cpu,
  HardDrive,
  Power,
  RotateCw,
  Trash2,
  ShieldCheck,
  Plus,
  KeyRound,
  ZapOff,
  Activity,
  LogOut,
  RefreshCw,
  Terminal,
  Code2,
  Copy,
  Check,
  Layers,
  X,
  FolderOpen,
  FileText,
  Monitor,
  Disc,
  Save,
  FolderPlus,
  FilePlus,
  ArrowLeft,
  Eye,
  EyeOff,
  Gauge,
  Radio,
} from "lucide-react";

interface UserInfo {
  id: number;
  username: string;
  email: string;
  plain_password?: string;
  role: "admin" | "user";
  is_suspended?: boolean;
  totp_enabled: boolean;
  created_at?: string;
}

interface OsImageOption {
  id: string;
  label: string;
  distro: string;
  filename: string;
  kernel: string;
}

interface InstanceInfo {
  id: number;
  uuid: string;
  name: string;
  hostname: string;
  root_password?: string;
  user_id: number | null;
  owner_email?: string | null;
  instance_type: "VPS" | "VDS";
  vcpus: number;
  pinned_cpus: string | null;
  ram_mb: number;
  disk_gb: number;
  disk_path: string;
  os_image: string;
  network_mode: string;
  ip_address: string | null;
  ipv6_address: string | null;
  nat_port: number | null;
  vnc_port: number | null;
  mac_address: string;
  status: "booting" | "running" | "stopped" | "paused" | "error";
  boot_progress?: number;
  sshx_url?: string | null;
  tailscale_url?: string | null;
  virt_type?: "kvm" | "qemu";
  has_host_kvm?: boolean;
}

interface CoreMetric {
  vcpu: number;
  hostCore: number | null;
  usagePercent: number;
}

interface InstanceRealtimeMetric {
  id: number;
  name: string;
  instance_type: "VPS" | "VDS";
  status: string;
  cpuPercent: number;
  cores: CoreMetric[];
  ramPercent: number;
  ramUsedMb: number;
  ramTotalMb: number;
  diskPercent: number;
  diskUsedGb: number;
  diskTotalGb: number;
  netRxKbps: number;
  netTxKbps: number;
}

interface HostRealtimeMetric {
  cpuModel: string;
  cpuPercent: number;
  cores: { coreId: number; usagePercent: number; speedMhz: number }[];
  ramPercent: number;
  ramUsedMb: number;
  ramTotalMb: number;
  diskPercent: number;
  diskUsedGb: number;
  diskTotalGb: number;
}

interface ConsoleLine {
  type: "system" | "input" | "output";
  text: string;
}

interface GuestFileItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  updated_at: string | null;
}

const DEFAULT_OS_CATALOG: OsImageOption[] = [
  { id: "ubuntu-24.04", label: "Ubuntu 24.04 LTS (Noble Numbat)", distro: "Ubuntu", filename: "ubuntu-24.04-server-cloudimg-amd64.qcow2", kernel: "6.8.0-45-generic" },
  { id: "ubuntu-22.04", label: "Ubuntu 22.04 LTS (Jammy Jellyfish)", distro: "Ubuntu", filename: "ubuntu-22.04-server-cloudimg-amd64.qcow2", kernel: "5.15.0-119-generic" },
  { id: "ubuntu-20.04", label: "Ubuntu 20.04 LTS (Focal Fossa)", distro: "Ubuntu", filename: "ubuntu-20.04-server-cloudimg-amd64.qcow2", kernel: "5.4.0-192-generic" },
  { id: "debian-13", label: "Debian 13 (Trixie)", distro: "Debian", filename: "debian-13-genericcloud-amd64.qcow2", kernel: "6.10.6-amd64" },
  { id: "debian-12", label: "Debian 12 (Bookworm)", distro: "Debian", filename: "debian-12-genericcloud-amd64.qcow2", kernel: "6.1.0-25-amd64" },
  { id: "debian-11", label: "Debian 11 (Bullseye)", distro: "Debian", filename: "debian-11-genericcloud-amd64.qcow2", kernel: "5.10.0-32-amd64" },
  { id: "almalinux-9", label: "AlmaLinux 9.4 (Seafoam Ocelot)", distro: "AlmaLinux", filename: "AlmaLinux-9-GenericCloud-latest.x86_64.qcow2", kernel: "5.14.0-427.el9" },
  { id: "rocky-9", label: "Rocky Linux 9.4 (Blue Onyx)", distro: "Rocky", filename: "Rocky-9-GenericCloud.latest.x86_64.qcow2", kernel: "5.14.0-427.el9" },
  { id: "fedora-40", label: "Fedora 40 Cloud Base", distro: "Fedora", filename: "Fedora-Cloud-Base-Generic.x86_64-40.qcow2", kernel: "6.10.7-200.fc40" },
  { id: "alpine-3.20", label: "Alpine Linux 3.20 Virtual", distro: "Alpine", filename: "alpine-virt-3.20-x86_64.qcow2", kernel: "6.6.48-0-virt" },
  { id: "arch-cloud", label: "Arch Linux Cloud (Rolling)", distro: "Arch", filename: "Arch-Linux-x86_64-cloudimg.qcow2", kernel: "6.10.8-arch1-1" },
];

const getApiBase = () => "/api";

export default function HVMDashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [activeTab, setActiveTab] = useState<"instances" | "telemetry" | "users" | "profile">("instances");
  const [filterType, setFilterType] = useState<"ALL" | "VPS" | "VDS">("ALL");
  const [statusBanner, setStatusBanner] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<number, boolean>>({});

  // Auth form state (no credentials shown or pre-filled anywhere)
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [require2FA, setRequire2FA] = useState(false);

  // Dashboard data
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [usersList, setUsersList] = useState<UserInfo[]>([]);
  const [osCatalog, setOsCatalog] = useState<OsImageOption[]>(DEFAULT_OS_CATALOG);
  const [loading, setLoading] = useState(false);

  // Real-Time Metrics State (RAM %, CPU %, Disk %, and All Cores % Usage)
  const [hostMetrics, setHostMetrics] = useState<HostRealtimeMetric | null>(null);
  const [instanceMetrics, setInstanceMetrics] = useState<Record<number, InstanceRealtimeMetric>>({});

  // Admin Provision Modal State (VPS Name, Hostname, Root Password, OS Image, IPv4/IPv6/NAT Auto-Port, SSH Port)
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [vmForm, setVmForm] = useState({
    name: "kvm-vps-01",
    hostname: "node01.hvm.local",
    root_password: "",
    instance_type: "VPS" as "VPS" | "VDS",
    vcpus: 4,
    ram_mb: 8192,
    disk_gb: 60,
    ssh_port: 2222,
    os_image: "ubuntu-24.04-server-cloudimg-amd64.qcow2",
    network_mode: "ipv4" as "ipv4" | "ipv6_only" | "dual_stack" | "nat" | "none",
    ip_address: "",
    ipv6_address: "",
    user_id: "",
    virt_type: "kvm" as "kvm" | "qemu",
  });

  // Pure QEMU/KVM VPS Engine Modals State (Show Info, Edit Config, Resize Disk, Performance)
  const [infoModalVm, setInfoModalVm] = useState<InstanceInfo | null>(null);
  const [infoData, setInfoData] = useState<any | null>(null);
  const [showPasswordInInfo, setShowPasswordInInfo] = useState<boolean>(false);

  const [editModalVm, setEditModalVm] = useState<InstanceInfo | null>(null);
  const [editForm, setEditForm] = useState({
    ram_mb: 2048,
    vcpus: 2,
    ssh_port: 2222,
    password: "",
  });
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  const [resizeModalVm, setResizeModalVm] = useState<InstanceInfo | null>(null);
  const [resizeDiskGb, setResizeDiskGb] = useState<number>(30);
  const [resizingDisk, setResizingDisk] = useState<boolean>(false);

  const [perfModalVm, setPerfModalVm] = useState<InstanceInfo | null>(null);
  const [perfData, setPerfData] = useState<any | null>(null);
  const [loadingPerf, setLoadingPerf] = useState<boolean>(false);

  // Live Real-Time Console / VNC / Boot Logs Modal State
  const [consoleVm, setConsoleVm] = useState<InstanceInfo | null>(null);
  const [consoleTab, setConsoleTab] = useState<"terminal" | "vnc" | "bootlogs">("terminal");
  const [liveConsoleFollow, setLiveConsoleFollow] = useState<boolean>(true);
  const [bootLogs, setBootLogs] = useState<string[]>([]);
  const [visibleBootLines, setVisibleBootLines] = useState<number>(0);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [consoleInput, setConsoleInput] = useState("");
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  // Automatic SSHX Link Popup Modal + Tailscale Installer Button State
  const [accessPopupVm, setAccessPopupVm] = useState<InstanceInfo | null>(null);
  const [tailscaleLoadingId, setTailscaleLoadingId] = useState<number | null>(null);
  const [tailscaleCommandLog, setTailscaleCommandLog] = useState<string>("");
  const shownSshxPopupsRef = useRef<Set<string>>(new Set());

  // File Manager Modal State (Users & Admins can access VPS/VDS files)
  const [filesVm, setFilesVm] = useState<InstanceInfo | null>(null);
  const [currentDir, setCurrentDir] = useState<string>("/root");
  const [dirItems, setDirItems] = useState<GuestFileItem[]>([]);
  const [editingFile, setEditingFile] = useState<{ path: string; content: string } | null>(null);
  const [newEntryName, setNewEntryName] = useState("");

  // Reinstall OS Modal State (Users & Admins can reinstall OS)
  const [reinstallVm, setReinstallVm] = useState<InstanceInfo | null>(null);
  const [reinstallOs, setReinstallOs] = useState<string>("ubuntu-24.04-server-cloudimg-amd64.qcow2");
  const [reinstallPassword, setReinstallPassword] = useState<string>("");

  // Profile & 2FA State
  const [profileEmail, setProfileEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [totpSetupData, setTotpSetupData] = useState<{
    secret: string;
    otpauth_uri: string;
    qr_code: string;
  } | null>(null);
  const [verifyTotpInput, setVerifyTotpInput] = useState("");

  const notify = (type: "ok" | "err", text: string) => {
    setStatusBanner({ type, text });
    setTimeout(() => setStatusBanner(null), 5000);
  };

  const copyText = (key: string, value: string) => {
    navigator.clipboard?.writeText(value);
    setCopiedId(key);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const apiFetch = useCallback(
    async (path: string, options: RequestInit = {}) => {
      const res = await fetch(`${getApiBase()}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.detail || "API request failed");
      }
      return data;
    },
    [token]
  );

  // Execute `curl -fsSL https://tailscale.com/install.sh | sh` and generate live Tailscale link
  const handleRunTailscale = async (vm: InstanceInfo) => {
    setAccessPopupVm(vm);
    setTailscaleLoadingId(vm.id);
    const hostLabel = vm.hostname || vm.name;
    setTailscaleCommandLog(
      `root@${hostLabel}:~# curl -fsSL https://tailscale.com/install.sh | sh\nInstalling Tailscale packages and starting tailscaled daemon...`
    );
    try {
      const res = await apiFetch(`/instances/${vm.id}/tailscale`, {
        method: "POST",
      });
      if (res.output) {
        setTailscaleCommandLog(res.output);
      }
      const tsUrl = res.tailscale_url || null;
      const sxUrl = res.sshx_url || vm.sshx_url || null;
      setInstances((prev) =>
        prev.map((item) =>
          Number(item.id) === Number(vm.id)
            ? { ...item, tailscale_url: tsUrl, sshx_url: sxUrl }
            : item
        )
      );
      setAccessPopupVm((prev) =>
        prev && Number(prev.id) === Number(vm.id)
          ? { ...prev, tailscale_url: tsUrl, sshx_url: sxUrl }
          : prev
      );
      setConsoleVm((prev) =>
        prev && Number(prev.id) === Number(vm.id)
          ? { ...prev, tailscale_url: tsUrl, sshx_url: sxUrl }
          : prev
      );
      if (Array.isArray(res.lines) && consoleVm && Number(consoleVm.id) === Number(vm.id)) {
        setConsoleLines(
          res.lines.map((line: string) => ({
            type: line.includes("root@") && line.includes("# ") ? "input" : "output",
            text: line,
          }))
        );
      }
      if (tsUrl) {
        notify("ok", `Tailscale installed on ${vm.name}: ${tsUrl}`);
      }
    } catch (err: any) {
      setTailscaleCommandLog((prev) => `${prev}\n[Error]: ${err.message}`);
      notify("err", err.message);
    } finally {
      setTailscaleLoadingId(null);
    }
  };

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [vmData, osData, metricsData] = await Promise.all([
        apiFetch("/instances"),
        apiFetch("/instances/os-images").catch(() => DEFAULT_OS_CATALOG),
        apiFetch("/instances/metrics").catch(() => null),
      ]);
      if (Array.isArray(vmData)) {
        setInstances(vmData);
        for (const v of vmData as InstanceInfo[]) {
          if (v.status === "running" && v.sshx_url) {
            const key = `${v.id}-${v.sshx_url}`;
            if (!shownSshxPopupsRef.current.has(key)) {
              shownSshxPopupsRef.current.add(key);
              setAccessPopupVm(v);
            }
          }
        }
      }
      if (Array.isArray(osData) && osData.length > 0) {
        setOsCatalog(osData);
      }
      if (metricsData) {
        setHostMetrics(metricsData.host || null);
        setInstanceMetrics(metricsData.instances || {});
      }
      if (user?.role === "admin") {
        const uData = await apiFetch("/admin/users");
        setUsersList(uData);
      }
    } catch (err: any) {
      notify("err", err.message);
    } finally {
      setLoading(false);
    }
  }, [token, user?.role, apiFetch]);

  useEffect(() => {
    if (token) {
      loadData();
    }
  }, [token, loadData]);

  // Poll Real-Time Metrics & Instance Boot/Started/SSHX state every 1.5 seconds
  useEffect(() => {
    if (!token) return;
    const timer = setInterval(async () => {
      try {
        const [m, vmList] = await Promise.all([
          apiFetch("/instances/metrics").catch(() => null),
          apiFetch("/instances").catch(() => null),
        ]);
        if (m) {
          setHostMetrics(m.host || null);
          setInstanceMetrics(m.instances || {});
        }
        if (Array.isArray(vmList)) {
          setInstances(vmList);
          setConsoleVm((prev) => {
            if (!prev) return null;
            const fresh = vmList.find((v: InstanceInfo) => Number(v.id) === Number(prev.id));
            return fresh ? { ...prev, ...fresh } : prev;
          });
          setAccessPopupVm((prev) => {
            if (!prev) return null;
            const fresh = vmList.find((v: InstanceInfo) => Number(v.id) === Number(prev.id));
            return fresh ? { ...prev, ...fresh } : prev;
          });
          // Automatically open SSHX Popup Modal when a booted VPS transitions to STARTED with sshx_url
          for (const v of vmList as InstanceInfo[]) {
            if (v.status === "booting" || v.status === "stopped") {
              for (const k of Array.from(shownSshxPopupsRef.current)) {
                if (k.startsWith(`${v.id}-`)) {
                  shownSshxPopupsRef.current.delete(k);
                }
              }
            } else if (v.status === "running" && v.sshx_url) {
              const popupKey = `${v.id}-${v.sshx_url}`;
              if (!shownSshxPopupsRef.current.has(popupKey)) {
                shownSshxPopupsRef.current.add(popupKey);
                setAccessPopupVm(v);
              }
            }
          }
        }
      } catch {
        // Silent background poll
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [token, apiFetch]);

  // Poll Real-Time Console & Boot Stream while Console/VNC Modal is open
  useEffect(() => {
    if (!token || !consoleVm || !liveConsoleFollow) return;
    const timer = setInterval(async () => {
      try {
        const [stream, bootRes] = await Promise.all([
          apiFetch(`/instances/${consoleVm.id}/console-stream`),
          apiFetch(`/instances/${consoleVm.id}/boot-logs`),
        ]);
        if (stream?.status) {
          setConsoleVm((prev) =>
            prev
              ? {
                  ...prev,
                  status: stream.status,
                  boot_progress: stream.boot_progress,
                  sshx_url: stream.sshx_url ?? prev.sshx_url,
                  tailscale_url: stream.tailscale_url ?? prev.tailscale_url,
                }
              : prev
          );
        }
        if (Array.isArray(stream?.lines)) {
          setConsoleLines(
            stream.lines.map((line: string) => ({
              type: line.includes("root@") && line.includes("# ") ? "input" : "output",
              text: line,
            }))
          );
        }
        if (Array.isArray(bootRes?.logs)) {
          setBootLogs(bootRes.logs);
        }
      } catch {
        // Ignore transient poll error
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [token, consoleVm?.id, liveConsoleFollow, apiFetch]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consoleLines, visibleBootLines]);

  // Animate real-time boot log streaming line by line across VNC, Serial Shell, and Boot Logs
  useEffect(() => {
    if (!consoleVm || bootLogs.length === 0) return;
    setVisibleBootLines((prev) => (prev === 0 ? 1 : prev));
    const interval = setInterval(() => {
      setVisibleBootLines((prev) => {
        if (prev >= bootLogs.length) {
          clearInterval(interval);
          return bootLogs.length;
        }
        return prev + 1;
      });
    }, 80);
    return () => clearInterval(interval);
  }, [consoleVm, bootLogs]);

  // Open Real-Time Serial Shell / Live VNC / Boot Logs Modal
  const openInstanceConsole = async (
    vm: InstanceInfo,
    initialView: "terminal" | "vnc" | "bootlogs" = "terminal"
  ) => {
    setConsoleVm(vm);
    setConsoleTab(initialView);
    setConsoleInput("");
    setVisibleBootLines(1);

    try {
      const [streamRes, bootRes] = await Promise.all([
        apiFetch(`/instances/${vm.id}/console-stream`),
        apiFetch(`/instances/${vm.id}/boot-logs`),
      ]);
      if (Array.isArray(bootRes?.logs)) {
        setBootLogs(bootRes.logs);
      }
      if (Array.isArray(streamRes?.lines)) {
        setConsoleLines(
          streamRes.lines.map((line: string) => ({
            type: line.includes("root@") && line.includes("# ") ? "input" : "output",
            text: line,
          }))
        );
      }
    } catch {
      setBootLogs(["[Hypervisor] Unable to stream boot logs"]);
    }
  };

  // Send command inside the Real-Time KVM Console
  const handleConsoleCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consoleVm) return;
    const cmd = consoleInput.trim();
    setConsoleInput("");

    if (cmd.toLowerCase() === "clear") {
      await apiFetch(`/instances/${consoleVm.id}/console`, {
        method: "POST",
        body: JSON.stringify({ command: "clear" }),
      }).catch(() => null);
      setConsoleLines([]);
      return;
    }

    const hostLabel = consoleVm.hostname || consoleVm.name;
    setConsoleLines((prev) => [
      ...prev,
      { type: "input", text: `root@${hostLabel}:~# ${cmd}` },
    ]);

    try {
      const res = await apiFetch(`/instances/${consoleVm.id}/console`, {
        method: "POST",
        body: JSON.stringify({ command: cmd }),
      });
      if (Array.isArray(res.lines)) {
        setConsoleLines(
          res.lines.map((l: string) => ({
            type: l.includes("root@") && l.includes("# ") ? "input" : "output",
            text: l,
          }))
        );
      } else if (res.output) {
        setConsoleLines((prev) => [...prev, { type: "output", text: res.output }]);
      }
    } catch (err: any) {
      setConsoleLines((prev) => [
        ...prev,
        { type: "output", text: `[Console Error]: ${err.message}` },
      ]);
    }
  };

  // File Manager Helpers
  const loadGuestDir = async (vm: InstanceInfo, targetPath: string) => {
    try {
      const res = await apiFetch(
        `/instances/${vm.id}/files?path=${encodeURIComponent(targetPath)}`
      );
      if (res.type === "file") {
        setEditingFile({ path: res.path, content: res.content });
      } else {
        setCurrentDir(res.path);
        setDirItems(res.items || []);
        setEditingFile(null);
      }
    } catch (err: any) {
      notify("err", err.message);
    }
  };

  const openFileManager = async (vm: InstanceInfo) => {
    setFilesVm(vm);
    setEditingFile(null);
    setNewEntryName("");
    await loadGuestDir(vm, "/root");
  };

  const handleSaveGuestFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!filesVm || !editingFile) return;
    try {
      await apiFetch(`/instances/${filesVm.id}/files`, {
        method: "POST",
        body: JSON.stringify({
          path: editingFile.path,
          content: editingFile.content,
          is_dir: false,
        }),
      });
      notify("ok", `Saved ${editingFile.path}`);
      setEditingFile(null);
      await loadGuestDir(filesVm, currentDir);
    } catch (err: any) {
      notify("err", err.message);
    }
  };

  const handleCreateGuestEntry = async (isDir: boolean) => {
    if (!filesVm || !newEntryName.trim()) return;
    const prefix = currentDir.endsWith("/") ? currentDir : `${currentDir}/`;
    const fullPath = `${prefix}${newEntryName.trim()}`;
    try {
      await apiFetch(`/instances/${filesVm.id}/files`, {
        method: "POST",
        body: JSON.stringify({
          path: fullPath,
          content: isDir ? undefined : "# Created via HVM File Manager\n",
          is_dir: isDir,
        }),
      });
      setNewEntryName("");
      await loadGuestDir(filesVm, currentDir);
    } catch (err: any) {
      notify("err", err.message);
    }
  };

  const handleDeleteGuestEntry = async (targetPath: string) => {
    if (!filesVm) return;
    try {
      await apiFetch(
        `/instances/${filesVm.id}/files?path=${encodeURIComponent(targetPath)}`,
        { method: "DELETE" }
      );
      await loadGuestDir(filesVm, currentDir);
    } catch (err: any) {
      notify("err", err.message);
    }
  };

  // Reinstall OS Handler
  const handleReinstallSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reinstallVm) return;
    try {
      await apiFetch(`/instances/${reinstallVm.id}/reinstall`, {
        method: "POST",
        body: JSON.stringify({
          os_image: reinstallOs,
          root_password: reinstallPassword || "root123",
        }),
      });
      notify("ok", `Reinstalled '${reinstallVm.name}' with ${reinstallOs}`);
      setReinstallVm(null);
      setReinstallPassword("");
      await loadData();
    } catch (err: any) {
      notify("err", err.message);
    }
  };

  // Login or Register
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const endpoint = isRegister ? "/auth/register" : "/auth/login";
      const data = await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify({
          identifier: email,
          username: isRegister ? username : email,
          email,
          password,
          totp_code: totpCode || undefined,
        }),
      });

      if (data.require_2fa) {
        setRequire2FA(true);
        notify("ok", "Enter your 6-digit Google Authenticator code");
        return;
      }

      setToken(data.token);
      setUser(data.user);
      setProfileEmail(data.user.email);
      setRequire2FA(false);
      setTotpCode("");
    } catch (err: any) {
      notify("err", err.message);
    }
  };

  // Power Action (Start, Stop, Reboot, Force Off)
  const handlePowerAction = async (
    instanceId: number,
    action: "start" | "stop" | "reboot" | "force_off"
  ) => {
    try {
      const res = await apiFetch(`/instances/${instanceId}/power`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      notify("ok", `Power command '${action}' executed on ${res.name || "instance"}`);
      await loadData();
      if (consoleVm && consoleVm.id === instanceId) {
        const updatedVm = { ...consoleVm, status: res.status };
        setConsoleVm(updatedVm);
        const bootRes = await apiFetch(`/instances/${instanceId}/boot-logs`).catch(() => null);
        if (bootRes?.logs) setBootLogs(bootRes.logs);
      }
    } catch (err: any) {
      notify("err", err.message);
    }
  };

  // Admin: Provision VPS or VDS
  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/admin/instances", {
        method: "POST",
        body: JSON.stringify({
          ...vmForm,
          vcpus: Number(vmForm.vcpus),
          ram_mb: Number(vmForm.ram_mb),
          disk_gb: Number(vmForm.disk_gb),
          ssh_port: Number(vmForm.ssh_port || 2222),
          user_id: vmForm.user_id ? Number(vmForm.user_id) : null,
        }),
      });
      setShowProvisionModal(false);
      notify("ok", `${vmForm.instance_type} '${vmForm.name}' deployed on KVM`);
      await loadData();
    } catch (err: any) {
      notify("err", err.message);
    }
  };

  // Admin: Assign VM to User
  const handleAssignUser = async (instanceId: number, userIdStr: string) => {
    try {
      await apiFetch(`/admin/instances/${instanceId}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ user_id: userIdStr ? Number(userIdStr) : null }),
      });
      notify("ok", "Instance assignment updated");
      await loadData();
    } catch (err: any) {
      notify("err", err.message);
    }
  };

  // Admin: Direct Delete VM
  const handleDeleteInstance = async (vm: InstanceInfo) => {
    try {
      setDeletingId(vm.id);
      await apiFetch(`/admin/instances/${vm.id}`, { method: "DELETE" });
      setInstances((prev) => prev.filter((item) => Number(item.id) !== Number(vm.id)));
      if (consoleVm && Number(consoleVm.id) === Number(vm.id)) setConsoleVm(null);
      if (filesVm && Number(filesVm.id) === Number(vm.id)) setFilesVm(null);
      notify("ok", `${vm.instance_type} '${vm.name}' destroyed and deleted`);
    } catch (err: any) {
      notify("err", err.message);
    } finally {
      setDeletingId(null);
    }
  };

  // Pure QEMU VPS Handlers: Show Info (.conf), Edit Config, Resize Disk, Performance
  const handleOpenInfo = async (vm: InstanceInfo) => {
    try {
      setInfoModalVm(vm);
      setShowPasswordInInfo(false);
      const data = await apiFetch(`/instances/${vm.id}/conf`);
      setInfoData(data);
    } catch (err: any) {
      notify("err", err.message || "Failed to load VM configuration");
    }
  };

  const handleOpenEdit = (vm: InstanceInfo) => {
    setEditModalVm(vm);
    setEditForm({
      ram_mb: vm.ram_mb,
      vcpus: vm.vcpus,
      ssh_port: vm.nat_port || 2222,
      password: vm.root_password || "",
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalVm) return;
    try {
      setSavingEdit(true);
      const res = await apiFetch(`/instances/${editModalVm.id}/config`, {
        method: "PATCH",
        body: JSON.stringify(editForm),
      });
      notify("ok", res.message || "Configuration updated");
      setEditModalVm(null);
      await loadData();
    } catch (err: any) {
      notify("err", err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleOpenResize = (vm: InstanceInfo) => {
    setResizeModalVm(vm);
    setResizeDiskGb(Math.max(vm.disk_gb + 10, 30));
  };

  const handleResizeDisk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resizeModalVm) return;
    try {
      setResizingDisk(true);
      const res = await apiFetch(`/instances/${resizeModalVm.id}/resize-disk`, {
        method: "POST",
        body: JSON.stringify({ disk_size: `${resizeDiskGb}G`, disk_gb: resizeDiskGb }),
      });
      notify("ok", res.message || "Virtual hard drive expanded");
      setResizeModalVm(null);
      await loadData();
    } catch (err: any) {
      notify("err", err.message);
    } finally {
      setResizingDisk(false);
    }
  };

  const handleOpenPerf = async (vm: InstanceInfo) => {
    try {
      setPerfModalVm(vm);
      setLoadingPerf(true);
      const data = await apiFetch(`/instances/${vm.id}/performance`);
      setPerfData(data);
    } catch (err: any) {
      notify("err", err.message || "Failed to fetch performance telemetry");
    } finally {
      setLoadingPerf(false);
    }
  };

  // Admin: Direct Delete User
  const handleDeleteUser = async (targetUser: UserInfo) => {
    try {
      await apiFetch(`/admin/users/${targetUser.id}`, { method: "DELETE" });
      setUsersList((prev) => prev.filter((u) => Number(u.id) !== Number(targetUser.id)));
      notify("ok", `User '${targetUser.username}' deleted`);
    } catch (err: any) {
      notify("err", err.message);
    }
  };

  // Profile Update
  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch("/auth/profile", {
        method: "PUT",
        body: JSON.stringify({
          email: profileEmail,
          current_password: currentPassword || undefined,
          new_password: newPassword || undefined,
        }),
      });
      setUser(res.user);
      setCurrentPassword("");
      setNewPassword("");
      notify("ok", "Profile updated successfully");
    } catch (err: any) {
      notify("err", err.message);
    }
  };

  // 2FA Setup / Enable / Disable
  const handleStart2FASetup = async () => {
    try {
      const data = await apiFetch("/auth/2fa/setup", { method: "POST" });
      setTotpSetupData(data);
    } catch (err: any) {
      notify("err", err.message);
    }
  };

  const handleConfirmEnable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/auth/2fa/enable", {
        method: "POST",
        body: JSON.stringify({ totp_code: verifyTotpInput }),
      });
      setUser((prev) => (prev ? { ...prev, totp_enabled: true } : prev));
      setTotpSetupData(null);
      setVerifyTotpInput("");
      notify("ok", "Two-Factor Authentication (2FA) enabled");
    } catch (err: any) {
      notify("err", err.message);
    }
  };

  const handleDisable2FA = async () => {
    try {
      await apiFetch("/auth/2fa/disable", { method: "POST" });
      setUser((prev) => (prev ? { ...prev, totp_enabled: false } : prev));
      setTotpSetupData(null);
      notify("ok", "Two-Factor Authentication (2FA) disabled");
    } catch (err: any) {
      notify("err", err.message);
    }
  };

  const getNetworkLabel = (vm: InstanceInfo) => {
    if (vm.network_mode === "nat" || vm.nat_port) {
      return `NON-IPv4 • AUTO NAT PORT :${vm.nat_port}`;
    }
    if (vm.network_mode === "ipv6_only") {
      return "NON-IPv4 • IPv6-ONLY";
    }
    if (vm.network_mode === "dual_stack") {
      return "DUAL-STACK (IPv4 + IPv6)";
    }
    if (vm.network_mode === "none" || !vm.ip_address || vm.ip_address.toLowerCase().includes("no ipv4")) {
      return "NON-IPv4 • ISOLATED L2";
    }
    return "IPV4 NETWORK";
  };

  const getOsLabel = (filename: string) => {
    const found = osCatalog.find((o) => o.filename === filename);
    return found ? found.label : filename;
  };

  const totalVdsCount = instances.filter((i) => i.instance_type === "VDS").length;
  const totalVpsCount = instances.filter((i) => i.instance_type === "VPS").length;
  const totalRamGb = (
    instances.reduce((acc, i) => acc + Number(i.ram_mb || 0), 0) / 1024
  ).toFixed(1);
  const runningCount = instances.filter((i) => i.status === "running").length;
  const filteredInstances = instances.filter((i) =>
    filterType === "ALL" ? true : i.instance_type === filterType
  );

  // ==========================================
  // RENDER: PURE GLASS AUTHENTICATION SCREEN
  // ==========================================
  if (!token || !user) {
    return (
      <div className="relative min-h-screen glass-grid-bg text-zinc-100 flex items-center justify-center p-4 overflow-hidden">
        <div className="pointer-events-none fixed -top-32 -left-32 w-[28rem] h-[28rem] rounded-full bg-white/[0.07] blur-[140px]" />
        <div className="pointer-events-none fixed top-1/3 -right-32 w-[26rem] h-[26rem] rounded-full bg-white/[0.05] blur-[140px]" />
        <div className="pointer-events-none fixed -bottom-32 left-1/3 w-[28rem] h-[28rem] rounded-full bg-white/[0.06] blur-[140px]" />

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="relative z-10 w-full max-w-md glass-panel rounded-3xl p-8 space-y-6"
        >
          <div className="flex items-center space-x-3.5">
            <motion.div
              whileHover={{ rotate: 6, scale: 1.05 }}
              className="p-3.5 rounded-2xl bg-white/10 border border-white/25 text-white shadow-inner"
            >
              <Server className="w-7 h-7" />
            </motion.div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-2xl font-bold tracking-tight text-white">HVM Control Panel</h1>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-white/10 border border-white/25 text-zinc-200 font-bold tracking-wider">
                  KVM
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                QEMU / Libvirt VPS (Shared) & VDS (Dedicated Pinned)
              </p>
            </div>
          </div>

          <AnimatePresence>
            {statusBanner && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="p-3.5 rounded-2xl text-xs font-medium border border-white/25 bg-white/10 text-white backdrop-blur-md"
              >
                {statusBanner.text}
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <AnimatePresence>
              {isRegister && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">Username</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                {isRegister ? "Email / Gmail Address" : "Username or Email"}
              </label>
              <input
                type={isRegister ? "email" : "text"}
                required
                placeholder={isRegister ? "Enter email address" : "Enter username or email"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Password</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
              />
            </div>

            {require2FA && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <label className="block text-xs font-medium text-zinc-200 mb-1.5">
                  Google Authenticator Code (2FA)
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  placeholder="6-digit code"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  className="w-full glass-input rounded-xl px-4 py-2.5 text-sm tracking-widest font-mono"
                />
              </motion.div>
            )}

            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              className="w-full glass-btn-primary font-semibold py-3 rounded-xl text-sm"
            >
              {isRegister ? "Create Account" : "Sign In"}
            </motion.button>
          </form>

          <div className="pt-1 text-center">
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setRequire2FA(false);
              }}
              className="text-xs text-zinc-400 hover:text-white transition underline-offset-4 hover:underline"
            >
              {isRegister
                ? "Already have an account? Sign In"
                : "Don't have an account? Register as a new User"}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ==========================================
  // RENDER: PURE GLASS MAIN PANEL (FRAMER MOTION)
  // ==========================================
  return (
    <div className="relative min-h-screen glass-grid-bg text-zinc-100 flex flex-col overflow-hidden">
      <div className="pointer-events-none fixed -top-40 left-10 w-[30rem] h-[30rem] rounded-full bg-white/[0.06] blur-[150px]" />
      <div className="pointer-events-none fixed top-1/4 right-0 w-[28rem] h-[28rem] rounded-full bg-white/[0.05] blur-[145px]" />
      <div className="pointer-events-none fixed bottom-0 left-1/3 w-[32rem] h-[32rem] rounded-full bg-white/[0.05] blur-[155px]" />

      {/* Frosted Glass Navigation Header */}
      <header className="sticky top-0 z-30 glass-panel border-x-0 border-t-0 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-3">
              <motion.div
                whileHover={{ rotate: 8, scale: 1.06 }}
                className="p-2.5 rounded-2xl bg-white/10 border border-white/25 text-white shadow-inner"
              >
                <Server className="w-5 h-5" />
              </motion.div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-lg tracking-tight text-white">HVM Panel</span>
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-white/25 bg-white/10 text-white uppercase">
                    {user.role}
                  </span>
                  <span className="flex items-center space-x-1 text-[10px] px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-zinc-200 font-mono">
                    <Radio className="w-2.5 h-2.5 animate-pulse" />
                    <span>LIVE TELEMETRY</span>
                  </span>
                </div>
                <span className="text-[11px] text-zinc-400 block">
                  {user.username} • {user.email}
                </span>
              </div>
            </div>

            <nav className="flex items-center space-x-1.5 bg-white/[0.04] p-1.5 rounded-2xl border border-white/15">
              {(
                [
                  { id: "instances", label: `Instances (${instances.length})` },
                  ...(user.role === "admin"
                    ? [
                        {
                          id: "telemetry",
                          label: `All Cores & Real-Time Usage (${hostMetrics?.cores.length || 0} Cores)`,
                        },
                        { id: "users", label: `Users (${usersList.length})` },
                      ]
                    : []),
                  { id: "profile", label: "Security & 2FA" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`relative px-4 py-1.5 rounded-xl text-xs font-semibold transition ${
                    activeTab === tab.id ? "text-white" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {activeTab === tab.id && (
                    <motion.div
                      layoutId="activeNavPill"
                      transition={{ type: "spring", stiffness: 320, damping: 28 }}
                      className="absolute inset-0 rounded-xl bg-white/20 border border-white/30 shadow"
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              ))}
            </nav>
          </div>

          <div className="flex items-center space-x-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={loadData}
              className="p-2.5 rounded-xl glass-btn"
              title="Sync Live Libvirt State"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </motion.button>
            {user.role === "admin" && (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                type="button"
                onClick={() => setShowProvisionModal(true)}
                className="flex items-center space-x-1.5 glass-btn-primary px-4 py-2.5 rounded-xl text-xs font-bold"
              >
                <Plus className="w-4 h-4" />
                <span>Create VPS / VDS</span>
              </motion.button>
            )}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              type="button"
              onClick={() => {
                setToken(null);
                setUser(null);
                setEmail("");
                setPassword("");
              }}
              className="flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl glass-btn text-xs"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </motion.button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="relative z-10 max-w-7xl w-full mx-auto p-6 flex-1 space-y-6">
        {/* Top Hypervisor Real-Time Telemetry Glass Ribbon */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              title: "Active KVM Domains",
              value: `${runningCount} / ${instances.length}`,
              sub: `VDS: ${totalVdsCount} • VPS: ${totalVpsCount}`,
              pct: instances.length > 0 ? Math.round((runningCount / instances.length) * 100) : 0,
              icon: Activity,
            },
            {
              title: "Real-Time CPU Load",
              value: `${hostMetrics?.cpuPercent ?? 0}%`,
              sub: `${hostMetrics?.cores.length ?? 0} Host Cores Active`,
              pct: hostMetrics?.cpuPercent ?? 0,
              icon: Cpu,
            },
            {
              title: "Real-Time RAM Usage",
              value: `${hostMetrics?.ramPercent ?? 0}%`,
              sub: hostMetrics
                ? `${(hostMetrics.ramUsedMb / 1024).toFixed(1)} / ${(hostMetrics.ramTotalMb / 1024).toFixed(1)} GB (${totalRamGb} GB VM Alloc)`
                : "Sampling Memory...",
              pct: hostMetrics?.ramPercent ?? 0,
              icon: Layers,
            },
            {
              title: "Real-Time Disk Usage",
              value: `${hostMetrics?.diskPercent ?? 0}%`,
              sub: hostMetrics
                ? `${hostMetrics.diskUsedGb} / ${hostMetrics.diskTotalGb} GB NVMe Pool`
                : "Sampling Storage...",
              pct: hostMetrics?.diskPercent ?? 0,
              icon: HardDrive,
            },
          ].map((stat, idx) => {
            const IconComp = stat.icon;
            return (
              <motion.div
                key={stat.title}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="glass-panel rounded-2xl p-4 flex flex-col justify-between space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[11px] uppercase tracking-wider text-zinc-400 block">
                      {stat.title}
                    </span>
                    <span className="text-2xl font-bold text-white mt-0.5 font-mono block">
                      {stat.value}
                    </span>
                  </div>
                  <div className="p-3 rounded-2xl bg-white/10 border border-white/20 text-white">
                    <IconComp className="w-5 h-5" />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, Math.max(0, stat.pct))}%` }}
                      transition={{ type: "spring", stiffness: 110, damping: 20 }}
                      className="h-full rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]"
                    />
                  </div>
                  <span className="text-[11px] text-zinc-400 block truncate">{stat.sub}</span>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* ADMIN REAL-TIME ALL-CORES CPU %, RAM % & DISK % BAR STRIP */}
        {user.role === "admin" && hostMetrics && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel rounded-3xl p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2.5">
                <Gauge className="w-4 h-4 text-white" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                  Admin Real-Time All CPU Cores Usage (%) — {hostMetrics.cpuModel}
                </h2>
              </div>
              <div className="flex items-center space-x-4 text-xs font-mono text-zinc-300">
                <span>CPU Avg: {hostMetrics.cpuPercent}%</span>
                <span>RAM: {hostMetrics.ramPercent}%</span>
                <span>Disk: {hostMetrics.diskPercent}%</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2.5">
              {hostMetrics.cores.map((core) => (
                <div
                  key={core.coreId}
                  className="glass-sub rounded-xl p-2.5 space-y-1.5 border border-white/15"
                >
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-zinc-300 font-semibold">Core #{core.coreId}</span>
                    <span className="text-white font-bold">{core.usagePercent}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <motion.div
                      animate={{ width: `${core.usagePercent}%` }}
                      transition={{ type: "spring", stiffness: 120, damping: 18 }}
                      className="h-full rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.85)]"
                    />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence>
          {statusBanner && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-4 rounded-2xl text-sm font-medium border border-white/25 bg-white/10 text-white backdrop-blur-xl flex items-center justify-between"
            >
              <span>{statusBanner.text}</span>
              <button onClick={() => setStatusBanner(null)} className="text-xs underline">
                Dismiss
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* TAB 1: INSTANCES (VPS & VDS WITH REAL-TIME CPU %, RAM %, DISK % & ALL CORES %) */}
        {activeTab === "instances" && (
          <motion.div
            key="tab-instances"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                {(["ALL", "VPS", "VDS"] as const).map((f) => (
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    key={f}
                    type="button"
                    onClick={() => setFilterType(f)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                      filterType === f ? "glass-btn-primary" : "glass-btn"
                    }`}
                  >
                    {f === "ALL"
                      ? `All Instances (${instances.length})`
                      : f === "VDS"
                      ? `Dedicated VDS (${totalVdsCount})`
                      : `Shared VPS (${totalVpsCount})`}
                  </motion.button>
                ))}
              </div>
              <span className="text-xs text-zinc-400">
                Real-Time Console • Per-Core CPU % • RAM % • Disk % • VNC • File Manager • OS Reinstall
              </span>
            </div>

            {filteredInstances.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="glass-panel rounded-3xl p-12 text-center space-y-3"
              >
                <Server className="w-10 h-10 text-zinc-300 mx-auto" />
                <h3 className="text-lg font-semibold text-white">No VPS or VDS Instances</h3>
                <p className="text-sm text-zinc-400 max-w-md mx-auto">
                  {user.role === "admin"
                    ? "No instances exist by default. Click 'Create VPS / VDS' above to deploy a new KVM instance."
                    : "You do not have any VPS or VDS instances assigned to your account yet."}
                </p>
              </motion.div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <AnimatePresence>
                  {filteredInstances.map((vm) => {
                    const netLabel = getNetworkLabel(vm);
                    const isBooting = vm.status === "booting";
                    const isRunning = vm.status === "running";
                    const liveMetric = instanceMetrics[vm.id];
                    const cpuPct = liveMetric?.cpuPercent ?? 0;
                    const ramPct = liveMetric?.ramPercent ?? 0;
                    const diskPct = liveMetric?.diskPercent ?? 6;
                    const coresList: CoreMetric[] =
                      liveMetric?.cores ||
                      Array.from({ length: vm.vcpus }, (_, idx) => ({
                        vcpu: idx,
                        hostCore: null,
                        usagePercent: 0,
                      }));

                    return (
                      <motion.div
                        layout
                        initial={{ opacity: 0, y: 18, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.94 }}
                        whileHover={{ y: -4 }}
                        transition={{ duration: 0.25 }}
                        key={vm.id}
                        className="glass-card rounded-3xl p-6 flex flex-col justify-between space-y-4"
                      >
                        <div className="space-y-4">
                          {/* Header & Booting vs Started Status Badge */}
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center space-x-2.5">
                                <span
                                  className={`w-2.5 h-2.5 rounded-full ${
                                    isRunning
                                      ? "bg-white shadow-[0_0_10px_rgba(255,255,255,0.95)]"
                                      : isBooting
                                      ? "bg-zinc-300 animate-ping"
                                      : "bg-zinc-600"
                                  }`}
                                />
                                <h3 className="font-bold text-lg text-white tracking-tight">
                                  {vm.name}
                                </h3>
                              </div>
                              <span className="text-[11px] text-zinc-400 font-mono block mt-0.5">
                                Host: {vm.hostname || vm.name} • VNC :{vm.vnc_port || 5901}
                              </span>
                            </div>

                            <div className="flex flex-col items-end space-y-1">
                              <div className="flex items-center space-x-1.5">
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                                  vm.virt_type === "qemu" || vm.has_host_kvm === false
                                    ? "border-amber-400/30 bg-amber-500/10 text-amber-300"
                                    : "border-white/20 bg-white/5 text-zinc-300"
                                }`}>
                                  {vm.virt_type === "qemu" || vm.has_host_kvm === false ? "NON-KVM" : "KVM"}
                                </span>
                                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-white/25 bg-white/10 text-white backdrop-blur-md">
                                  {vm.instance_type === "VDS" ? "VDS • DEDICATED" : "VPS • SHARED"}
                                </span>
                              </div>
                              <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border border-white/25 bg-white/15 text-white flex items-center space-x-1">
                                {isBooting ? (
                                  <>
                                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                                    <span>BOOTING ({vm.boot_progress || 20}%)</span>
                                  </>
                                ) : isRunning ? (
                                  <span>● STARTED</span>
                                ) : (
                                  <span className="text-zinc-400">○ STOPPED</span>
                                )}
                              </span>
                            </div>
                          </div>

                          {/* Persistent SSHX Live Web Terminal Strip (Shown ONLY after VPS finishes booting and is STARTED) */}
                          {isBooting && (
                            <div className="glass-sub rounded-2xl p-3 space-y-1.5 border border-white/20">
                              <div className="flex items-center justify-between text-[11px] font-mono text-zinc-200">
                                <span>Booting Kernel & Cloud-Init...</span>
                                <span>{vm.boot_progress || 20}%</span>
                              </div>
                              <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <motion.div
                                  animate={{ width: `${vm.boot_progress || 20}%` }}
                                  className="h-full rounded-full bg-white"
                                />
                              </div>
                              <p className="text-[10px] text-zinc-400 font-mono">
                                Status will show STARTED & auto-run sshx once boot completes
                              </p>
                            </div>
                          )}

                          {isRunning && (
                            <div className="glass-sub rounded-2xl p-3 space-y-2 border border-white/25">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-white/15 border border-white/25 text-white">
                                  SSHX WEB TERMINAL (NEVER STOPS)
                                </span>
                                <div className="flex items-center space-x-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setAccessPopupVm(vm)}
                                    className="px-2 py-1 rounded-lg glass-btn text-[10px] font-bold text-white"
                                    title="Open SSHX & Tailscale Popup"
                                  >
                                    SSHX Popup
                                  </button>
                                  <button
                                    type="button"
                                    disabled={tailscaleLoadingId === vm.id}
                                    onClick={() => handleRunTailscale(vm)}
                                    className="px-2.5 py-1 rounded-lg glass-btn-primary text-[10px] font-bold"
                                    title="Run curl -fsSL https://tailscale.com/install.sh | sh"
                                  >
                                    {tailscaleLoadingId === vm.id ? "Installing..." : "Tailscale"}
                                  </button>
                                  {vm.sshx_url && (
                                    <button
                                      type="button"
                                      onClick={() => copyText(`sshx-${vm.id}`, vm.sshx_url!)}
                                      className="p-1.5 rounded-lg glass-btn shrink-0"
                                      title="Copy SSHX Link"
                                    >
                                      {copiedId === `sshx-${vm.id}` ? (
                                        <Check className="w-3 h-3 text-white" />
                                      ) : (
                                        <Copy className="w-3 h-3" />
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                              {vm.sshx_url ? (
                                <a
                                  href={vm.sshx_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block text-xs font-mono text-white underline underline-offset-4 truncate hover:text-zinc-200"
                                >
                                  {vm.sshx_url}
                                </a>
                              ) : (
                                <p className="text-[11px] font-mono text-zinc-300 animate-pulse">
                                  Running curl -sSf https://sshx.io/get | sh -s run ...
                                </p>
                              )}

                              {vm.tailscale_url && (
                                <div className="pt-1.5 border-t border-white/15 space-y-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-white/15 border border-white/25 text-white">
                                      TAILSCALE AUTH LINK
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => copyText(`ts-${vm.id}`, vm.tailscale_url!)}
                                      className="p-1 rounded-lg glass-btn shrink-0"
                                      title="Copy Tailscale Link"
                                    >
                                      {copiedId === `ts-${vm.id}` ? (
                                        <Check className="w-3 h-3 text-white" />
                                      ) : (
                                        <Copy className="w-3 h-3" />
                                      )}
                                    </button>
                                  </div>
                                  <a
                                    href={vm.tailscale_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block text-xs font-mono text-white underline underline-offset-4 truncate hover:text-zinc-200"
                                  >
                                    {vm.tailscale_url}
                                  </a>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Network Address Strip (IPv4, Non-IPv4, IPv6, NAT Auto-Port) */}
                          <div className="glass-sub rounded-2xl p-3 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-md border border-white/20 bg-white/10 text-zinc-200">
                                {netLabel}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  copyText(
                                    `ip-${vm.id}`,
                                    vm.ipv6_address || vm.ip_address || vm.mac_address
                                  )
                                }
                                className="p-1.5 rounded-lg glass-btn shrink-0"
                                title="Copy Network Address"
                              >
                                {copiedId === `ip-${vm.id}` ? (
                                  <Check className="w-3 h-3 text-white" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                            <p className="text-xs font-mono text-white truncate">
                              {vm.ip_address || "No IPv4"}
                            </p>
                            {vm.ipv6_address && vm.ipv6_address !== vm.ip_address && (
                              <p className="text-[11px] font-mono text-zinc-300 truncate">
                                IPv6: {vm.ipv6_address}
                              </p>
                            )}
                          </div>

                          {/* REAL-TIME CPU %, RAM %, DISK % & ALL CORES % TELEMETRY */}
                          <div className="glass-sub rounded-2xl p-3.5 space-y-3">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-bold uppercase tracking-wider text-zinc-300 flex items-center space-x-1.5">
                                <Activity className="w-3.5 h-3.5 text-white" />
                                <span>Real-Time Resource Usage</span>
                              </span>
                              <span className="font-mono text-zinc-400">
                                {isBooting ? "BOOTING..." : isRunning ? "STARTED" : "STOPPED"}
                              </span>
                            </div>

                            {/* CPU %, RAM %, Disk % Bars */}
                            <div className="space-y-2 text-xs">
                              <div>
                                <div className="flex justify-between font-mono text-[11px] mb-1">
                                  <span className="text-zinc-300">
                                    CPU ({vm.vcpus} {vm.instance_type === "VDS" ? "Pinned" : "Shared"})
                                  </span>
                                  <span className="text-white font-bold">{cpuPct}%</span>
                                </div>
                                <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                                  <motion.div
                                    animate={{ width: `${cpuPct}%` }}
                                    transition={{ type: "spring", stiffness: 120, damping: 20 }}
                                    className="h-full rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.85)]"
                                  />
                                </div>
                              </div>

                              <div>
                                <div className="flex justify-between font-mono text-[11px] mb-1">
                                  <span className="text-zinc-300">
                                    RAM ({liveMetric?.ramUsedMb ?? 0} / {vm.ram_mb} MB)
                                  </span>
                                  <span className="text-white font-bold">{ramPct}%</span>
                                </div>
                                <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                                  <motion.div
                                    animate={{ width: `${ramPct}%` }}
                                    transition={{ type: "spring", stiffness: 120, damping: 20 }}
                                    className="h-full rounded-full bg-white/90"
                                  />
                                </div>
                              </div>

                              <div>
                                <div className="flex justify-between font-mono text-[11px] mb-1">
                                  <span className="text-zinc-300">
                                    Disk ({liveMetric?.diskUsedGb ?? 2.8} / {vm.disk_gb} GB)
                                  </span>
                                  <span className="text-white font-bold">{diskPct}%</span>
                                </div>
                                <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                                  <motion.div
                                    animate={{ width: `${diskPct}%` }}
                                    transition={{ type: "spring", stiffness: 120, damping: 20 }}
                                    className="h-full rounded-full bg-white/80"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* ALL INDIVIDUAL CORES REAL-TIME USAGE (%) */}
                            <div className="pt-2 border-t border-white/10 space-y-1.5">
                              <span className="text-[10px] uppercase tracking-wider text-zinc-400 block">
                                All Cores Real-Time Usage (%)
                              </span>
                              <div className="grid grid-cols-2 gap-1.5 max-h-28 overflow-y-auto pr-0.5">
                                {coresList.map((core) => (
                                  <div
                                    key={core.vcpu}
                                    className="px-2 py-1 rounded-lg bg-white/[0.04] border border-white/10 space-y-1"
                                  >
                                    <div className="flex items-center justify-between text-[10px] font-mono">
                                      <span className="text-zinc-300">
                                        Core #{core.vcpu}
                                        {core.hostCore !== null ? ` (Pin ${core.hostCore})` : ""}
                                      </span>
                                      <span className="text-white font-bold">
                                        {core.usagePercent}%
                                      </span>
                                    </div>
                                    <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
                                      <motion.div
                                        animate={{ width: `${core.usagePercent}%` }}
                                        transition={{ type: "spring", stiffness: 120, damping: 18 }}
                                        className="h-full rounded-full bg-white"
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="text-[11px] text-zinc-300 flex items-center justify-between">
                            <span className="truncate">
                              OS: <b className="text-white">{getOsLabel(vm.os_image)}</b>
                            </span>
                            <span className="font-mono text-zinc-400 ml-2 shrink-0">
                              root pass: {vm.root_password || "••••"}
                            </span>
                          </div>

                          {/* Admin User Assignment */}
                          {user.role === "admin" && (
                            <div className="pt-2 border-t border-white/10">
                              <label className="block text-[11px] text-zinc-300 mb-1">
                                Assigned User Account
                              </label>
                              <select
                                value={vm.user_id || ""}
                                onChange={(e) => handleAssignUser(vm.id, e.target.value)}
                                className="w-full glass-input rounded-xl px-3 py-1.5 text-xs"
                              >
                                <option value="">-- Unassigned (Admin Only) --</option>
                                {usersList.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.username} ({u.email})
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>

                        {/* Real-Time Console, VNC, Files, Reinstall & Power Controls Footer */}
                        <div className="pt-3 border-t border-white/10 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.97 }}
                              type="button"
                              onClick={() => openInstanceConsole(vm, "terminal")}
                              className="glass-btn-console py-2 px-2.5 rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5"
                            >
                              <Terminal className="w-3.5 h-3.5" />
                              <span>Real-Time Console</span>
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.97 }}
                              type="button"
                              onClick={() => openInstanceConsole(vm, "vnc")}
                              className="glass-btn-console py-2 px-2.5 rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5"
                            >
                              <Monitor className="w-3.5 h-3.5" />
                              <span>VNC & Boot Logs</span>
                            </motion.button>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.97 }}
                              type="button"
                              onClick={() => openFileManager(vm)}
                              className="glass-btn py-1.5 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                              <span>VPS Files</span>
                            </motion.button>
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.97 }}
                              type="button"
                              onClick={() => {
                                setReinstallVm(vm);
                                setReinstallOs(vm.os_image);
                                setReinstallPassword(vm.root_password || "");
                              }}
                              className="glass-btn py-1.5 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5"
                            >
                              <Disc className="w-3.5 h-3.5" />
                              <span>Reinstall OS</span>
                            </motion.button>
                          </div>

                          {/* Pure QEMU VPS Engine Controls: Show Info, Edit Config, Resize Disk, Process Performance */}
                          <div className="grid grid-cols-4 gap-1.5">
                            <motion.button
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.97 }}
                              type="button"
                              onClick={() => handleOpenInfo(vm)}
                              className="glass-btn py-1 px-1.5 rounded-xl text-[11px] font-semibold flex items-center justify-center space-x-1 text-zinc-200"
                              title="Show VM Info & .conf"
                            >
                              <FileText className="w-3 h-3" />
                              <span>Info</span>
                            </motion.button>

                            <motion.button
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.97 }}
                              type="button"
                              onClick={() => handleOpenEdit(vm)}
                              className="glass-btn py-1 px-1.5 rounded-xl text-[11px] font-semibold flex items-center justify-center space-x-1 text-zinc-200"
                              title="Edit VM Config (RAM, CPU, Port, Password)"
                            >
                              <Cpu className="w-3 h-3" />
                              <span>Edit</span>
                            </motion.button>

                            <motion.button
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.97 }}
                              type="button"
                              onClick={() => handleOpenResize(vm)}
                              className="glass-btn py-1 px-1.5 rounded-xl text-[11px] font-semibold flex items-center justify-center space-x-1 text-zinc-200"
                              title="Resize Virtual Hard Drive (qemu-img resize)"
                            >
                              <HardDrive className="w-3 h-3" />
                              <span>Resize</span>
                            </motion.button>

                            <motion.button
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.97 }}
                              type="button"
                              onClick={() => handleOpenPerf(vm)}
                              className="glass-btn py-1 px-1.5 rounded-xl text-[11px] font-semibold flex items-center justify-center space-x-1 text-zinc-200"
                              title="Show QEMU Process Telemetry"
                            >
                              <Gauge className="w-3 h-3" />
                              <span>Perf</span>
                            </motion.button>
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-1">
                            <div className="flex items-center space-x-1.5">
                              <motion.button
                                whileHover={{ scale: 1.08 }}
                                whileTap={{ scale: 0.94 }}
                                type="button"
                                onClick={() => handlePowerAction(vm.id, "start")}
                                className="p-2 rounded-xl glass-btn"
                                title="Power On"
                              >
                                <Power className="w-4 h-4" />
                              </motion.button>
                              <motion.button
                                whileHover={{ scale: 1.08 }}
                                whileTap={{ scale: 0.94 }}
                                type="button"
                                onClick={() => handlePowerAction(vm.id, "stop")}
                                className="p-2 rounded-xl glass-btn"
                                title="Power Off (ACPI Shutdown)"
                              >
                                <ZapOff className="w-4 h-4" />
                              </motion.button>
                              <motion.button
                                whileHover={{ scale: 1.08 }}
                                whileTap={{ scale: 0.94 }}
                                type="button"
                                onClick={() => handlePowerAction(vm.id, "reboot")}
                                className="p-2 rounded-xl glass-btn"
                                title="Reboot Instance"
                              >
                                <RotateCw className="w-4 h-4" />
                              </motion.button>
                            </div>

                            {user.role === "admin" && (
                              <div className="flex items-center space-x-1.5">
                                <motion.button
                                  whileHover={{ scale: 1.03 }}
                                  whileTap={{ scale: 0.96 }}
                                  type="button"
                                  onClick={() => handlePowerAction(vm.id, "force_off")}
                                  className="px-2.5 py-1.5 rounded-xl glass-btn text-xs font-medium"
                                  title="Force Destroy Power"
                                >
                                  Force Off
                                </motion.button>
                                <motion.button
                                  whileHover={{ scale: 1.03 }}
                                  whileTap={{ scale: 0.96 }}
                                  type="button"
                                  disabled={deletingId === vm.id}
                                  onClick={() => handleDeleteInstance(vm)}
                                  className="px-2.5 py-1.5 rounded-xl glass-btn text-xs font-medium flex items-center space-x-1 hover:border-white/50"
                                  title="Delete Instance"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>{deletingId === vm.id ? "..." : "Delete"}</span>
                                </motion.button>
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}

        {/* TAB 2: ADMIN DEDICATED REAL-TIME TELEMETRY (ALL CORES %, RAM %, CPU %, DISK %) */}
        {activeTab === "telemetry" && user.role === "admin" && (
          <motion.div
            key="tab-telemetry"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="glass-panel rounded-3xl p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">
                    VPS & VDS Real-Time Resource Matrix (CPU %, RAM %, Disk %, and All Cores %)
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Live telemetry polled every 1.5s from QEMU/KVM hypervisor & host kernel
                  </p>
                </div>
                <span className="text-xs font-mono px-3 py-1 rounded-full bg-white/10 border border-white/20 text-white">
                  Sampling Interval: 1500ms
                </span>
              </div>

              {instances.length === 0 ? (
                <p className="text-sm text-zinc-400 py-8 text-center">
                  No VPS or VDS instances deployed yet. Create an instance to inspect real-time per-core and resource percentages.
                </p>
              ) : (
                <div className="space-y-4">
                  {instances.map((vm) => {
                    const m = instanceMetrics[vm.id];
                    const cpuPct = m?.cpuPercent ?? 0;
                    const ramPct = m?.ramPercent ?? 0;
                    const diskPct = m?.diskPercent ?? 0;
                    const cores = m?.cores ?? [];

                    return (
                      <motion.div
                        key={vm.id}
                        layout
                        className="glass-sub rounded-2xl p-5 space-y-4 border border-white/15"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center space-x-3">
                            <span
                              className={`w-2.5 h-2.5 rounded-full ${
                                vm.status === "running"
                                  ? "bg-white shadow-[0_0_10px_rgba(255,255,255,0.9)]"
                                  : "bg-zinc-600"
                              }`}
                            />
                            <span className="font-bold text-white text-base">{vm.name}</span>
                            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-white/10 border border-white/20 text-white">
                              {vm.instance_type}
                            </span>
                            <span className="text-xs font-mono text-zinc-400">
                              {vm.ip_address || "No IPv4"}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => openInstanceConsole(vm, "terminal")}
                            className="glass-btn-console px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1.5"
                          >
                            <Terminal className="w-3.5 h-3.5" />
                            <span>Open Real-Time Console</span>
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-1.5">
                            <div className="flex justify-between text-xs font-mono">
                              <span className="text-zinc-300">Total CPU Usage</span>
                              <span className="text-white font-bold">{cpuPct}%</span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                              <motion.div
                                animate={{ width: `${cpuPct}%` }}
                                transition={{ type: "spring", stiffness: 120, damping: 20 }}
                                className="h-full rounded-full bg-white"
                              />
                            </div>
                          </div>

                          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-1.5">
                            <div className="flex justify-between text-xs font-mono">
                              <span className="text-zinc-300">
                                RAM Usage ({m?.ramUsedMb ?? 0} / {vm.ram_mb} MB)
                              </span>
                              <span className="text-white font-bold">{ramPct}%</span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                              <motion.div
                                animate={{ width: `${ramPct}%` }}
                                transition={{ type: "spring", stiffness: 120, damping: 20 }}
                                className="h-full rounded-full bg-white"
                              />
                            </div>
                          </div>

                          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-1.5">
                            <div className="flex justify-between text-xs font-mono">
                              <span className="text-zinc-300">
                                Disk Usage ({m?.diskUsedGb ?? 2.8} / {vm.disk_gb} GB)
                              </span>
                              <span className="text-white font-bold">{diskPct}%</span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                              <motion.div
                                animate={{ width: `${diskPct}%` }}
                                transition={{ type: "spring", stiffness: 120, damping: 20 }}
                                className="h-full rounded-full bg-white"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <span className="text-[11px] uppercase tracking-wider text-zinc-400 block">
                            All Assigned CPU Cores Real-Time Usage (%):
                          </span>
                          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                            {cores.map((c) => (
                              <div
                                key={c.vcpu}
                                className="p-2.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-1"
                              >
                                <div className="flex justify-between text-xs font-mono">
                                  <span className="text-zinc-300">
                                    Core #{c.vcpu}
                                    {c.hostCore !== null ? ` (Host #${c.hostCore})` : ""}
                                  </span>
                                  <span className="text-white font-bold">{c.usagePercent}%</span>
                                </div>
                                <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                                  <motion.div
                                    animate={{ width: `${c.usagePercent}%` }}
                                    transition={{ type: "spring", stiffness: 120, damping: 18 }}
                                    className="h-full rounded-full bg-white"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* TAB 3: ADMIN USER MANAGEMENT (SHOWS USERNAME, EMAIL/GMAIL, AND PASSWORD) */}
        {activeTab === "users" && user.role === "admin" && (
          <motion.div
            key="tab-users"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel rounded-3xl overflow-hidden"
          >
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Registered Users & Credentials</h2>
                <p className="text-xs text-zinc-400">
                  View registered users, their Username, Gmail/Email address, Password, 2FA status, or suspend/delete accounts.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/[0.04] text-xs uppercase text-zinc-300">
                  <tr>
                    <th className="px-6 py-3.5">ID</th>
                    <th className="px-6 py-3.5">Username</th>
                    <th className="px-6 py-3.5">Gmail / Email</th>
                    <th className="px-6 py-3.5">Password</th>
                    <th className="px-6 py-3.5">Role</th>
                    <th className="px-6 py-3.5">2FA TOTP</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {usersList.map((u) => {
                    const showPass = revealedPasswords[u.id] ?? true;
                    return (
                      <tr key={u.id} className="hover:bg-white/5">
                        <td className="px-6 py-4 font-mono text-xs">#{u.id}</td>
                        <td className="px-6 py-4 font-semibold text-white">{u.username}</td>
                        <td className="px-6 py-4 text-zinc-200 font-mono text-xs">{u.email}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-white/10 border border-white/15 text-white">
                              {showPass ? u.plain_password || "••••••" : "••••••••"}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setRevealedPasswords((prev) => ({
                                  ...prev,
                                  [u.id]: !showPass,
                                }))
                              }
                              className="p-1.5 rounded-lg glass-btn"
                              title="Toggle Password Visibility"
                            >
                              {showPass ? (
                                <EyeOff className="w-3.5 h-3.5" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => copyText(`upass-${u.id}`, u.plain_password || "")}
                              className="p-1.5 rounded-lg glass-btn"
                              title="Copy Password"
                            >
                              {copiedId === `upass-${u.id}` ? (
                                <Check className="w-3.5 h-3.5" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4 uppercase text-xs font-semibold">{u.role}</td>
                        <td className="px-6 py-4">
                          {u.totp_enabled ? (
                            <span className="text-xs text-white font-semibold">Enabled</span>
                          ) : (
                            <span className="text-xs text-zinc-500">Disabled</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2.5 py-0.5 text-xs rounded-full bg-white/10 text-white border border-white/20">
                            {u.is_suspended ? "Suspended" : "Active"}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right space-x-2">
                          {u.id !== user.id && (
                            <>
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiFetch(`/admin/users/${u.id}/suspend`, {
                                    method: "PATCH",
                                  });
                                  loadData();
                                }}
                                className="px-3 py-1 rounded-lg glass-btn text-xs"
                              >
                                {u.is_suspended ? "Unsuspend" : "Suspend"}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteUser(u)}
                                className="px-3 py-1 rounded-lg glass-btn text-xs"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {/* TAB 4: PROFILE & 2FA SECURITY */}
        {activeTab === "profile" && (
          <motion.div
            key="tab-profile"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            <form onSubmit={handleProfileSave} className="glass-panel rounded-3xl p-6 space-y-4">
              <div className="flex items-center space-x-2.5">
                <KeyRound className="w-5 h-5 text-white" />
                <h2 className="text-lg font-bold text-white">Profile Credentials</h2>
              </div>

              <div>
                <label className="block text-xs text-zinc-300 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={profileEmail}
                  onChange={(e) => setProfileEmail(e.target.value)}
                  className="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-300 mb-1">
                  Current Password (required to change password)
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-300 mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full glass-input rounded-xl px-4 py-2.5 text-sm"
                />
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="submit"
                className="glass-btn-primary text-sm font-semibold px-5 py-2.5 rounded-xl"
              >
                Save Profile Changes
              </motion.button>
            </form>

            <div className="glass-panel rounded-3xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <ShieldCheck className="w-5 h-5 text-white" />
                  <h2 className="text-lg font-bold text-white">Two-Factor Authentication (TOTP)</h2>
                </div>
                <span className="text-xs px-3 py-1 rounded-full font-semibold bg-white/10 text-white border border-white/20">
                  {user.totp_enabled ? "Enabled" : "Disabled"}
                </span>
              </div>

              <p className="text-xs text-zinc-400">
                Protect your HVM account with time-based one-time passwords (Google Authenticator,
                Authy, or 1Password).
              </p>

              {user.totp_enabled ? (
                <button
                  type="button"
                  onClick={handleDisable2FA}
                  className="glass-btn text-sm font-medium px-4 py-2.5 rounded-xl"
                >
                  Disable 2FA
                </button>
              ) : totpSetupData ? (
                <form onSubmit={handleConfirmEnable2FA} className="space-y-4 pt-2">
                  <div className="bg-white p-3 rounded-2xl w-fit mx-auto shadow-lg">
                    <img src={totpSetupData.qr_code} alt="TOTP QR Code" className="w-40 h-40" />
                  </div>
                  <p className="text-xs text-center font-mono text-zinc-200">
                    Secret Key: {totpSetupData.secret}
                  </p>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      required
                      maxLength={6}
                      placeholder="Enter 6-digit code"
                      value={verifyTotpInput}
                      onChange={(e) => setVerifyTotpInput(e.target.value)}
                      className="flex-1 glass-input rounded-xl px-3 py-2 text-sm font-mono"
                    />
                    <button
                      type="submit"
                      className="glass-btn-primary text-sm font-semibold px-4 py-2 rounded-xl"
                    >
                      Verify & Enable
                    </button>
                  </div>
                </form>
              ) : (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={handleStart2FASetup}
                  className="glass-btn-primary text-sm font-semibold px-5 py-2.5 rounded-xl"
                >
                  Configure Google Authenticator
                </motion.button>
              )}
            </div>
          </motion.div>
        )}
      </main>

      {/* ===================================================================== */}
      {/* MODAL 1: REAL-TIME SERIAL SHELL (ttyS0), LIVE VNC DISPLAY & BOOT LOGS */}
      {/* ===================================================================== */}
      <AnimatePresence>
        {consoleVm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 20, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              className="glass-panel rounded-3xl w-full max-w-6xl overflow-hidden flex flex-col max-h-[92vh]"
            >
              <div className="px-6 py-4 border-b border-white/15 flex flex-wrap items-center justify-between gap-3 bg-white/[0.03]">
                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded-xl bg-white/10 border border-white/25 text-white">
                    <Terminal className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="font-bold text-white">{consoleVm.name}</h3>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-white">
                        {consoleVm.instance_type}
                      </span>
                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase bg-white/15 border border-white/25 text-white flex items-center space-x-1">
                        {consoleVm.status === "booting" ? (
                          <>
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                            <span>BOOTING ({consoleVm.boot_progress || 20}%)</span>
                          </>
                        ) : consoleVm.status === "running" ? (
                          <span>● STARTED</span>
                        ) : (
                          <span className="text-zinc-400">○ STOPPED</span>
                        )}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 font-mono">
                      Hostname: {consoleVm.hostname || consoleVm.name} • VNC Port :
                      {consoleVm.vnc_port || 5901} • {consoleVm.ip_address || "No IPv4"}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConsoleTab("terminal")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 ${
                      consoleTab === "terminal" ? "glass-btn-primary" : "glass-btn"
                    }`}
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span>Serial Shell (ttyS0)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConsoleTab("vnc")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 ${
                      consoleTab === "vnc" ? "glass-btn-primary" : "glass-btn"
                    }`}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                    <span>Live VNC (tty1)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConsoleTab("bootlogs")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 ${
                      consoleTab === "bootlogs" ? "glass-btn-primary" : "glass-btn"
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Boot Logs</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleBootLines(1)}
                    className="px-3 py-1.5 rounded-xl glass-btn text-xs"
                    title="Replay Real-Time Boot Stream"
                  >
                    Replay Boot
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePowerAction(consoleVm.id, "reboot")}
                    className="px-3 py-1.5 rounded-xl glass-btn text-xs"
                  >
                    Ctrl+Alt+Del
                  </button>
                  <button
                    type="button"
                    onClick={() => setConsoleVm(null)}
                    className="p-2 rounded-xl glass-btn"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Persistent SSHX Live Web Terminal & Tailscale Banner inside Console Modal (Once Started) */}
              {consoleVm.status === "running" && (
                <div className="px-6 py-2.5 border-b border-white/15 bg-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-white/15 border border-white/25 text-white font-bold text-[10px]">
                      PERSISTENT SSHX (NEVER STOPS)
                    </span>
                    <span className="text-zinc-300">
                      curl -sSf https://sshx.io/get | sh -s run ➜
                    </span>
                    {consoleVm.sshx_url ? (
                      <a
                        href={consoleVm.sshx_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white font-bold underline underline-offset-4 hover:text-zinc-200"
                      >
                        {consoleVm.sshx_url}
                      </a>
                    ) : (
                      <span className="text-zinc-300 animate-pulse">
                        Starting persistent sshx session...
                      </span>
                    )}
                    {consoleVm.tailscale_url && (
                      <>
                        <span className="text-zinc-500">•</span>
                        <span className="px-2 py-0.5 rounded-md bg-white/15 border border-white/25 text-white font-bold text-[10px]">
                          TAILSCALE
                        </span>
                        <a
                          href={consoleVm.tailscale_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-white font-bold underline underline-offset-4 hover:text-zinc-200"
                        >
                          {consoleVm.tailscale_url}
                        </a>
                      </>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      disabled={tailscaleLoadingId === consoleVm.id}
                      onClick={() => handleRunTailscale(consoleVm)}
                      className="px-3 py-1 rounded-lg glass-btn-primary text-[11px] font-bold"
                      title="Run curl -fsSL https://tailscale.com/install.sh | sh"
                    >
                      {tailscaleLoadingId === consoleVm.id ? "Installing Tailscale..." : "Tailscale"}
                    </button>
                    {consoleVm.sshx_url && (
                      <>
                        <a
                          href={consoleVm.sshx_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1 rounded-lg glass-btn text-[11px] font-bold text-white"
                        >
                          Open SSHX ↗
                        </a>
                        <button
                          type="button"
                          onClick={() => copyText(`modal-sshx-${consoleVm.id}`, consoleVm.sshx_url!)}
                          className="px-2.5 py-1 rounded-lg glass-btn text-[11px] flex items-center space-x-1"
                        >
                          {copiedId === `modal-sshx-${consoleVm.id}` ? (
                            <>
                              <Check className="w-3 h-3 text-white" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy Link</span>
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Sub-View 1: Real-Time Serial Shell (ttyS0) Showing Real Boot Logs + Interactive Shell + Telemetry */}
              {consoleTab === "terminal" && (
                <div className="p-5 flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 overflow-hidden">
                  <div className="lg:col-span-2 flex flex-col space-y-3 overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-zinc-400">Quick Commands:</span>
                        {[
                          "ls -la",
                          "pwd",
                          "curl -sSf https://sshx.io/get | sh -s run",
                          "curl -fsSL https://tailscale.com/install.sh | sh",
                          "dmesg",
                          "htop",
                          "mpstat -P ALL",
                          "lscpu",
                          "free -m",
                          "df -h",
                          "ip a",
                          "uname -a",
                          "ps aux",
                          "clear",
                        ].map((shortcut) => (
                          <button
                            key={shortcut}
                            type="button"
                            onClick={async () => {
                              if (shortcut === "clear") {
                                await apiFetch(`/instances/${consoleVm.id}/console`, {
                                  method: "POST",
                                  body: JSON.stringify({ command: "clear" }),
                                }).catch(() => null);
                                setConsoleLines([]);
                                return;
                              }
                              const res = await apiFetch(`/instances/${consoleVm.id}/console`, {
                                method: "POST",
                                body: JSON.stringify({ command: shortcut }),
                              });
                              if (res.sshx_url) {
                                setConsoleVm((prev) =>
                                  prev ? { ...prev, sshx_url: res.sshx_url } : prev
                                );
                              }
                              if (Array.isArray(res.lines)) {
                                setConsoleLines(
                                  res.lines.map((l: string) => ({
                                    type:
                                      l.includes("root@") && l.includes("# ") ? "input" : "output",
                                    text: l,
                                  }))
                                );
                                setVisibleBootLines(res.lines.length);
                              }
                            }}
                            className="px-2 py-1 rounded-lg glass-btn font-mono text-[11px]"
                          >
                            {shortcut}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => setLiveConsoleFollow(!liveConsoleFollow)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-mono ${
                          liveConsoleFollow ? "glass-btn-primary" : "glass-btn"
                        }`}
                      >
                        {liveConsoleFollow ? "● Live Stream ON" : "○ Live Stream PAUSED"}
                      </button>
                    </div>

                    <div className="glass-terminal rounded-2xl p-4 font-mono text-xs flex-1 overflow-y-auto min-h-[340px] max-h-[430px] space-y-1">
                      <div className="text-zinc-400 border-b border-white/10 pb-1.5 mb-2 flex items-center justify-between text-[11px]">
                        <span>
                          QEMU/KVM Serial Console (ttyS0, 115200n8) — Real-Time Kernel & Systemd Boot Stream
                        </span>
                        <span>CONNECTED</span>
                      </div>
                      {(visibleBootLines < bootLogs.length
                        ? consoleLines.slice(0, visibleBootLines)
                        : consoleLines
                      ).map((line, idx) => (
                        <pre
                          key={idx}
                          className={`whitespace-pre-wrap break-words leading-relaxed ${
                            line.text.startsWith("[  OK  ]")
                              ? "text-white font-semibold"
                              : line.type === "input"
                              ? "text-white font-bold"
                              : "text-zinc-200"
                          }`}
                        >
                          {line.text}
                        </pre>
                      ))}
                      <div ref={terminalEndRef} />
                    </div>

                    <form onSubmit={handleConsoleCommand} className="flex items-center space-x-2">
                      <span className="font-mono text-xs text-white shrink-0">
                        root@{consoleVm.hostname || consoleVm.name}:~#
                      </span>
                      <input
                        type="text"
                        autoFocus
                        placeholder="Type real-time serial command (dmesg, htop, mpstat -P ALL, lscpu, free -m, df -h, ip a)..."
                        value={consoleInput}
                        onChange={(e) => setConsoleInput(e.target.value)}
                        className="flex-1 glass-input rounded-xl px-4 py-2.5 text-xs font-mono"
                      />
                      <button
                        type="submit"
                        className="glass-btn-primary text-xs font-bold px-5 py-2.5 rounded-xl"
                      >
                        Execute
                      </button>
                    </form>
                  </div>

                  {/* Live Real-Time Telemetry Sidebar inside Console */}
                  <div className="glass-sub rounded-2xl p-4 flex flex-col justify-between space-y-4 overflow-y-auto max-h-[500px]">
                    {(() => {
                      const m = instanceMetrics[consoleVm.id];
                      const cpuPct = m?.cpuPercent ?? 0;
                      const ramPct = m?.ramPercent ?? 0;
                      const diskPct = m?.diskPercent ?? 6;
                      const cores =
                        m?.cores ||
                        Array.from({ length: consoleVm.vcpus }, (_, i) => ({
                          vcpu: i,
                          hostCore: null,
                          usagePercent: 0,
                        }));

                      return (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between border-b border-white/10 pb-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-white">
                              Live Telemetry (%)
                            </span>
                            <span className="text-[11px] font-mono text-zinc-300">
                              1.5s Real-Time
                            </span>
                          </div>

                          <div className="space-y-3 text-xs font-mono">
                            <div>
                              <div className="flex justify-between mb-1">
                                <span className="text-zinc-300">CPU Total Usage</span>
                                <span className="text-white font-bold">{cpuPct}%</span>
                              </div>
                              <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                                <motion.div
                                  animate={{ width: `${cpuPct}%` }}
                                  className="h-full rounded-full bg-white"
                                />
                              </div>
                            </div>

                            <div>
                              <div className="flex justify-between mb-1">
                                <span className="text-zinc-300">
                                  RAM ({m?.ramUsedMb ?? 0}/{consoleVm.ram_mb} MB)
                                </span>
                                <span className="text-white font-bold">{ramPct}%</span>
                              </div>
                              <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                                <motion.div
                                  animate={{ width: `${ramPct}%` }}
                                  className="h-full rounded-full bg-white"
                                />
                              </div>
                            </div>

                            <div>
                              <div className="flex justify-between mb-1">
                                <span className="text-zinc-300">
                                  Disk ({m?.diskUsedGb ?? 2.8}/{consoleVm.disk_gb} GB)
                                </span>
                                <span className="text-white font-bold">{diskPct}%</span>
                              </div>
                              <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                                <motion.div
                                  animate={{ width: `${diskPct}%` }}
                                  className="h-full rounded-full bg-white"
                                />
                              </div>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-white/10 space-y-2">
                            <span className="text-[11px] uppercase tracking-wider text-zinc-400 block">
                              All Cores Real-Time Usage (%)
                            </span>
                            <div className="space-y-2">
                              {cores.map((c) => (
                                <div
                                  key={c.vcpu}
                                  className="p-2 rounded-xl bg-white/[0.04] border border-white/10 space-y-1"
                                >
                                  <div className="flex justify-between text-[11px] font-mono">
                                    <span className="text-zinc-300">
                                      Core #{c.vcpu}
                                      {c.hostCore !== null ? ` (Pinned #${c.hostCore})` : ""}
                                    </span>
                                    <span className="text-white font-bold">{c.usagePercent}%</span>
                                  </div>
                                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                                    <motion.div
                                      animate={{ width: `${c.usagePercent}%` }}
                                      className="h-full rounded-full bg-white"
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Sub-View 2: Live Real VNC Display (tty1) Showing Full Real-Time Boot Logs & Interactive VGA Console */}
              {consoleTab === "vnc" && (
                <div className="p-5 flex-1 flex flex-col space-y-3 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-300">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg bg-white/10 border border-white/20 font-mono text-white">
                        RFB 003.008 • VNC 0.0.0.0:{consoleVm.vnc_port || 5901} (Display :
                        {(consoleVm.vnc_port || 5901) - 5900})
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-white/[0.05] border border-white/15 font-mono text-zinc-300">
                        QEMU Standard VGA Framebuffer (1024x768 • 60Hz • tty1)
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => setVisibleBootLines(1)}
                        className="px-2.5 py-1 rounded-lg glass-btn"
                      >
                        Replay Boot Stream
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePowerAction(consoleVm.id, "start")}
                        className="px-2.5 py-1 rounded-lg glass-btn"
                      >
                        Power On
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePowerAction(consoleVm.id, "reboot")}
                        className="px-2.5 py-1 rounded-lg glass-btn"
                      >
                        Send Ctrl+Alt+Del
                      </button>
                    </div>
                  </div>

                  {/* Live VNC Graphical Monitor Framebuffer */}
                  <div className="glass-terminal rounded-2xl p-5 font-mono text-xs flex-1 overflow-y-auto min-h-[350px] max-h-[440px] border border-white/30 shadow-[inset_0_0_40px_rgba(255,255,255,0.04)] flex flex-col justify-between">
                    <div className="space-y-1">
                      <div className="text-zinc-400 border-b border-white/15 pb-2 mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span>
                          QEMU/KVM VGA BIOS • {consoleVm.name} ({consoleVm.instance_type} •{" "}
                          {consoleVm.vcpus} vCPU / {(consoleVm.ram_mb / 1024).toFixed(1)} GB RAM /{" "}
                          {consoleVm.disk_gb} GB NVMe)
                        </span>
                        <span className="text-white font-bold flex items-center space-x-1.5">
                          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                          <span>LIVE VNC STREAM (tty1)</span>
                        </span>
                      </div>

                      {/* Real-Time SeaBIOS -> GRUB -> Kernel -> systemd [  OK  ] -> Cloud-Init Boot Logs + VNC Shell */}
                      {(visibleBootLines < bootLogs.length
                        ? consoleLines.slice(0, visibleBootLines)
                        : consoleLines
                      ).map((line, idx) => (
                        <pre
                          key={idx}
                          className={`whitespace-pre-wrap break-words leading-relaxed ${
                            line.text.startsWith("[  OK  ]")
                              ? "text-white font-semibold"
                              : line.type === "input"
                              ? "text-white font-bold"
                              : "text-zinc-200"
                          }`}
                        >
                          {line.text}
                        </pre>
                      ))}
                      <div ref={terminalEndRef} />
                    </div>

                    <form
                      onSubmit={handleConsoleCommand}
                      className="pt-3 mt-3 border-t border-white/15 flex items-center space-x-2"
                    >
                      <span className="text-white font-bold shrink-0">
                        root@{consoleVm.hostname || consoleVm.name} (tty1):~#
                      </span>
                      <input
                        type="text"
                        autoFocus
                        placeholder="Type directly into Live VNC screen (e.g. dmesg, htop, mpstat -P ALL, uname -a, ip a, lscpu)..."
                        value={consoleInput}
                        onChange={(e) => setConsoleInput(e.target.value)}
                        className="flex-1 bg-transparent border-none outline-none text-white font-mono text-xs"
                      />
                      <span className="w-2 h-4 bg-white animate-pulse shrink-0" />
                      <button
                        type="submit"
                        className="px-3 py-1 rounded-lg glass-btn-primary text-[11px] font-bold"
                      >
                        Send Keystrokes
                      </button>
                    </form>
                  </div>
                </div>
              )}

              {/* Sub-View 3: Dedicated Real-Time Kernel & Systemd Boot Logs */}
              {consoleTab === "bootlogs" && (
                <div className="p-5 flex-1 flex flex-col space-y-3 overflow-hidden">
                  <div className="flex items-center justify-between text-xs text-zinc-300">
                    <span>
                      Live QEMU/KVM SeaBIOS, GRUB, Kernel & Systemd Boot Stream (
                      {getOsLabel(consoleVm.os_image)})
                    </span>
                    <button
                      type="button"
                      onClick={() => setVisibleBootLines(1)}
                      className="px-3 py-1 rounded-lg glass-btn text-[11px]"
                    >
                      Replay Boot Sequence
                    </button>
                  </div>
                  <div className="glass-terminal rounded-2xl p-4 font-mono text-xs flex-1 overflow-y-auto min-h-[340px] max-h-[440px] space-y-1">
                    {bootLogs.slice(0, visibleBootLines || bootLogs.length).map((line, i) => (
                      <pre
                        key={i}
                        className={`whitespace-pre-wrap leading-relaxed ${
                          line.startsWith("[  OK  ]") ? "text-white font-semibold" : "text-zinc-200"
                        }`}
                      >
                        {line}
                      </pre>
                    ))}
                    <div ref={terminalEndRef} />
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================================================================== */}
      {/* MODAL 2: GUEST VPS / VDS FILE MANAGER (USERS & ADMINS)                */}
      {/* ===================================================================== */}
      <AnimatePresence>
        {filesVm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50"
          >
            <motion.div
              initial={{ scale: 0.95, y: 18, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 18, opacity: 0 }}
              className="glass-panel rounded-3xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[88vh]"
            >
              <div className="px-6 py-4 border-b border-white/15 flex items-center justify-between bg-white/[0.03]">
                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded-xl bg-white/10 border border-white/25 text-white">
                    <FolderOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white">
                      VPS/VDS File Manager — {filesVm.name} ({filesVm.hostname || filesVm.name})
                    </h3>
                    <p className="text-xs text-zinc-400 font-mono">Current Path: {currentDir}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFilesVm(null)}
                  className="p-2 rounded-xl glass-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {editingFile ? (
                <form onSubmit={handleSaveGuestFile} className="p-6 space-y-4 flex-1 flex flex-col">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-white">Editing: {editingFile.path}</span>
                    <button
                      type="button"
                      onClick={() => setEditingFile(null)}
                      className="px-3 py-1 rounded-xl glass-btn text-xs flex items-center space-x-1"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back to Directory</span>
                    </button>
                  </div>
                  <textarea
                    rows={14}
                    value={editingFile.content}
                    onChange={(e) => setEditingFile({ ...editingFile, content: e.target.value })}
                    className="w-full glass-terminal rounded-2xl p-4 font-mono text-xs text-white outline-none"
                  />
                  <div className="flex justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => setEditingFile(null)}
                      className="px-4 py-2 rounded-xl glass-btn text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-xl glass-btn-primary text-xs font-bold flex items-center space-x-1.5"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Save File to Guest Disk</span>
                    </button>
                  </div>
                </form>
              ) : (
                <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center space-x-2">
                      {["/", "/root", "/etc", "/etc/netplan", "/var/log", "/home"].map((dir) => (
                        <button
                          key={dir}
                          type="button"
                          onClick={() => loadGuestDir(filesVm, dir)}
                          className={`px-3 py-1 rounded-xl text-xs font-mono ${
                            currentDir === dir ? "glass-btn-primary" : "glass-btn"
                          }`}
                        >
                          {dir}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        placeholder="New file or folder name..."
                        value={newEntryName}
                        onChange={(e) => setNewEntryName(e.target.value)}
                        className="glass-input rounded-xl px-3 py-1.5 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => handleCreateGuestEntry(false)}
                        className="px-3 py-1.5 rounded-xl glass-btn text-xs flex items-center space-x-1"
                      >
                        <FilePlus className="w-3.5 h-3.5" />
                        <span>New File</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCreateGuestEntry(true)}
                        className="px-3 py-1.5 rounded-xl glass-btn text-xs flex items-center space-x-1"
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                        <span>New Folder</span>
                      </button>
                    </div>
                  </div>

                  <div className="glass-sub rounded-2xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-white/[0.04] uppercase text-zinc-400">
                        <tr>
                          <th className="px-4 py-3">Name</th>
                          <th className="px-4 py-3">Type</th>
                          <th className="px-4 py-3">Size</th>
                          <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {currentDir !== "/" && (
                          <tr
                            onClick={() => {
                              const parent =
                                currentDir.split("/").slice(0, -1).join("/") || "/";
                              loadGuestDir(filesVm, parent);
                            }}
                            className="hover:bg-white/5 cursor-pointer"
                          >
                            <td className="px-4 py-3 font-mono text-white" colSpan={4}>
                              .. (Parent Directory)
                            </td>
                          </tr>
                        )}
                        {dirItems.map((item) => (
                          <tr key={item.path} className="hover:bg-white/5">
                            <td
                              onClick={() => loadGuestDir(filesVm, item.path)}
                              className="px-4 py-3 font-mono text-white cursor-pointer flex items-center space-x-2"
                            >
                              {item.is_dir ? (
                                <FolderOpen className="w-4 h-4 text-zinc-300" />
                              ) : (
                                <FileText className="w-4 h-4 text-zinc-400" />
                              )}
                              <span>{item.name}</span>
                            </td>
                            <td className="px-4 py-3 text-zinc-400">
                              {item.is_dir ? "Directory" : "File"}
                            </td>
                            <td className="px-4 py-3 font-mono text-zinc-400">
                              {item.is_dir ? "-" : `${item.size} B`}
                            </td>
                            <td className="px-4 py-3 text-right space-x-2">
                              <button
                                type="button"
                                onClick={() => loadGuestDir(filesVm, item.path)}
                                className="px-2.5 py-1 rounded-lg glass-btn"
                              >
                                {item.is_dir ? "Open" : "Edit"}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteGuestEntry(item.path)}
                                className="px-2.5 py-1 rounded-lg glass-btn"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================================================================== */}
      {/* MODAL 3: REINSTALL OS (UBUNTU 22/24, DEBIAN 12/13, ALMALINUX, ETC.)   */}
      {/* ===================================================================== */}
      <AnimatePresence>
        {reinstallVm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50"
          >
            <motion.form
              initial={{ scale: 0.94, y: 16, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, y: 16, opacity: 0 }}
              onSubmit={handleReinstallSubmit}
              className="glass-panel rounded-3xl p-7 w-full max-w-md space-y-5"
            >
              <div className="flex items-center justify-between border-b border-white/15 pb-3">
                <div>
                  <h2 className="text-lg font-bold text-white">
                    Reinstall OS — {reinstallVm.name}
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Select a new operating system image and root password
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReinstallVm(null)}
                  className="p-1.5 rounded-xl glass-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="block text-xs text-zinc-300 mb-1.5">
                  Select Operating System Image
                </label>
                <select
                  value={reinstallOs}
                  onChange={(e) => setReinstallOs(e.target.value)}
                  className="w-full glass-input rounded-xl px-3 py-2.5 text-sm"
                >
                  {osCatalog.map((os) => (
                    <option key={os.id} value={os.filename}>
                      {os.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-300 mb-1.5">
                  New Root Password
                </label>
                <input
                  type="text"
                  required
                  placeholder="Enter new root password"
                  value={reinstallPassword}
                  onChange={(e) => setReinstallPassword(e.target.value)}
                  className="w-full glass-input rounded-xl px-3 py-2.5 text-sm font-mono"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setReinstallVm(null)}
                  className="px-4 py-2 rounded-xl glass-btn text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl glass-btn-primary text-xs font-bold"
                >
                  Confirm OS Reinstall
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================================================================== */}
      {/* MODAL 4: ADMIN CREATE VPS / VDS (NAME, HOSTNAME, PASSWORD, OS, NAT)   */}
      {/* ===================================================================== */}
      <AnimatePresence>
        {showProvisionModal && user.role === "admin" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50"
          >
            <motion.form
              initial={{ scale: 0.94, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, y: 20, opacity: 0 }}
              onSubmit={handleProvisionSubmit}
              className="glass-panel rounded-3xl p-7 w-full max-w-2xl space-y-5 max-h-[92vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-white/15 pb-3">
                <div>
                  <h2 className="text-lg font-bold text-white">Create New KVM VPS / VDS</h2>
                  <p className="text-xs text-zinc-400">
                    Set VPS Name, Hostname, Root Password, OS Image, and IPv4 / IPv6 / Auto-Port NAT
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowProvisionModal(false)}
                  className="p-1.5 rounded-xl glass-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* VPS vs VDS Toggle */}
              <div className="grid grid-cols-2 gap-3 p-1.5 glass-sub rounded-2xl">
                {(["VPS", "VDS"] as const).map((type) => (
                  <button
                    type="button"
                    key={type}
                    onClick={() => setVmForm({ ...vmForm, instance_type: type })}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold transition ${
                      vmForm.instance_type === type
                        ? "glass-btn-primary"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    {type === "VPS"
                      ? "VPS (Shared CPU / Balloon RAM)"
                      : "VDS (Pinned CPU / Locked RAM)"}
                  </button>
                ))}
              </div>

              {/* Virtualization Acceleration: KVM vs Non-KVM */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-zinc-300">
                  Virtualization Acceleration Engine
                </label>
                <div className="grid grid-cols-2 gap-3 p-1.5 glass-sub rounded-2xl">
                  <button
                    type="button"
                    onClick={() => setVmForm({ ...vmForm, virt_type: "kvm" })}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold transition ${
                      vmForm.virt_type === "kvm"
                        ? "glass-btn-primary"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    ⚡ KVM Hardware Acceleration
                  </button>
                  <button
                    type="button"
                    onClick={() => setVmForm({ ...vmForm, virt_type: "qemu" })}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold transition ${
                      vmForm.virt_type === "qemu"
                        ? "glass-btn-primary"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    🌐 Non-KVM / QEMU TCG (Universal)
                  </button>
                </div>
              </div>

              {/* Name, Hostname, Root Password */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">VPS / VDS Name</label>
                  <input
                    required
                    placeholder="kvm-vps-01"
                    value={vmForm.name}
                    onChange={(e) => setVmForm({ ...vmForm, name: e.target.value })}
                    className="w-full glass-input rounded-xl px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Guest Hostname</label>
                  <input
                    required
                    placeholder="node01.hvm.local"
                    value={vmForm.hostname}
                    onChange={(e) => setVmForm({ ...vmForm, hostname: e.target.value })}
                    className="w-full glass-input rounded-xl px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Root Password</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter root password"
                    value={vmForm.root_password}
                    onChange={(e) => setVmForm({ ...vmForm, root_password: e.target.value })}
                    className="w-full glass-input rounded-xl px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              {/* Operating System Image Selector */}
              <div>
                <label className="block text-xs text-zinc-300 mb-1">
                  Operating System (Ubuntu 22/24, Debian 12/13, AlmaLinux, Rocky, Fedora, Alpine, Arch)
                </label>
                <select
                  value={vmForm.os_image}
                  onChange={(e) => setVmForm({ ...vmForm, os_image: e.target.value })}
                  className="w-full glass-input rounded-xl px-3 py-2.5 text-sm"
                >
                  {osCatalog.map((os) => (
                    <option key={os.id} value={os.filename}>
                      {os.label} ({os.filename})
                    </option>
                  ))}
                </select>
              </div>

              {/* Network Stack Selector (IPv4, IPv6-Only, Dual-Stack, NAT Auto-Port, Isolated L2) */}
              <div>
                <label className="block text-xs font-semibold text-zinc-200 mb-2">
                  Network Mode (IPv4, Non-IPv4, IPv6, or Auto-Port NAT)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { id: "ipv4", label: "IPv4" },
                    { id: "ipv6_only", label: "IPv6-Only (No IPv4)" },
                    { id: "dual_stack", label: "IPv4 + IPv6" },
                    { id: "nat", label: "NAT (Auto Port)" },
                    { id: "none", label: "Isolated (No IP)" },
                  ].map((mode) => (
                    <button
                      type="button"
                      key={mode.id}
                      onClick={() =>
                        setVmForm({
                          ...vmForm,
                          network_mode: mode.id as any,
                        })
                      }
                      className={`py-2 px-2.5 rounded-xl text-[11px] font-semibold transition ${
                        vmForm.network_mode === mode.id ? "glass-btn-primary" : "glass-btn"
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Conditional IP Inputs based on Network Mode */}
              {vmForm.network_mode === "nat" ? (
                <div className="glass-sub rounded-2xl p-3 text-xs text-zinc-300">
                  NAT Mode Selected: HVM Daemon will automatically scan and assign an{" "}
                  <b className="text-white">unused host port</b> (e.g. `:10022`) with zero public IPv4 required.
                </div>
              ) : vmForm.network_mode === "none" ? (
                <div className="glass-sub rounded-2xl p-3 text-xs text-zinc-300">
                  Isolated L2 Mode: Instance will be created without IPv4 or IPv6 addresses.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {(vmForm.network_mode === "ipv4" || vmForm.network_mode === "dual_stack") && (
                    <div>
                      <label className="block text-xs text-zinc-300 mb-1">
                        IPv4 Address (leave blank to auto-assign)
                      </label>
                      <input
                        value={vmForm.ip_address}
                        placeholder="192.168.122.105"
                        onChange={(e) => setVmForm({ ...vmForm, ip_address: e.target.value })}
                        className="w-full glass-input rounded-xl px-3 py-2 text-sm font-mono"
                      />
                    </div>
                  )}
                  {(vmForm.network_mode === "ipv6_only" || vmForm.network_mode === "dual_stack") && (
                    <div>
                      <label className="block text-xs text-zinc-300 mb-1">
                        IPv6 Address (leave blank to auto-assign)
                      </label>
                      <input
                        value={vmForm.ipv6_address}
                        placeholder="fd00:hvm:2026::105/64"
                        onChange={(e) => setVmForm({ ...vmForm, ipv6_address: e.target.value })}
                        className="w-full glass-input rounded-xl px-3 py-2 text-sm font-mono"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">
                    {vmForm.instance_type === "VDS" ? "Pinned CPU Cores" : "Shared vCPUs"}
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={vmForm.vcpus}
                    onChange={(e) => setVmForm({ ...vmForm, vcpus: Number(e.target.value) })}
                    className="w-full glass-input rounded-xl px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">
                    {vmForm.instance_type === "VDS" ? "Locked RAM (MB)" : "RAM (MB)"}
                  </label>
                  <input
                    type="number"
                    min={512}
                    step={512}
                    required
                    value={vmForm.ram_mb}
                    onChange={(e) => setVmForm({ ...vmForm, ram_mb: Number(e.target.value) })}
                    className="w-full glass-input rounded-xl px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Disk Size (GB)</label>
                  <input
                    type="number"
                    min={5}
                    required
                    value={vmForm.disk_gb}
                    onChange={(e) => setVmForm({ ...vmForm, disk_gb: Number(e.target.value) })}
                    className="w-full glass-input rounded-xl px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">SSH Port</label>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    placeholder="2222"
                    value={vmForm.ssh_port}
                    onChange={(e) => setVmForm({ ...vmForm, ssh_port: Number(e.target.value) })}
                    className="w-full glass-input rounded-xl px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-300 mb-1">Assign to User</label>
                  <select
                    value={vmForm.user_id}
                    onChange={(e) => setVmForm({ ...vmForm, user_id: e.target.value })}
                    className="w-full glass-input rounded-xl px-3 py-2 text-sm"
                  >
                    <option value="">-- Unassigned --</option>
                    {usersList.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.username} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowProvisionModal(false)}
                  className="px-4 py-2 rounded-xl glass-btn text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl glass-btn-primary text-xs font-bold"
                >
                  Create {vmForm.instance_type} Instance
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================================================================== */}
      {/* MODAL 5: SSHX LINK POPUP & TAILSCALE INSTALLER MODAL (AUTO-OPENS)     */}
      {/* ===================================================================== */}
      <AnimatePresence>
        {accessPopupVm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, y: 20, opacity: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 24 }}
              className="glass-panel rounded-3xl p-7 w-full max-w-xl space-y-5 border border-white/25"
            >
              {/* Header */}
              <div className="flex items-start justify-between border-b border-white/15 pb-4">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.95)]" />
                    <h2 className="text-lg font-bold text-white tracking-tight">
                      {accessPopupVm.name} — Live SSHX & Tailscale Access
                    </h2>
                    <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border border-white/25 bg-white/15 text-white">
                      ● STARTED
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 font-mono">
                    Hostname: {accessPopupVm.hostname || accessPopupVm.name} •{" "}
                    {accessPopupVm.instance_type}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAccessPopupVm(null)}
                  className="p-2 rounded-xl glass-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Section 1: Persistent SSHX Web Terminal Link */}
              <div className="glass-sub rounded-2xl p-4 space-y-3 border border-white/25">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-md bg-white/15 border border-white/25 text-white">
                      PERSISTENT SSHX SESSION (NEVER STOPS)
                    </span>
                    <p className="text-[11px] font-mono text-zinc-400 mt-1">
                      $ curl -sSf https://sshx.io/get | sh -s run
                    </p>
                  </div>
                  {accessPopupVm.sshx_url && (
                    <button
                      type="button"
                      onClick={() => copyText(`popup-sshx-${accessPopupVm.id}`, accessPopupVm.sshx_url!)}
                      className="px-3 py-1.5 rounded-xl glass-btn text-xs font-semibold flex items-center space-x-1.5"
                    >
                      {copiedId === `popup-sshx-${accessPopupVm.id}` ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-white" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Link</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {accessPopupVm.sshx_url ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-black/50 border border-white/20">
                    <a
                      href={accessPopupVm.sshx_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-mono font-bold text-white underline underline-offset-4 break-all hover:text-zinc-200"
                    >
                      {accessPopupVm.sshx_url}
                    </a>
                    <a
                      href={accessPopupVm.sshx_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 rounded-xl glass-btn-primary text-xs font-bold shrink-0 text-center"
                    >
                      Open SSHX Terminal ↗
                    </a>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-black/40 border border-white/15 text-xs font-mono text-zinc-300 animate-pulse">
                    Starting persistent sshx session (curl -sSf https://sshx.io/get | sh -s run)...
                  </div>
                )}
              </div>

              {/* Section 2: Tailscale Button & Live Tailscale Link */}
              <div className="glass-sub rounded-2xl p-4 space-y-3 border border-white/25">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-md bg-white/15 border border-white/25 text-white">
                      TAILSCALE MESH VPN INSTALLER
                    </span>
                    <p className="text-[11px] font-mono text-zinc-400 mt-1">
                      $ curl -fsSL https://tailscale.com/install.sh | sh
                    </p>
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    type="button"
                    disabled={tailscaleLoadingId === accessPopupVm.id}
                    onClick={() => handleRunTailscale(accessPopupVm)}
                    className="px-5 py-2.5 rounded-xl glass-btn-primary text-xs font-bold flex items-center space-x-2"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span>
                      {tailscaleLoadingId === accessPopupVm.id
                        ? "Running Tailscale Install..."
                        : "Tailscale"}
                    </span>
                  </motion.button>
                </div>

                {tailscaleCommandLog && (
                  <pre className="p-3 rounded-xl bg-black/60 border border-white/15 text-[11px] font-mono text-zinc-200 whitespace-pre-wrap max-h-36 overflow-y-auto">
                    {tailscaleCommandLog}
                  </pre>
                )}

                {accessPopupVm.tailscale_url && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-black/50 border border-white/25">
                    <div className="space-y-0.5 overflow-hidden">
                      <span className="text-[10px] font-mono uppercase text-zinc-400 block">
                        Tailscale Authentication Link:
                      </span>
                      <a
                        href={accessPopupVm.tailscale_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-mono font-bold text-white underline underline-offset-4 break-all hover:text-zinc-200 block"
                      >
                        {accessPopupVm.tailscale_url}
                      </a>
                    </div>
                    <div className="flex items-center space-x-2 shrink-0">
                      <a
                        href={accessPopupVm.tailscale_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3.5 py-2 rounded-xl glass-btn-primary text-xs font-bold"
                      >
                        Open Tailscale ↗
                      </a>
                      <button
                        type="button"
                        onClick={() =>
                          copyText(`popup-ts-${accessPopupVm.id}`, accessPopupVm.tailscale_url!)
                        }
                        className="px-3 py-2 rounded-xl glass-btn text-xs font-semibold flex items-center space-x-1"
                      >
                        {copiedId === `popup-ts-${accessPopupVm.id}` ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-white" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const target = accessPopupVm;
                    setAccessPopupVm(null);
                    openInstanceConsole(target, "terminal");
                  }}
                  className="px-4 py-2 rounded-xl glass-btn text-xs font-semibold flex items-center space-x-1.5"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Open Full Serial Console</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAccessPopupVm(null)}
                  className="px-5 py-2 rounded-xl glass-btn-primary text-xs font-bold"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================================================================== */}
      {/* MODAL 6: SHOW VM INFO & .CONF FILE                                    */}
      {/* ===================================================================== */}
      <AnimatePresence>
        {infoModalVm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, y: 20, opacity: 0 }}
              className="glass-panel rounded-3xl p-6 w-full max-w-2xl space-y-4 border border-white/25 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-white/15 pb-3">
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-white" />
                  <h2 className="text-base font-bold text-white tracking-tight">
                    {infoModalVm.name} — VM Info & .conf State
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setInfoModalVm(null)}
                  className="p-1.5 rounded-xl glass-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* SSH Connection Command Bar */}
              <div className="glass-sub rounded-2xl p-3.5 space-y-2 border border-white/20">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase text-zinc-300">
                    SSH Connection Command
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        `ssh-cmd-${infoModalVm.id}`,
                        `ssh -p ${infoData?.ssh_port || infoModalVm.nat_port || 2222} root@localhost`
                      )
                    }
                    className="px-2.5 py-1 rounded-lg glass-btn text-xs font-semibold flex items-center space-x-1"
                  >
                    {copiedId === `ssh-cmd-${infoModalVm.id}` ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-white" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="p-2.5 rounded-xl bg-black/60 border border-white/15 font-mono text-xs text-white break-all select-all">
                  ssh -p {infoData?.ssh_port || infoModalVm.nat_port || 2222} root@localhost
                </div>
              </div>

              {/* Specs Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="glass-sub rounded-xl p-3 border border-white/10 space-y-1">
                  <span className="text-[10px] text-zinc-400 block uppercase font-mono">Hostname</span>
                  <span className="font-semibold text-white truncate block">
                    {infoData?.hostname || infoModalVm.hostname || infoModalVm.name}
                  </span>
                </div>
                <div className="glass-sub rounded-xl p-3 border border-white/10 space-y-1">
                  <span className="text-[10px] text-zinc-400 block uppercase font-mono">SSH Port</span>
                  <span className="font-mono font-semibold text-white">
                    :{infoData?.ssh_port || infoModalVm.nat_port || 2222}
                  </span>
                </div>
                <div className="glass-sub rounded-xl p-3 border border-white/10 space-y-1">
                  <span className="text-[10px] text-zinc-400 block uppercase font-mono">RAM</span>
                  <span className="font-semibold text-white">
                    {infoData?.ram_mb || infoModalVm.ram_mb} MB
                  </span>
                </div>
                <div className="glass-sub rounded-xl p-3 border border-white/10 space-y-1">
                  <span className="text-[10px] text-zinc-400 block uppercase font-mono">Virtual Disk</span>
                  <span className="font-semibold text-white">
                    {infoData?.disk_size || `${infoModalVm.disk_gb}G`}
                  </span>
                </div>
              </div>

              {/* Credentials Bar */}
              <div className="glass-sub rounded-2xl p-3.5 space-y-2 border border-white/20">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase text-zinc-300">
                    Root Credentials
                  </span>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => setShowPasswordInInfo(!showPasswordInInfo)}
                      className="px-2.5 py-1 rounded-lg glass-btn text-xs font-semibold flex items-center space-x-1"
                    >
                      {showPasswordInInfo ? (
                        <>
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>Hide</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          <span>Show</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(`pass-${infoModalVm.id}`, infoData?.password || infoModalVm.root_password || "")
                      }
                      className="px-2.5 py-1 rounded-lg glass-btn text-xs font-semibold flex items-center space-x-1"
                    >
                      {copiedId === `pass-${infoModalVm.id}` ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-white" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Pass</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex items-center space-x-4 text-xs font-mono">
                  <span className="text-zinc-400">User: <b className="text-white">root</b></span>
                  <span className="text-zinc-400">
                    Password:{" "}
                    <b className="text-white">
                      {showPasswordInInfo
                        ? infoData?.password || infoModalVm.root_password || "••••••••"
                        : "••••••••"}
                    </b>
                  </span>
                </div>
              </div>

              {/* Raw .conf File Display */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase text-zinc-400">
                    Local Configuration File (/var/lib/hvm-vps/configs/{infoModalVm.name}.conf):
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText(`conf-${infoModalVm.id}`, infoData?.raw_conf || "")}
                    className="text-[11px] text-zinc-300 hover:text-white underline font-mono"
                  >
                    Copy .conf
                  </button>
                </div>
                <pre className="p-3 rounded-2xl bg-black/70 border border-white/20 font-mono text-[11px] text-zinc-300 max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {infoData?.raw_conf || "Loading configuration..."}
                </pre>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setInfoModalVm(null)}
                  className="px-5 py-2 rounded-xl glass-btn-primary text-xs font-bold"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================================================================== */}
      {/* MODAL 7: EDIT VM CONFIG (RAM, VCPUS, SSH PORT, PASSWORD)               */}
      {/* ===================================================================== */}
      <AnimatePresence>
        {editModalVm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50"
          >
            <motion.form
              onSubmit={handleSaveEdit}
              initial={{ scale: 0.94, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, y: 20, opacity: 0 }}
              className="glass-panel rounded-3xl p-6 w-full max-w-lg space-y-4 border border-white/25"
            >
              <div className="flex items-center justify-between border-b border-white/15 pb-3">
                <div className="flex items-center space-x-2">
                  <Cpu className="w-4 h-4 text-white" />
                  <h2 className="text-base font-bold text-white tracking-tight">
                    Edit Config — {editModalVm.name}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setEditModalVm(null)}
                  className="p-1.5 rounded-xl glass-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-zinc-400">
                Modify RAM, CPU cores, SSH forwarding port, or root password. Changes are saved to the VM&apos;s local .conf file.
              </p>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-zinc-300 mb-1">RAM (MB)</label>
                  <input
                    type="number"
                    min={512}
                    step={512}
                    required
                    value={editForm.ram_mb}
                    onChange={(e) => setEditForm({ ...editForm, ram_mb: Number(e.target.value) })}
                    className="w-full glass-input rounded-xl px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-zinc-300 mb-1">CPU Cores</label>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    required
                    value={editForm.vcpus}
                    onChange={(e) => setEditForm({ ...editForm, vcpus: Number(e.target.value) })}
                    className="w-full glass-input rounded-xl px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-zinc-300 mb-1">SSH Forwarding Port</label>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    required
                    value={editForm.ssh_port}
                    onChange={(e) => setEditForm({ ...editForm, ssh_port: Number(e.target.value) })}
                    className="w-full glass-input rounded-xl px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-zinc-300 mb-1">Root Password</label>
                  <input
                    type="text"
                    required
                    value={editForm.password}
                    onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                    className="w-full glass-input rounded-xl px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-black/40 border border-white/10 text-[11px] text-zinc-400">
                Note: Updating the password will automatically regenerate the Cloud-Init seed ISO. If the VM is currently running, reboot it to apply new memory and CPU limits.
              </div>

              <div className="flex justify-end space-x-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setEditModalVm(null)}
                  className="px-4 py-2 rounded-xl glass-btn text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2 rounded-xl glass-btn-primary text-xs font-bold"
                >
                  {savingEdit ? "Saving..." : "Save Config"}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================================================================== */}
      {/* MODAL 8: RESIZE VM DISK (QEMU-IMG RESIZE)                              */}
      {/* ===================================================================== */}
      <AnimatePresence>
        {resizeModalVm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50"
          >
            <motion.form
              onSubmit={handleResizeDisk}
              initial={{ scale: 0.94, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, y: 20, opacity: 0 }}
              className="glass-panel rounded-3xl p-6 w-full max-w-md space-y-4 border border-white/25"
            >
              <div className="flex items-center justify-between border-b border-white/15 pb-3">
                <div className="flex items-center space-x-2">
                  <HardDrive className="w-4 h-4 text-white" />
                  <h2 className="text-base font-bold text-white tracking-tight">
                    Resize Virtual Disk — {resizeModalVm.name}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setResizeModalVm(null)}
                  className="p-1.5 rounded-xl glass-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between text-zinc-300">
                  <span>Current Virtual Disk Size:</span>
                  <b className="text-white font-mono">{resizeModalVm.disk_gb} GB</b>
                </div>

                <div>
                  <label className="block text-zinc-300 mb-1">New Total Disk Size (GB)</label>
                  <input
                    type="number"
                    min={resizeModalVm.disk_gb + 1}
                    required
                    value={resizeDiskGb}
                    onChange={(e) => setResizeDiskGb(Number(e.target.value))}
                    className="w-full glass-input rounded-xl px-3 py-2 text-sm font-mono"
                  />
                  <span className="text-[10px] text-zinc-400 mt-1 block">
                    Expands the underlying QCOW2 virtual hard drive safely via <code>qemu-img resize</code>.
                  </span>
                </div>
              </div>

              <div className="flex justify-end space-x-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setResizeModalVm(null)}
                  className="px-4 py-2 rounded-xl glass-btn text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resizingDisk || resizeDiskGb <= resizeModalVm.disk_gb}
                  className="px-5 py-2 rounded-xl glass-btn-primary text-xs font-bold"
                >
                  {resizingDisk ? "Expanding..." : `Expand to ${resizeDiskGb}GB`}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===================================================================== */}
      {/* MODAL 9: QEMU PROCESS PERFORMANCE TELEMETRY                           */}
      {/* ===================================================================== */}
      <AnimatePresence>
        {perfModalVm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50"
          >
            <motion.div
              initial={{ scale: 0.94, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, y: 20, opacity: 0 }}
              className="glass-panel rounded-3xl p-6 w-full max-w-lg space-y-4 border border-white/25"
            >
              <div className="flex items-center justify-between border-b border-white/15 pb-3">
                <div className="flex items-center space-x-2">
                  <Gauge className="w-4 h-4 text-white" />
                  <h2 className="text-base font-bold text-white tracking-tight">
                    Performance — {perfModalVm.name}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setPerfModalVm(null)}
                  className="p-1.5 rounded-xl glass-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {loadingPerf ? (
                <div className="p-8 text-center text-xs text-zinc-400 animate-pulse font-mono">
                  Sampling QEMU process resource usage via ps and free...
                </div>
              ) : perfData ? (
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="glass-sub rounded-2xl p-3 border border-white/15 space-y-1">
                      <span className="text-[10px] uppercase font-mono text-zinc-400 block">QEMU Status</span>
                      <span className="font-bold text-white flex items-center space-x-1.5">
                        <span className={`w-2 h-2 rounded-full ${perfData.running ? "bg-white" : "bg-zinc-600"}`} />
                        <span>{perfData.running ? `Running (PID: ${perfData.pid})` : "Stopped"}</span>
                      </span>
                    </div>

                    <div className="glass-sub rounded-2xl p-3 border border-white/15 space-y-1">
                      <span className="text-[10px] uppercase font-mono text-zinc-400 block">Process CPU%</span>
                      <span className="font-mono font-bold text-white text-base">
                        {perfData.cpuPercent}%
                      </span>
                    </div>

                    <div className="glass-sub rounded-2xl p-3 border border-white/15 space-y-1">
                      <span className="text-[10px] uppercase font-mono text-zinc-400 block">Resident RAM (RSS)</span>
                      <span className="font-mono font-bold text-white text-base">
                        {perfData.rssMb} MB
                      </span>
                    </div>

                    <div className="glass-sub rounded-2xl p-3 border border-white/15 space-y-1">
                      <span className="text-[10px] uppercase font-mono text-zinc-400 block">Host Free Memory</span>
                      <span className="font-mono font-bold text-white text-base">
                        {perfData.hostFreeMemMb} MB
                      </span>
                    </div>
                  </div>

                  <div className="glass-sub rounded-2xl p-3 border border-white/10 text-[11px] text-zinc-400 font-mono space-y-1">
                    <div>Virtual Memory Size (VSZ): {perfData.vszMb} MB</div>
                    <div>Host Total Physical Memory: {perfData.hostTotalMemMb} MB</div>
                    <div>Allocated VM RAM: {perfData.ram_mb} MB ({perfData.instance_type})</div>
                  </div>
                </div>
              ) : (
                <div className="p-4 text-center text-xs text-zinc-400">
                  No performance telemetry available for this instance.
                </div>
              )}

              <div className="flex justify-between items-center pt-2">
                <button
                  type="button"
                  onClick={() => handleOpenPerf(perfModalVm)}
                  className="px-3.5 py-1.5 rounded-xl glass-btn text-xs font-semibold flex items-center space-x-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPerfModalVm(null)}
                  className="px-5 py-2 rounded-xl glass-btn-primary text-xs font-bold"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

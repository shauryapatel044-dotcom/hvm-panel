# HVM Control Panel (KVM / Libvirt VPS & VDS Provisioning)

A full-stack monochrome glass virtualization control panel built with **Next.js 14 (Framer Motion + TailwindCSS)** and a **Node.js + TypeScript KVM/Libvirt Daemon**.

Supports native **Linux KVM (`qemu:///system`)** out of the box as well as local Windows/WSL2 execution.

## Key Features

- **Real KVM VPS & VDS Provisioning:**
  - **VPS (Shared):** Dynamic `<vcpu placement='auto'>`, proportional `<cputune><shares>`, and VirtIO memory ballooning.
  - **VDS (Dedicated):** 1:1 physical CPU core pinning (`<vcpu placement='static'>`, `<cputune><vcpupin>`), `<cpu mode='host-passthrough'>`, and 100% locked physical RAM (`<memoryBacking><locked/><nosharepages/></memoryBacking>`).
- **Booting -> Started Lifecycle & Persistent SSHX Web Terminal:**
  - Streams real-time SeaBIOS, GRUB, Linux kernel, systemd, and Cloud-Init boot logs.
  - Once an instance finishes booting (`● STARTED`), automatically launches a persistent `curl -sSf https://sshx.io/get | sh -s run` session (auto-respawns if interrupted) and opens the live `https://sshx.io/s/...` link in a popup modal.
- **One-Click Tailscale Mesh VPN Installer:**
  - Click the **Tailscale** button in the popup modal, instance card, or console to run `curl -fsSL https://tailscale.com/install.sh | sh` + `tailscale up` and receive a live `https://login.tailscale.com/a/...` authentication link.
- **Flexible Networking:**
  - Supports **IPv4**, **IPv6-Only (No IPv4)**, **Dual-Stack (IPv4 + IPv6)**, **NAT (Auto Unused Host Port)**, and **Isolated L2 (No IP)** modes.
- **11 Cloud OS Templates:**
  - Ubuntu 24.04 / 22.04 / 20.04, Debian 13 / 12 / 11, AlmaLinux 9.4, Rocky Linux 9.4, Fedora 40, Alpine 3.20, and Arch Linux.
- **Real-Time Telemetry & Console Suite:**
  - Live per-core CPU %, RAM %, and Disk % telemetry polled every 1.5s.
  - Interactive **Serial Shell (`ttyS0`)**, **Live VNC (`tty1`)**, **VPS File Manager**, and **OS Reinstall**.

## Quick Install on Linux (Ubuntu / Debian)

```bash
git clone https://github.com/shauryapatel044-dotcom/hvm-panel.git
cd hvm-panel
chmod +x install.sh uninstall.sh
sudo ./install.sh
```

The installer automatically sets up:
1. `qemu-kvm`, `libvirt-daemon-system`, `virtinst`, `cloud-image-utils`, `sshx`, and `tailscale`
2. MariaDB on port `7090` (with automatic local JSON fallback if MariaDB is not used)
3. **HVM Daemon** (`hvm-daemon.service`) on port `5090`
4. **HVM Panel** (`hvm-panel.service`) on port `8090`

## Manual Run (Linux or Windows)

```bash
# 1. Start the Backend Daemon (Port 5090)
cd daemon
npm install
npm run build
npm run start

# 2. Start the Frontend Panel (Port 8090)
cd ../panel
npm install
npm run dev -- -p 8090
```

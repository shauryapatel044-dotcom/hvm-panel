#!/usr/bin/env bash
# ==============================================================================
# HVM Control Panel - Clean Uninstaller Script
# ==============================================================================
# Safely stops and removes HVM services and panel files while preserving all
# running/existing KVM virtual machines and disks in /var/lib/libvirt/images.
# ==============================================================================

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] Please run uninstall.sh as root (sudo bash uninstall.sh)"
  exit 1
fi

INSTALL_ROOT="/opt/hvm"
DB_PORT=7090
DAEMON_PORT=5090
PANEL_PORT=8090
DB_NAME="hvm_panel"
DB_USER="hvm_user"

echo "=================================================================="
echo " HVM Control Panel Uninstaller"
echo " NOTE: Existing KVM Virtual Machines in libvirt will NOT be touched."
echo "=================================================================="

# 1. Stop and disable systemd services & background processes
echo "[1/4] Stopping and removing HVM services & active sessions..."
systemctl stop hvm-panel.service 2>/dev/null || true
systemctl stop hvm-daemon.service 2>/dev/null || true
systemctl disable hvm-panel.service 2>/dev/null || true
systemctl disable hvm-daemon.service 2>/dev/null || true

pkill -f "/opt/hvm/daemon/dist/server.js" 2>/dev/null || true
pkill -f "next start -p ${PANEL_PORT}" 2>/dev/null || true
pkill -f "sshx -q --shell" 2>/dev/null || true
pkill -f "/tmp/hvm-tailscale" 2>/dev/null || true

# Clean up any bind mounts that may have propagated
umount -l /usr/local/bin 2>/dev/null || true
for f in hostname hosts os-release lsb-release issue; do
  umount -l "/etc/$f" 2>/dev/null || true
done
for pf in cpuinfo meminfo; do
  umount -l "/proc/$pf" 2>/dev/null || true
done
if [ -d /var/lib/hvm/containers ]; then
  grep "/var/lib/hvm/containers" /proc/mounts 2>/dev/null | awk '{print $2}' | sort -r | xargs -r umount -l 2>/dev/null || true
fi

rm -f /etc/systemd/system/hvm-panel.service
rm -f /etc/systemd/system/hvm-daemon.service
systemctl daemon-reload 2>/dev/null || true

# 2. Remove HVM Panel, Daemon, and Container directories
echo "[2/4] Removing ${INSTALL_ROOT} and /var/lib/hvm/containers..."
rm -rf "${INSTALL_ROOT}" 2>/dev/null || true
rm -rf /var/lib/hvm/containers 2>/dev/null || true
rm -rf /tmp/hvm-tailscale 2>/dev/null || true

# 3. Cleanly reset MariaDB database
echo "[3/4] Resetting MariaDB database '${DB_NAME}'..."
if command -v mysql >/dev/null 2>&1; then
  mysql --protocol=socket -u root <<EOF 2>/dev/null || true
DROP DATABASE IF EXISTS \`${DB_NAME}\`;
DROP USER IF EXISTS '${DB_USER}'@'127.0.0.1';
DROP USER IF EXISTS '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF
fi
rm -f /etc/mysql/mariadb.conf.d/99-hvm-port.cnf

# 4. Clean up firewall rules
echo "[4/4] Cleaning up firewall rules for ports ${PANEL_PORT}, ${DAEMON_PORT}, and ${DB_PORT}..."
if command -v ufw >/dev/null 2>&1; then
  ufw delete allow "${PANEL_PORT}/tcp" >/dev/null 2>&1 || true
  ufw delete allow "${DAEMON_PORT}/tcp" >/dev/null 2>&1 || true
  ufw delete allow "${DB_PORT}/tcp" >/dev/null 2>&1 || true
fi

echo "=================================================================="
echo " HVM Control Panel cleanly uninstalled."
echo " Ready for fresh installation: sudo bash install.sh"
echo "=================================================================="

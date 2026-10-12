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

# 1. Stop and disable systemd services
echo "[1/4] Stopping and removing systemd services..."
systemctl stop hvm-panel.service 2>/dev/null || true
systemctl stop hvm-daemon.service 2>/dev/null || true
systemctl disable hvm-panel.service 2>/dev/null || true
systemctl disable hvm-daemon.service 2>/dev/null || true

rm -f /etc/systemd/system/hvm-panel.service
rm -f /etc/systemd/system/hvm-daemon.service
systemctl daemon-reload

# 2. Remove HVM Panel & Daemon application files
echo "[2/4] Removing ${INSTALL_ROOT} application directory..."
rm -rf "${INSTALL_ROOT}"

# 3. Optionally drop MariaDB database
read -r -p "[3/4] Do you want to drop the MariaDB database '${DB_NAME}' and user '${DB_USER}'? [y/N]: " DROP_DB
if [[ "${DROP_DB}" =~ ^[Yy]$ ]]; then
  mysql --protocol=socket -u root <<EOF || true
DROP DATABASE IF EXISTS \`${DB_NAME}\`;
DROP USER IF EXISTS '${DB_USER}'@'127.0.0.1';
DROP USER IF EXISTS '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF
  rm -f /etc/mysql/mariadb.conf.d/99-hvm-port.cnf
  systemctl restart mariadb 2>/dev/null || true
  echo "      Database '${DB_NAME}' dropped and MariaDB config cleaned."
else
  echo "      Preserved MariaDB database '${DB_NAME}'."
fi

# 4. Clean up firewall rules
echo "[4/4] Cleaning up firewall rules for ports ${PANEL_PORT}, ${DAEMON_PORT}, and ${DB_PORT}..."
if command -v ufw >/dev/null 2>&1; then
  ufw delete allow "${PANEL_PORT}/tcp" >/dev/null 2>&1 || true
  ufw delete allow "${DAEMON_PORT}/tcp" >/dev/null 2>&1 || true
  ufw delete allow "${DB_PORT}/tcp" >/dev/null 2>&1 || true
fi

echo "=================================================================="
echo " HVM Control Panel cleanly uninstalled."
echo " Your KVM/libvirt virtual machines remain intact."
echo "=================================================================="

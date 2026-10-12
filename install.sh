#!/usr/bin/env bash
# ==============================================================================
# HVM Control Panel - Automated Production Installer (Ubuntu / Debian Linux)
# ==============================================================================
# Stack:
#   - HVM Daemon (TypeScript / Node.js + Express + Libvirt) -> Port 5090
#   - HVM Panel  (Next.js + TypeScript + TailwindCSS)       -> Port 8090
#   - Database   (MariaDB Local Server / Auto JSON Store)   -> Port 7090
#   - Hypervisor (QEMU/KVM via libvirtd qemu:///system)
# ==============================================================================

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] Please run install.sh as root (sudo ./install.sh)"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_ROOT="/opt/hvm"
DAEMON_DIR="${INSTALL_ROOT}/daemon"
PANEL_DIR="${INSTALL_ROOT}/panel"

DB_PORT=7090
DAEMON_PORT=5090
PANEL_PORT=8090

DB_NAME="hvm_panel"
DB_USER="hvm_user"
DB_PASS="${HVM_DB_PASS:-$(openssl rand -hex 12 2>/dev/null || echo 'hvm_secret_db_pass')}"
JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || echo 'hvm_super_secret_jwt_key_2026')"
ADMIN_USER="${HVM_ADMIN_USER:-admin}"
ADMIN_EMAIL="${HVM_ADMIN_EMAIL:-admin@hvm.local}"
ADMIN_PASS="${HVM_ADMIN_PASS:-admin}"

HAS_SYSTEMD=0
if [[ -d /run/systemd/system ]]; then
  HAS_SYSTEMD=1
fi

echo "=================================================================="
echo " Starting HVM Control Panel Installation (KVM / VPS & VDS)"
echo "=================================================================="

# ------------------------------------------------------------------------------
# 1. Install KVM, QEMU, Libvirt, MariaDB, and System Dependencies
# ------------------------------------------------------------------------------
echo "[1/7] Installing KVM, QEMU, libvirt, MariaDB, and system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y || true
apt-get install -y \
  curl wget git gnupg2 ca-certificates lsb-release openssl \
  build-essential pkg-config \
  qemu-kvm qemu-utils libvirt-daemon-system libvirt-clients \
  bridge-utils virtinst ovmf cloud-image-utils genisoimage \
  mariadb-server mariadb-client \
  ufw iptables || true

if [[ $HAS_SYSTEMD -eq 1 ]]; then
  systemctl enable --now libvirtd >/dev/null 2>&1 || true
else
  service libvirtd start >/dev/null 2>&1 || true
fi

virsh net-autostart default >/dev/null 2>&1 || true
virsh net-start default >/dev/null 2>&1 || true

mkdir -p /var/lib/libvirt/images/hvm
mkdir -p /var/lib/libvirt/images/templates

if [[ ! -f /var/lib/libvirt/images/templates/ubuntu-24.04-server-cloudimg-amd64.qcow2 ]]; then
  echo "[1/7] Starting background download of Ubuntu 24.04 LTS Cloud QCOW2 template..."
  nohup wget -q -O /var/lib/libvirt/images/templates/ubuntu-24.04-server-cloudimg-amd64.qcow2 \
    https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img >/dev/null 2>&1 &
fi

echo "[1/7] Installing sshx & Tailscale for instant instance web terminal and mesh VPN access..."
curl -sSf https://sshx.io/get | sh || true
curl -fsSL https://tailscale.com/install.sh | sh || true

# ------------------------------------------------------------------------------
# 2. Configure & Secure MariaDB on Custom Port 7090
# ------------------------------------------------------------------------------
echo "[2/7] Configuring MariaDB on custom port ${DB_PORT}..."
mkdir -p /etc/mysql/mariadb.conf.d
cat >/etc/mysql/mariadb.conf.d/99-hvm-port.cnf <<EOF
[mysqld]
port = ${DB_PORT}
bind-address = 127.0.0.1
max_connections = 200
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
EOF

if [[ $HAS_SYSTEMD -eq 1 ]]; then
  systemctl enable mariadb >/dev/null 2>&1 || true
  systemctl restart mariadb >/dev/null 2>&1 || true
else
  service mariadb restart >/dev/null 2>&1 || service mysql restart >/dev/null 2>&1 || true
fi

echo "[2/7] Initializing '${DB_NAME}' schema..."
mysql --protocol=socket -u root <<EOF 2>/dev/null || true
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF

if [[ -f "${SCRIPT_DIR}/database/schema.sql" ]]; then
  mysql -h 127.0.0.1 -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" "${DB_NAME}" < "${SCRIPT_DIR}/database/schema.sql" 2>/dev/null || true
fi

# ------------------------------------------------------------------------------
# 3. Install Node.js 20 LTS Runtime (TypeScript Daemon & Next.js Panel)
# ------------------------------------------------------------------------------
echo "[3/7] Installing Node.js 20 LTS..."
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# ------------------------------------------------------------------------------
# 4. Deploy & Build HVM Backend Daemon (Port 5090)
# ------------------------------------------------------------------------------
echo "[4/7] Setting up HVM Daemon (TypeScript/Node.js) in ${DAEMON_DIR} on Port ${DAEMON_PORT}..."
mkdir -p "${DAEMON_DIR}"
cp -a "${SCRIPT_DIR}/daemon/." "${DAEMON_DIR}/"

cat >"${DAEMON_DIR}/.env" <<EOF
PORT=${DAEMON_PORT}
DB_HOST=127.0.0.1
DB_PORT=${DB_PORT}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
DB_NAME=${DB_NAME}
JWT_SECRET=${JWT_SECRET}
LIBVIRT_URI=qemu:///system
IMAGES_DIR=/var/lib/libvirt/images/hvm
TEMPLATES_DIR=/var/lib/libvirt/images/templates
DEFAULT_ADMIN_USERNAME=${ADMIN_USER}
DEFAULT_ADMIN_EMAIL=${ADMIN_EMAIL}
DEFAULT_ADMIN_PASSWORD=${ADMIN_PASS}
EOF
chmod 600 "${DAEMON_DIR}/.env"

npm --prefix "${DAEMON_DIR}" install
npm --prefix "${DAEMON_DIR}" run build

# ------------------------------------------------------------------------------
# 5. Deploy & Build HVM Frontend Panel (Port 8090)
# ------------------------------------------------------------------------------
echo "[5/7] Setting up HVM Panel (Next.js/TailwindCSS) in ${PANEL_DIR} on Port ${PANEL_PORT}..."
mkdir -p "${PANEL_DIR}"
cp -a "${SCRIPT_DIR}/panel/." "${PANEL_DIR}/"

npm --prefix "${PANEL_DIR}" install
npm --prefix "${PANEL_DIR}" run build

# ------------------------------------------------------------------------------
# 6. Start Services (systemd or background process fallback)
# ------------------------------------------------------------------------------
echo "[6/7] Starting HVM Daemon (Port ${DAEMON_PORT}) & HVM Panel (Port ${PANEL_PORT})..."

if [[ $HAS_SYSTEMD -eq 1 ]]; then
  cat >/etc/systemd/system/hvm-daemon.service <<EOF
[Unit]
Description=HVM Control Panel Backend Daemon (Libvirt API Port ${DAEMON_PORT})
After=network.target mariadb.service libvirtd.service
Wants=mariadb.service libvirtd.service

[Service]
Type=simple
User=root
WorkingDirectory=${DAEMON_DIR}
EnvironmentFile=${DAEMON_DIR}/.env
ExecStart=/usr/bin/env node ${DAEMON_DIR}/dist/server.js
Restart=always
RestartSec=5
LimitMEMLOCK=infinity

[Install]
WantedBy=multi-user.target
EOF

  cat >/etc/systemd/system/hvm-panel.service <<EOF
[Unit]
Description=HVM Control Panel Frontend Dashboard (Next.js Port ${PANEL_PORT})
After=network.target hvm-daemon.service
Wants=hvm-daemon.service

[Service]
Type=simple
User=root
WorkingDirectory=${PANEL_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PANEL_PORT}
ExecStart=/usr/bin/env npm --prefix ${PANEL_DIR} run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now hvm-daemon.service
  systemctl enable --now hvm-panel.service
else
  pkill -f "${DAEMON_DIR}/dist/server.js" 2>/dev/null || true
  pkill -f "next start -p ${PANEL_PORT}" 2>/dev/null || true
  nohup env $(cat "${DAEMON_DIR}/.env" | xargs) node "${DAEMON_DIR}/dist/server.js" >/var/log/hvm-daemon.log 2>&1 &
  nohup npm --prefix "${PANEL_DIR}" run start >/var/log/hvm-panel.log 2>&1 &
fi

# ------------------------------------------------------------------------------
# 7. Configure Firewall (UFW & iptables) for Ports 8090, 5090, and 7090
# ------------------------------------------------------------------------------
echo "[7/7] Configuring firewall rules for ports ${PANEL_PORT}, ${DAEMON_PORT}, and ${DB_PORT}..."
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow "${PANEL_PORT}/tcp" comment "HVM Panel Frontend" >/dev/null 2>&1 || true
  ufw allow "${DAEMON_PORT}/tcp" comment "HVM Daemon API" >/dev/null 2>&1 || true
  ufw allow "${DB_PORT}/tcp" comment "HVM MariaDB Port" >/dev/null 2>&1 || true
else
  iptables -I INPUT -p tcp --dport "${PANEL_PORT}" -j ACCEPT 2>/dev/null || true
  iptables -I INPUT -p tcp --dport "${DAEMON_PORT}" -j ACCEPT 2>/dev/null || true
  iptables -I INPUT -p tcp --dport "${DB_PORT}" -j ACCEPT 2>/dev/null || true
fi

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST_IP="${HOST_IP:-127.0.0.1}"

echo "=================================================================="
echo " HVM Control Panel Installation Complete!"
echo "=================================================================="
echo " Open Panel URL : http://${HOST_IP}:${PANEL_PORT}"
echo " Daemon Health  : http://${HOST_IP}:${DAEMON_PORT}/api/health"
echo "=================================================================="

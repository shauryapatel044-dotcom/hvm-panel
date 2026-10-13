#!/usr/bin/env bash
# ==============================================================================
# HVM Control Panel - Automated Updater (Ubuntu / Debian Linux)
# ==============================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] Please run update.sh as root (sudo bash update.sh)"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_ROOT="/opt/hvm"
DAEMON_DIR="${INSTALL_ROOT}/daemon"
PANEL_DIR="${INSTALL_ROOT}/panel"

echo "=================================================================="
echo " Updating HVM Control Panel to Latest Version..."
echo "=================================================================="

# 1. Pull latest git code if executed in git workspace
if [[ -d "${SCRIPT_DIR}/.git" ]]; then
  echo "[1/4] Pulling latest updates from GitHub..."
  cd "${SCRIPT_DIR}"
  git fetch origin main || true
  git reset --hard origin/main || true
fi

# 2. Sync daemon source code & rebuild TypeScript
echo "[2/4] Updating backend daemon at ${DAEMON_DIR}..."
mkdir -p "${DAEMON_DIR}/src"
cp -rf "${SCRIPT_DIR}/daemon/src/." "${DAEMON_DIR}/src/"
cp -f "${SCRIPT_DIR}/daemon/package.json" "${DAEMON_DIR}/" 2>/dev/null || true
cp -f "${SCRIPT_DIR}/daemon/tsconfig.json" "${DAEMON_DIR}/" 2>/dev/null || true

cd "${DAEMON_DIR}"
if [[ ! -d "node_modules" ]]; then
  npm install --silent
fi
npm run build

# 3. Sync panel source code if present
if [[ -d "${PANEL_DIR}" && -d "${SCRIPT_DIR}/panel" ]]; then
  echo "[3/4] Updating frontend panel at ${PANEL_DIR}..."
  cp -rf "${SCRIPT_DIR}/panel/src/." "${PANEL_DIR}/src/" 2>/dev/null || true
  cp -f "${SCRIPT_DIR}/panel/package.json" "${PANEL_DIR}/" 2>/dev/null || true
  cd "${PANEL_DIR}"
  if [[ ! -d "node_modules" ]]; then
    npm install --silent
  fi
  npm run build
fi

# 4. Restart services
echo "[4/4] Restarting HVM daemon and panel services..."
if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
  systemctl daemon-reload
  systemctl restart hvm-daemon || true
  systemctl restart hvm-panel || true
else
  pkill -f "${DAEMON_DIR}/dist/server.js" 2>/dev/null || true
  pkill -f "next start -p 8090" 2>/dev/null || true
  nohup env $(cat "${DAEMON_DIR}/.env" 2>/dev/null | xargs) node "${DAEMON_DIR}/dist/server.js" >/var/log/hvm-daemon.log 2>&1 &
  if [[ -d "${PANEL_DIR}" ]]; then
    nohup npm --prefix "${PANEL_DIR}" run start >/var/log/hvm-panel.log 2>&1 &
  fi
fi

echo "=================================================================="
echo " [SUCCESS] HVM Control Panel successfully updated and restarted!"
echo "=================================================================="

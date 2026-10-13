#!/usr/bin/env bash
# ==============================================================================
#  HVM VPS MANAGER - Interactive QEMU/KVM & Cloud-Init Local VPS Manager
# ==============================================================================
#  Author   : HVM Systems
#  License  : MIT
#  Standard : POSIX / Bash 4+
# ==============================================================================

set -euo pipefail

# ------------------------------------------------------------------------------
# 0. Color Palette & Typography
# ------------------------------------------------------------------------------
C_RESET="\033[0m"
C_BOLD="\033[1m"
C_DIM="\033[2m"
C_RED="\033[1;31m"
C_GREEN="\033[1;32m"
C_YELLOW="\033[1;33m"
C_BLUE="\033[1;34m"
C_MAGENTA="\033[1;35m"
C_CYAN="\033[1;36m"
C_WHITE="\033[1;37m"

# ------------------------------------------------------------------------------
# 1. Base Directories & State Stores
# ------------------------------------------------------------------------------
if [[ "${EUID}" -eq 0 ]]; then
  BASE_DIR="/var/lib/hvm-vps"
else
  BASE_DIR="${HOME}/.hvm-vps"
fi

CONFIGS_DIR="${BASE_DIR}/configs"
TEMPLATES_DIR="${BASE_DIR}/templates"
DISKS_DIR="${BASE_DIR}/disks"
SEEDS_DIR="${BASE_DIR}/seeds"
PIDS_DIR="${BASE_DIR}/pids"
LOGS_DIR="${BASE_DIR}/logs"

mkdir -p "${CONFIGS_DIR}" "${TEMPLATES_DIR}" "${DISKS_DIR}" "${SEEDS_DIR}" "${PIDS_DIR}" "${LOGS_DIR}"

# ------------------------------------------------------------------------------
# 2. Official Cloud Image Catalog
# ------------------------------------------------------------------------------
declare -A OS_LABELS=(
  ["ubuntu-24.04"]="Ubuntu 24.04 LTS (Noble Numbat)"
  ["ubuntu-22.04"]="Ubuntu 22.04 LTS (Jammy Jellyfish)"
  ["debian-12"]="Debian 12 (Bookworm)"
  ["debian-11"]="Debian 11 (Bullseye)"
  ["fedora-40"]="Fedora 40 Cloud Base"
  ["almalinux-9"]="AlmaLinux 9 (GenericCloud)"
  ["rocky-9"]="Rocky Linux 9 (Blue Onyx)"
  ["centos-9"]="CentOS Stream 9"
  ["alpine-3.20"]="Alpine Linux 3.20 (Virtual)"
)

declare -A OS_URLS=(
  ["ubuntu-24.04"]="https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img"
  ["ubuntu-22.04"]="https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img"
  ["debian-12"]="https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2"
  ["debian-11"]="https://cloud.debian.org/images/cloud/bullseye/latest/debian-11-genericcloud-amd64.qcow2"
  ["fedora-40"]="https://download.fedoraproject.org/pub/fedora/linux/releases/40/Cloud/x86_64/images/Fedora-Cloud-Base-Generic.x86_64-40-1.14.qcow2"
  ["almalinux-9"]="https://repo.almalinux.org/almalinux/9/cloud/x86_64/images/AlmaLinux-9-GenericCloud-latest.x86_64.qcow2"
  ["rocky-9"]="https://download.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud.latest.x86_64.qcow2"
  ["centos-9"]="https://cloud.centos.org/centos/9-stream/x86_64/images/CentOS-Stream-GenericCloud-9-latest.x86_64.qcow2"
  ["alpine-3.20"]="https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/x86_64/alpine-virt-3.20.3-x86_64.iso"
)

# ------------------------------------------------------------------------------
# 3. Logging & UI Helpers
# ------------------------------------------------------------------------------
log_info() {
  echo -e "${C_BLUE}[INFO]${C_RESET} $*"
}

log_success() {
  echo -e "${C_GREEN}[SUCCESS]${C_RESET} $*"
}

log_warn() {
  echo -e "${C_YELLOW}[WARNING]${C_RESET} $*"
}

log_error() {
  echo -e "${C_RED}[ERROR]${C_RESET} $*" >&2
}

draw_header() {
  clear 2>/dev/null || true
  echo -e "${C_CYAN}${C_BOLD}"
  cat <<'EOF'
  ██╗  ██╗██╗   ██╗███╗   ███╗    ██╗   ██╗██████╗ ███████╗
  ██║  ██║██║   ██║████╗ ████║    ██║   ██║██╔══██╗██╔════╝
  ███████║██║   ██║██╔████╔██║    ██║   ██║██████╔╝███████╗
  ██╔══██║╚██╗ ██╔╝██║╚██╔╝██║    ╚██╗ ██╔╝██╔═══╝ ╚════██║
  ██║  ██║ ╚████╔╝ ██║ ╚═╝ ██║     ╚████╔╝ ██║     ███████║
  ╚═╝  ╚═╝  ╚═══╝  ╚═╝     ╚═╝      ╚═══╝  ╚═╝     ╚══════╝
       Local QEMU/KVM & Cloud-Init Virtual Machine Manager
EOF
  echo -e "${C_RESET}"
  echo -e "${C_DIM}  Storage Path : ${BASE_DIR}${C_RESET}"
  echo -e "${C_DIM}  Host System  : $(uname -s) $(uname -r) ($(nproc) Cores / $(free -h | awk '/^Mem:/ {print $2}') RAM)${C_RESET}"
  echo -e "${C_CYAN}══════════════════════════════════════════════════════════════════════${C_RESET}"
  echo ""
}

pause_prompt() {
  echo ""
  read -r -p "Press [Enter] to return to the Main Menu..." _unused
}

# ------------------------------------------------------------------------------
# 4. Dependency Verification
# ------------------------------------------------------------------------------
check_dependencies() {
  local missing=()
  local required=("qemu-system-x86_64" "qemu-img" "wget" "cloud-localds")

  for bin in "${required[@]}"; do
    if ! command -v "${bin}" >/dev/null 2>&1; then
      missing+=("${bin}")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo ""
    log_error "Missing required dependencies: ${missing[*]}"
    echo -e "${C_YELLOW}Install them using your package manager:${C_RESET}"
    if command -v apt-get >/dev/null 2>&1; then
      echo -e "  ${C_BOLD}sudo apt-get update && sudo apt-get install -y qemu-system-x86 qemu-utils cloud-image-utils wget${C_RESET}"
    elif command -v dnf >/dev/null 2>&1; then
      echo -e "  ${C_BOLD}sudo dnf install -y qemu-kvm qemu-img cloud-utils wget${C_RESET}"
    elif command -v pacman >/dev/null 2>&1; then
      echo -e "  ${C_BOLD}sudo pacman -S qemu-desktop cloud-init wget${C_RESET}"
    fi
    echo ""
    read -r -p "Do you want to continue anyway? [y/N]: " proceed
    if [[ ! "${proceed}" =~ ^[Yy]$ ]]; then
      exit 1
    fi
  fi

  # KVM Acceleration Check
  if [[ ! -w /dev/kvm ]]; then
    log_warn "/dev/kvm is not writable or hardware virtualization (VT-x/AMD-V) is disabled."
    log_warn "QEMU will fall back to software TCG emulation (which will run slower)."
  else
    log_info "KVM hardware acceleration is available (/dev/kvm is accessible)."
  fi
}

# ------------------------------------------------------------------------------
# 5. Core Helpers: Status & Configuration
# ------------------------------------------------------------------------------
is_vm_running() {
  local name="$1"
  local pid_file="${PIDS_DIR}/${name}.pid"

  if [[ -f "${pid_file}" ]]; then
    local pid
    pid="$(cat "${pid_file}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

get_vm_pid() {
  local name="$1"
  local pid_file="${PIDS_DIR}/${name}.pid"
  if [[ -f "${pid_file}" ]]; then
    cat "${pid_file}" 2>/dev/null || echo ""
  else
    echo ""
  fi
}

is_port_in_use() {
  local port="$1"
  # Check if bound in active TCP sockets
  if command -v ss >/dev/null 2>&1; then
    if ss -tln | grep -q ":${port} "; then
      return 0
    fi
  elif command -v netstat >/dev/null 2>&1; then
    if netstat -tln | grep -q ":${port} "; then
      return 0
    fi
  fi

  # Check if assigned in existing VM configs
  for conf in "${CONFIGS_DIR}"/*.conf; do
    if [[ -f "${conf}" ]]; then
      local cport
      cport="$(grep -E '^SSH_PORT=' "${conf}" | cut -d'=' -f2 | tr -d '"' || true)"
      if [[ "${cport}" == "${port}" ]]; then
        return 0
      fi
    fi
  done
  return 1
}

# ------------------------------------------------------------------------------
# 6. Feature: Cloud-Init Seed ISO Generator
# ------------------------------------------------------------------------------
generate_cloud_init() {
  local vm_name="$1"
  local hostname="$2"
  local username="$3"
  local password="$4"
  local target_iso="${SEEDS_DIR}/${vm_name}-seed.iso"

  local tmp_dir
  tmp_dir="$(mktemp -d -t "hvm-cidata-${vm_name}-XXXXXX")"

  local user_data="${tmp_dir}/user-data"
  local meta_data="${tmp_dir}/meta-data"

  cat >"${user_data}" <<EOF
#cloud-config
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
EOF

  cat >"${meta_data}" <<EOF
instance-id: ${vm_name}-$(date +%s)
local-hostname: ${hostname}
EOF

  log_info "Generating cloud-init seed ISO using cloud-localds..."
  if ! cloud-localds "${target_iso}" "${user_data}" "${meta_data}" >/dev/null 2>&1; then
    log_error "Failed to generate cloud-init ISO. Ensure 'cloud-localds' (cloud-image-utils) is installed."
    rm -rf "${tmp_dir}"
    return 1
  fi

  rm -rf "${tmp_dir}"
  log_success "Cloud-Init Seed ISO generated at ${target_iso}"
}

# ------------------------------------------------------------------------------
# 7. Feature: Create a New VM
# ------------------------------------------------------------------------------
create_vm() {
  draw_header
  echo -e "${C_BOLD}=== [1] CREATE A NEW VIRTUAL MACHINE ===${C_RESET}\n"

  # 1. Select OS
  echo -e "${C_CYAN}Select Base Operating System Cloud Image:${C_RESET}"
  local os_keys=("ubuntu-24.04" "ubuntu-22.04" "debian-12" "debian-11" "fedora-40" "almalinux-9" "rocky-9" "centos-9" "alpine-3.20")
  for i in "${!os_keys[@]}"; do
    local key="${os_keys[$i]}"
    echo -e "  ${C_BOLD}$((i + 1)))${C_RESET} ${OS_LABELS[$key]}"
  done

  local os_choice=""
  while true; do
    read -r -p "Enter selection [1-${#os_keys[@]}]: " os_choice
    if [[ "${os_choice}" =~ ^[1-9]$ ]] && [[ "${os_choice}" -le "${#os_keys[@]}" ]]; then
      break
    fi
    log_error "Invalid selection. Please choose 1 to ${#os_keys[@]}."
  done
  local chosen_os_key="${os_keys[$((os_choice - 1))]}"
  local chosen_os_label="${OS_LABELS[${chosen_os_key}]}"
  local chosen_os_url="${OS_URLS[${chosen_os_key}]}"
  log_info "Selected OS: ${chosen_os_label}"

  # 2. VM Name
  local vm_name=""
  while true; do
    read -r -p "Enter unique VM Name (e.g. dev-vm01): " vm_name
    if [[ -z "${vm_name}" ]]; then
      log_error "VM Name cannot be empty."
    elif [[ ! "${vm_name}" =~ ^[a-zA-Z0-9_-]+$ ]]; then
      log_error "VM Name may only contain letters, numbers, hyphens, and underscores."
    elif [[ -f "${CONFIGS_DIR}/${vm_name}.conf" ]]; then
      log_error "A VM with name '${vm_name}' already exists. Choose another name."
    else
      break
    fi
  done

  # 3. Hostname
  local hostname=""
  read -r -p "Enter Guest Hostname [default: ${vm_name}]: " hostname
  hostname="${hostname:-${vm_name}}"

  # 4. Sudo Username
  local username=""
  while true; do
    read -r -p "Enter Sudo Username [default: admin]: " username
    username="${username:-admin}"
    if [[ "${username}" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
      break
    fi
    log_error "Invalid Linux username format."
  done

  # 5. Password
  local password=""
  while true; do
    read -r -s -p "Enter Password for '${username}' and 'root': " password
    echo ""
    if [[ -z "${password}" ]]; then
      log_error "Password cannot be empty."
    else
      read -r -s -p "Confirm Password: " password_confirm
      echo ""
      if [[ "${password}" != "${password_confirm}" ]]; then
        log_error "Passwords do not match. Try again."
      else
        break
      fi
    fi
  done

  # 6. RAM (MB)
  local ram_mb=""
  while true; do
    read -r -p "Enter RAM allocation in MB (e.g. 2048 for 2GB) [default: 2048]: " ram_mb
    ram_mb="${ram_mb:-2048}"
    if [[ "${ram_mb}" =~ ^[0-9]+$ ]] && [[ "${ram_mb}" -ge 512 ]]; then
      break
    fi
    log_error "RAM must be a number >= 512 MB."
  done

  # 7. CPU Cores
  local vcpus=""
  while true; do
    read -r -p "Enter CPU Cores (1-32) [default: 2]: " vcpus
    vcpus="${vcpus:-2}"
    if [[ "${vcpus}" =~ ^[0-9]+$ ]] && [[ "${vcpus}" -ge 1 ]] && [[ "${vcpus}" -le 32 ]]; then
      break
    fi
    log_error "CPU Cores must be a number between 1 and 32."
  done

  # 8. Disk Size
  local disk_size=""
  while true; do
    read -r -p "Enter Virtual Disk Size (e.g. 20G, 50G) [default: 20G]: " disk_size
    disk_size="${disk_size:-20G}"
    if [[ "${disk_size}" =~ ^[0-9]+[GMK]$ ]]; then
      break
    fi
    log_error "Disk size must be formatted like '20G' or '50G'."
  done

  # 9. SSH Forwarding Port
  local ssh_port=""
  local default_port=2222
  while is_port_in_use "${default_port}"; do
    default_port=$((default_port + 1))
  done

  while true; do
    read -r -p "Enter Host SSH Port Forwarding [default: ${default_port}]: " ssh_port
    ssh_port="${ssh_port:-${default_port}}"
    if [[ ! "${ssh_port}" =~ ^[0-9]+$ ]] || [[ "${ssh_port}" -lt 1024 ]] || [[ "${ssh_port}" -gt 65535 ]]; then
      log_error "Port must be a number between 1024 and 65535."
    elif is_port_in_use "${ssh_port}"; then
      log_warn "Port ${ssh_port} appears to already be in use or bound."
      read -r -p "Use it anyway? [y/N]: " force_port
      if [[ "${force_port}" =~ ^[Yy]$ ]]; then
        break
      fi
    else
      break
    fi
  done

  # ----------------------------------------------------------------------------
  # Provisioning Steps
  # ----------------------------------------------------------------------------
  echo ""
  log_info "Step 1/4: Checking and downloading base cloud image template..."
  local template_filename
  template_filename="$(basename "${chosen_os_url}")"
  local template_path="${TEMPLATES_DIR}/${template_filename}"

  if [[ ! -f "${template_path}" ]]; then
    log_info "Downloading ${chosen_os_label} from official source..."
    log_info "URL: ${chosen_os_url}"
    wget --progress=bar:force -O "${template_path}.part" "${chosen_os_url}"
    mv "${template_path}.part" "${template_path}"
    log_success "Downloaded and cached base template: ${template_filename}"
  else
    log_success "Using cached template: ${template_path}"
  fi

  log_info "Step 2/4: Creating virtual disk overlay and expanding to ${disk_size}..."
  local disk_path="${DISKS_DIR}/${vm_name}.qcow2"
  # Create a standalone copy so each VM owns its disk
  cp --sparse=always "${template_path}" "${disk_path}"
  qemu-img resize "${disk_path}" "${disk_size}" >/dev/null
  log_success "Virtual disk created at ${disk_path} (${disk_size})"

  log_info "Step 3/4: Generating Cloud-Init configuration & Seed ISO..."
  generate_cloud_init "${vm_name}" "${hostname}" "${username}" "${password}"
  local seed_iso="${SEEDS_DIR}/${vm_name}-seed.iso"

  log_info "Step 4/4: Writing VM configuration file..."
  local conf_file="${CONFIGS_DIR}/${vm_name}.conf"
  cat >"${conf_file}" <<EOF
# HVM VPS Manager Configuration
VM_NAME="${vm_name}"
OS_KEY="${chosen_os_key}"
OS_LABEL="${chosen_os_label}"
HOSTNAME="${hostname}"
USERNAME="${username}"
PASSWORD="${password}"
RAM_MB="${ram_mb}"
VCPUS="${vcpus}"
DISK_SIZE="${disk_size}"
SSH_PORT="${ssh_port}"
DISK_PATH="${disk_path}"
SEED_ISO="${seed_iso}"
CREATED_AT="$(date '+%Y-%m-%d %H:%M:%S')"
EOF
  chmod 600 "${conf_file}"
  log_success "Configuration saved to ${conf_file}"

  echo ""
  echo -e "${C_GREEN}${C_BOLD}✓ Virtual Machine '${vm_name}' successfully provisioned!${C_RESET}"
  echo -e "  SSH Connection Command : ${C_CYAN}ssh -p ${ssh_port} ${username}@localhost${C_RESET}"
  echo -e "  Root Password          : ${C_YELLOW}${password}${C_RESET}"

  read -r -p "Would you like to start this VM right now? [Y/n]: " auto_start
  auto_start="${auto_start:-Y}"
  if [[ "${auto_start}" =~ ^[Yy]$ ]]; then
    start_vm "${vm_name}"
  else
    pause_prompt
  fi
}

# ------------------------------------------------------------------------------
# 8. Feature: Start / Boot VM
# ------------------------------------------------------------------------------
start_vm() {
  local target_vm="${1:-}"

  if [[ -z "${target_vm}" ]]; then
    draw_header
    echo -e "${C_BOLD}=== [2] START VIRTUAL MACHINE ===${C_RESET}\n"
    list_vms_simple
    echo ""
    read -r -p "Enter VM Name to start: " target_vm
  fi

  local conf="${CONFIGS_DIR}/${target_vm}.conf"
  if [[ ! -f "${conf}" ]]; then
    log_error "Configuration for VM '${target_vm}' not found."
    pause_prompt
    return 1
  fi

  # Load Config
  # shellcheck source=/dev/null
  source "${conf}"

  if is_vm_running "${target_vm}"; then
    local pid
    pid="$(get_vm_pid "${target_vm}")"
    log_warn "VM '${target_vm}' is ALREADY RUNNING (PID: ${pid})."
    pause_prompt
    return 0
  fi

  log_info "Booting VM '${target_vm}' in background with QEMU/KVM..."

  local kvm_flag=()
  if [[ -w /dev/kvm ]]; then
    kvm_flag=("-enable-kvm" "-cpu" "host")
  else
    kvm_flag=("-cpu" "qemu64")
  fi

  local pid_file="${PIDS_DIR}/${target_vm}.pid"
  local log_file="${LOGS_DIR}/${target_vm}.log"

  nohup qemu-system-x86_64 \
    "${kvm_flag[@]}" \
    -m "${RAM_MB}" \
    -smp "${VCPUS}" \
    -drive "file=${DISK_PATH},format=qcow2,if=virtio" \
    -drive "file=${SEED_ISO},format=raw,if=virtio,media=cdrom" \
    -netdev "user,id=net0,hostfwd=tcp::${SSH_PORT}-:22" \
    -device "virtio-net-pci,netdev=net0" \
    -nographic \
    -serial "file:${log_file}" \
    -daemonize \
    -pidfile "${pid_file}" >/dev/null 2>&1

  sleep 1.2

  if is_vm_running "${target_vm}"; then
    local new_pid
    new_pid="$(get_vm_pid "${target_vm}")"
    log_success "VM '${target_vm}' started successfully! (Process PID: ${new_pid})"
    echo ""
    echo -e "  ${C_CYAN}➜ Connect via SSH :${C_RESET} ${C_BOLD}ssh -p ${SSH_PORT} ${USERNAME}@localhost${C_RESET}"
    echo -e "  ${C_CYAN}➜ Serial Boot Log :${C_RESET} tail -f ${log_file}"
    echo -e "  ${C_DIM}(Note: Cloud-Init takes ~20-30s on first boot to configure user & SSH keys)${C_RESET}"
  else
    log_error "Failed to boot VM '${target_vm}'. Inspect log: ${log_file}"
  fi

  pause_prompt
}

# ------------------------------------------------------------------------------
# 9. Feature: Stop / Kill VM
# ------------------------------------------------------------------------------
stop_vm() {
  draw_header
  echo -e "${C_BOLD}=== [3] STOP VIRTUAL MACHINE ===${C_RESET}\n"
  list_vms_simple
  echo ""
  read -r -p "Enter VM Name to stop: " target_vm

  local conf="${CONFIGS_DIR}/${target_vm}.conf"
  if [[ ! -f "${conf}" ]]; then
    log_error "VM '${target_vm}' does not exist."
    pause_prompt
    return 1
  fi

  if ! is_vm_running "${target_vm}"; then
    log_warn "VM '${target_vm}' is not currently running."
    pause_prompt
    return 0
  fi

  local pid
  pid="$(get_vm_pid "${target_vm}")"
  log_info "Attempting graceful shutdown for '${target_vm}' (PID: ${pid})..."
  kill -SIGTERM "${pid}" 2>/dev/null || true

  # Wait up to 10 seconds for graceful shutdown
  local count=0
  while kill -0 "${pid}" 2>/dev/null && [[ "${count}" -lt 10 ]]; do
    sleep 1
    count=$((count + 1))
    echo -n "."
  done
  echo ""

  if kill -0 "${pid}" 2>/dev/null; then
    log_warn "VM did not shut down gracefully. Sending SIGKILL..."
    kill -SIGKILL "${pid}" 2>/dev/null || true
    sleep 0.5
  fi

  rm -f "${PIDS_DIR}/${target_vm}.pid"
  log_success "VM '${target_vm}' has been completely stopped."
  pause_prompt
}

# ------------------------------------------------------------------------------
# 10. Feature: List VMs & Status
# ------------------------------------------------------------------------------
list_vms_simple() {
  local confs=("${CONFIGS_DIR}"/*.conf)
  if [[ ! -e "${confs[0]}" ]]; then
    echo -e "${C_DIM}  (No virtual machines found)${C_RESET}"
    return
  fi

  for conf in "${CONFIGS_DIR}"/*.conf; do
    local vname
    vname="$(basename "${conf}" .conf)"
    if is_vm_running "${vname}"; then
      local pid
      pid="$(get_vm_pid "${vname}")"
      echo -e "  ● ${C_GREEN}${C_BOLD}${vname}${C_RESET} [RUNNING - PID: ${pid}]"
    else
      echo -e "  ○ ${C_DIM}${vname} [STOPPED]${C_RESET}"
    fi
  done
}

list_all_vms() {
  draw_header
  echo -e "${C_BOLD}=== VIRTUAL MACHINE INVENTORY & STATUS ===${C_RESET}\n"

  local confs=("${CONFIGS_DIR}"/*.conf)
  if [[ ! -e "${confs[0]}" ]]; then
    echo -e "${C_YELLOW}No Virtual Machines found.${C_RESET} Use Option [1] to create one.\n"
    pause_prompt
    return
  fi

  printf "${C_BOLD}%-16s %-10s %-24s %-8s %-6s %-8s %-10s %-8s${C_RESET}\n" \
    "VM NAME" "STATUS" "OS TEMPLATE" "RAM" "CPUS" "DISK" "SSH PORT" "PID"
  echo -e "${C_DIM}───────────────────────────────────────────────────────────────────────────────────────────${C_RESET}"

  for conf in "${CONFIGS_DIR}"/*.conf; do
    # shellcheck source=/dev/null
    source "${conf}"
    local status_str
    local pid_str="-"
    if is_vm_running "${VM_NAME}"; then
      status_str="${C_GREEN}RUNNING${C_RESET}"
      pid_str="$(get_vm_pid "${VM_NAME}")"
    else
      status_str="${C_DIM}STOPPED${C_RESET}"
    fi

    printf "%-16s %-19b %-24s %-8s %-6s %-8s %-10s %-8s\n" \
      "${VM_NAME}" "${status_str}" "${OS_KEY}" "${RAM_MB}M" "${VCPUS}" "${DISK_SIZE}" ":${SSH_PORT}" "${pid_str}"
  done

  echo ""
  pause_prompt
}

# ------------------------------------------------------------------------------
# 11. Feature: Show VM Info & Credentials
# ------------------------------------------------------------------------------
show_vm_info() {
  draw_header
  echo -e "${C_BOLD}=== [4] SHOW VM SPECS & CREDENTIALS ===${C_RESET}\n"
  list_vms_simple
  echo ""
  read -r -p "Enter VM Name: " target_vm

  local conf="${CONFIGS_DIR}/${target_vm}.conf"
  if [[ ! -f "${conf}" ]]; then
    log_error "VM '${target_vm}' does not exist."
    pause_prompt
    return 1
  fi

  # shellcheck source=/dev/null
  source "${conf}"

  local status_str="${C_DIM}STOPPED${C_RESET}"
  local pid_str="None"
  if is_vm_running "${target_vm}"; then
    status_str="${C_GREEN}${C_BOLD}RUNNING${C_RESET}"
    pid_str="$(get_vm_pid "${target_vm}")"
  fi

  echo ""
  echo -e "${C_CYAN}══════════════════════════════════════════════════════════════════════${C_RESET}"
  echo -e "  ${C_BOLD}Virtual Machine :${C_RESET} ${C_WHITE}${VM_NAME}${C_RESET} (${status_str})"
  echo -e "${C_CYAN}══════════════════════════════════════════════════════════════════════${C_RESET}"
  echo -e "  • Operating System   : ${OS_LABEL:-${OS_KEY}}"
  echo -e "  • Guest Hostname     : ${HOSTNAME}"
  echo -e "  • Allocated RAM      : ${RAM_MB} MB"
  echo -e "  • Virtual CPUs       : ${VCPUS} Cores"
  echo -e "  • Virtual Disk Size  : ${DISK_SIZE}"
  echo -e "  • Host SSH Port      : ${C_BOLD}${SSH_PORT}${C_RESET}"
  echo -e "  • Process PID        : ${pid_str}"
  echo -e "  • Provisioned On     : ${CREATED_AT:-Unknown}"
  echo -e "${C_CYAN}──────────────────────────────────────────────────────────────────────${C_RESET}"
  echo -e "  ${C_BOLD}Access Credentials:${C_RESET}"
  echo -e "  • Sudo User          : ${C_GREEN}${USERNAME}${C_RESET}"
  echo -e "  • User Password      : ${C_YELLOW}${PASSWORD}${C_RESET}"
  echo -e "  • Root Password      : ${C_YELLOW}${PASSWORD}${C_RESET}"
  echo -e "  • Quick Connect      : ${C_CYAN}ssh -p ${SSH_PORT} ${USERNAME}@localhost${C_RESET}"
  echo -e "${C_CYAN}──────────────────────────────────────────────────────────────────────${C_RESET}"
  echo -e "  • Disk Image Path    : ${DISK_PATH}"
  echo -e "  • Cloud-Init ISO     : ${SEED_ISO}"
  echo -e "${C_CYAN}══════════════════════════════════════════════════════════════════════${C_RESET}"

  pause_prompt
}

# ------------------------------------------------------------------------------
# 12. Feature: Edit VM Config
# ------------------------------------------------------------------------------
edit_vm_config() {
  draw_header
  echo -e "${C_BOLD}=== [5] EDIT VM CONFIGURATION ===${C_RESET}\n"
  list_vms_simple
  echo ""
  read -r -p "Enter VM Name to edit: " target_vm

  local conf="${CONFIGS_DIR}/${target_vm}.conf"
  if [[ ! -f "${conf}" ]]; then
    log_error "VM '${target_vm}' does not exist."
    pause_prompt
    return 1
  fi

  if is_vm_running "${target_vm}"; then
    log_warn "VM '${target_vm}' is currently RUNNING."
    log_warn "You must stop the VM before applying hardware/credential edits."
    read -r -p "Stop the VM now? [y/N]: " stop_confirm
    if [[ "${stop_confirm}" =~ ^[Yy]$ ]]; then
      stop_vm
    else
      return 0
    fi
  fi

  # shellcheck source=/dev/null
  source "${conf}"

  echo -e "\n${C_CYAN}Current Configuration for '${target_vm}':${C_RESET}"
  echo -e "  1) RAM MB       : ${RAM_MB}"
  echo -e "  2) CPU Cores    : ${VCPUS}"
  echo -e "  3) SSH Port     : ${SSH_PORT}"
  echo -e "  4) Password     : ${PASSWORD}"
  echo -e "  5) Hostname     : ${HOSTNAME}"
  echo ""

  read -r -p "Enter new RAM in MB [Leave empty to keep ${RAM_MB}]: " new_ram
  new_ram="${new_ram:-${RAM_MB}}"

  read -r -p "Enter new CPU Cores [Leave empty to keep ${VCPUS}]: " new_cpu
  new_cpu="${new_cpu:-${VCPUS}}"

  read -r -p "Enter new SSH Port [Leave empty to keep ${SSH_PORT}]: " new_port
  new_port="${new_port:-${SSH_PORT}}"

  read -r -p "Enter new Hostname [Leave empty to keep ${HOSTNAME}]: " new_hostname
  new_hostname="${new_hostname:-${HOSTNAME}}"

  read -r -s -p "Enter new Password [Leave empty to keep current]: " new_pass
  echo ""
  new_pass="${new_pass:-${PASSWORD}}"

  local creds_changed=0
  if [[ "${new_pass}" != "${PASSWORD}" ]] || [[ "${new_hostname}" != "${HOSTNAME}" ]]; then
    creds_changed=1
  fi

  # Update Config File
  cat >"${conf}" <<EOF
VM_NAME="${VM_NAME}"
OS_KEY="${OS_KEY}"
OS_LABEL="${OS_LABEL}"
HOSTNAME="${new_hostname}"
USERNAME="${USERNAME}"
PASSWORD="${new_pass}"
RAM_MB="${new_ram}"
VCPUS="${new_cpu}"
DISK_SIZE="${DISK_SIZE}"
SSH_PORT="${new_port}"
DISK_PATH="${DISK_PATH}"
SEED_ISO="${SEED_ISO}"
CREATED_AT="${CREATED_AT}"
UPDATED_AT="$(date '+%Y-%m-%d %H:%M:%S')"
EOF

  if [[ "${creds_changed}" -eq 1 ]]; then
    log_info "Credentials or hostname changed. Regenerating Cloud-Init seed ISO..."
    generate_cloud_init "${VM_NAME}" "${new_hostname}" "${USERNAME}" "${new_pass}"
  fi

  log_success "VM '${target_vm}' configuration successfully updated!"
  pause_prompt
}

# ------------------------------------------------------------------------------
# 13. Feature: Resize VM Disk
# ------------------------------------------------------------------------------
resize_vm_disk() {
  draw_header
  echo -e "${C_BOLD}=== [6] RESIZE VIRTUAL DISK ===${C_RESET}\n"
  list_vms_simple
  echo ""
  read -r -p "Enter VM Name to expand disk: " target_vm

  local conf="${CONFIGS_DIR}/${target_vm}.conf"
  if [[ ! -f "${conf}" ]]; then
    log_error "VM '${target_vm}' does not exist."
    pause_prompt
    return 1
  fi

  # shellcheck source=/dev/null
  source "${conf}"

  echo -e "\n  Current Virtual Disk Size : ${C_BOLD}${DISK_SIZE}${C_RESET}"
  echo -e "  Disk File Path            : ${DISK_PATH}\n"

  local new_size=""
  while true; do
    read -r -p "Enter Target Disk Size (e.g. 40G, 100G, +10G): " new_size
    if [[ "${new_size}" =~ ^\+?[0-9]+[GMK]$ ]]; then
      break
    fi
    log_error "Invalid size format. Examples: '50G' (absolute) or '+10G' (relative addition)."
  done

  log_info "Executing qemu-img resize for ${DISK_PATH} to ${new_size}..."
  if qemu-img resize "${DISK_PATH}" "${new_size}"; then
    # Query new virtual size
    local real_size
    real_size="$(qemu-img info "${DISK_PATH}" | awk '/virtual size:/ {print $3, $4}' | tr -d '()' || echo "${new_size}")"
    sed -i "s/^DISK_SIZE=.*/DISK_SIZE=\"${new_size}\"/" "${conf}"
    log_success "Virtual disk expanded successfully to ${real_size}!"
    log_info "Note: Cloud-Init growpart automatically expands the root filesystem during boot."
  else
    log_error "qemu-img resize operation failed."
  fi

  pause_prompt
}

# ------------------------------------------------------------------------------
# 14. Feature: Show Live Performance & Usage
# ------------------------------------------------------------------------------
show_performance() {
  draw_header
  echo -e "${C_BOLD}=== [7] REAL-TIME PROCESS & VM PERFORMANCE ===${C_RESET}\n"

  printf "${C_BOLD}%-16s %-8s %-10s %-10s %-12s %-12s${C_RESET}\n" \
    "VM NAME" "PID" "CPU %" "MEM %" "RSS RAM" "VSZ RAM"
  echo -e "${C_DIM}──────────────────────────────────────────────────────────────────────${C_RESET}"

  local running_count=0
  for conf in "${CONFIGS_DIR}"/*.conf; do
    if [[ -f "${conf}" ]]; then
      local vname
      vname="$(basename "${conf}" .conf)"
      if is_vm_running "${vname}"; then
        local pid
        pid="$(get_vm_pid "${vname}")"
        # Extract CPU%, MEM%, RSS, VSZ using ps
        local ps_data
        ps_data="$(ps -p "${pid}" -o %cpu,%mem,rss,vsz --no-headers 2>/dev/null || echo "0.0 0.0 0 0")"
        read -r cpu_pct mem_pct rss_kb vsz_kb <<< "${ps_data}"

        local rss_mb=$((rss_kb / 1024))
        local vsz_mb=$((vsz_kb / 1024))

        printf "%-16s %-8s %-10s %-10s %-12s %-12s\n" \
          "${vname}" "${pid}" "${cpu_pct}%" "${mem_pct}%" "${rss_mb} MB" "${vsz_mb} MB"
        running_count=$((running_count + 1))
      fi
    fi
  done

  if [[ "${running_count}" -eq 0 ]]; then
    echo -e "${C_DIM}  (No virtual machines currently active)${C_RESET}"
  fi

  echo ""
  echo -e "${C_CYAN}Host System Memory Overview:${C_RESET}"
  free -h

  pause_prompt
}

# ------------------------------------------------------------------------------
# 15. Feature: Connect / SSH to VM
# ------------------------------------------------------------------------------
connect_ssh() {
  draw_header
  echo -e "${C_BOLD}=== [8] CONNECT VIA SSH ===${C_RESET}\n"
  list_vms_simple
  echo ""
  read -r -p "Enter VM Name to connect: " target_vm

  local conf="${CONFIGS_DIR}/${target_vm}.conf"
  if [[ ! -f "${conf}" ]]; then
    log_error "VM '${target_vm}' does not exist."
    pause_prompt
    return 1
  fi

  # shellcheck source=/dev/null
  source "${conf}"

  if ! is_vm_running "${target_vm}"; then
    log_warn "VM '${target_vm}' is not running. Starting it now..."
    start_vm "${target_vm}"
  fi

  echo ""
  log_info "Connecting to ${USERNAME}@localhost on port ${SSH_PORT}..."
  log_info "Password: ${PASSWORD}"
  echo ""
  ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p "${SSH_PORT}" "${USERNAME}@127.0.0.1" || true

  pause_prompt
}

# ------------------------------------------------------------------------------
# 16. Feature: Delete VM
# ------------------------------------------------------------------------------
delete_vm() {
  draw_header
  echo -e "${C_BOLD}=== [9] DELETE VIRTUAL MACHINE ===${C_RESET}\n"
  list_vms_simple
  echo ""
  read -r -p "Enter VM Name to delete: " target_vm

  local conf="${CONFIGS_DIR}/${target_vm}.conf"
  if [[ ! -f "${conf}" ]]; then
    log_error "VM '${target_vm}' does not exist."
    pause_prompt
    return 1
  fi

  echo ""
  echo -e "${C_RED}${C_BOLD}WARNING: This action is permanent!${C_RESET}"
  echo -e "The virtual disk, cloud-init seed, and all user data inside '${target_vm}' will be deleted."
  read -r -p "Type '${target_vm}' to confirm deletion: " confirm_name

  if [[ "${confirm_name}" != "${target_vm}" ]]; then
    log_info "Deletion aborted. Confirmation did not match."
    pause_prompt
    return 0
  fi

  # Stop if running
  if is_vm_running "${target_vm}"; then
    log_info "Stopping running VM '${target_vm}'..."
    local pid
    pid="$(get_vm_pid "${target_vm}")"
    kill -9 "${pid}" 2>/dev/null || true
  fi

  # shellcheck source=/dev/null
  source "${conf}"

  rm -f "${DISK_PATH}" 2>/dev/null || true
  rm -f "${SEED_ISO}" 2>/dev/null || true
  rm -f "${PIDS_DIR}/${target_vm}.pid" 2>/dev/null || true
  rm -f "${LOGS_DIR}/${target_vm}.log" 2>/dev/null || true
  rm -f "${conf}" 2>/dev/null || true

  log_success "Virtual Machine '${target_vm}' was completely purged."
  pause_prompt
}

# ------------------------------------------------------------------------------
# 17. Main Menu Event Loop
# ------------------------------------------------------------------------------
main_menu() {
  check_dependencies

  while true; do
    draw_header
    echo -e "${C_BOLD}Main Management Menu:${C_RESET}"
    echo -e "  ${C_CYAN}[1]${C_RESET} Create a New VM"
    echo -e "  ${C_CYAN}[2]${C_RESET} Start Virtual Machine"
    echo -e "  ${C_CYAN}[3]${C_RESET} Stop Virtual Machine"
    echo -e "  ${C_CYAN}[4]${C_RESET} List All VMs & Status"
    echo -e "  ${C_CYAN}[5]${C_RESET} Show VM Info & Credentials"
    echo -e "  ${C_CYAN}[6]${C_RESET} Edit VM Configuration"
    echo -e "  ${C_CYAN}[7]${C_RESET} Resize Virtual Hard Drive"
    echo -e "  ${C_CYAN}[8]${C_RESET} Show Process Performance & Resource Usage"
    echo -e "  ${C_CYAN}[9]${C_RESET} Connect / SSH to VM"
    echo -e "  ${C_CYAN}[D]${C_RESET} Delete Virtual Machine"
    echo -e "  ${C_RED}[0]${C_RESET} Exit"
    echo ""

    read -r -p "Select an option [0-9, D]: " choice
    case "${choice}" in
      1) create_vm ;;
      2) start_vm "" ;;
      3) stop_vm ;;
      4) list_all_vms ;;
      5) show_vm_info ;;
      6) edit_vm_config ;;
      7) resize_vm_disk ;;
      8) show_performance ;;
      9) connect_ssh ;;
      [Dd]) delete_vm ;;
      0|[Qq])
        echo -e "\n${C_GREEN}Exiting HVM VPS Manager. Goodbye!${C_RESET}\n"
        exit 0
        ;;
      *)
        log_error "Invalid selection. Please choose an option from the menu."
        sleep 1
        ;;
    esac
  done
}

# ------------------------------------------------------------------------------
# Direct CLI Argument Execution (Optional scriptable interface)
# ------------------------------------------------------------------------------
if [[ $# -gt 0 ]]; then
  case "$1" in
    list)
      list_all_vms
      ;;
    start)
      shift
      start_vm "${1:-}"
      ;;
    stop)
      shift
      target_vm="${1:-}"
      if is_vm_running "${target_vm}"; then
        kill -SIGTERM "$(get_vm_pid "${target_vm}")" 2>/dev/null || true
      fi
      ;;
    *)
      main_menu
      ;;
  esac
else
  main_menu
fi

#!/usr/bin/env bash

# ==========================================================
# Advanced Server Detection v3.0
# No external packages required
# Supports:
# Bare Metal
# KVM
# QEMU
# VMware
# Hyper-V
# Xen
# VirtualBox
# OpenVZ
# LXC
# Docker
# Podman
# Proxmox
# OpenStack
# EC2
# Google Cloud
# Azure
# VPS / VDS Estimation
# ==========================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

clear

banner() {
echo -e "${CYAN}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "              ADVANCED SERVER DETECTOR v3.0"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${NC}"
}

banner

HOSTNAME=$(hostname 2>/dev/null)

OS=$(
grep '^PRETTY_NAME=' /etc/os-release 2>/dev/null |
cut -d'"' -f2
)

[ -z "$OS" ] && OS=$(uname -o)

KERNEL=$(uname -r)

CPU_MODEL=$(grep -m1 "model name" /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ *//')
CPU_CORES=$(nproc 2>/dev/null)

RAM=$(free -h | awk '/^Mem:/ {print $2}')
DISK=$(df -h / | awk 'NR==2 {print $2}')

PRODUCT_NAME=$(cat /sys/class/dmi/id/product_name 2>/dev/null)
SYS_VENDOR=$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null)
BOARD_NAME=$(cat /sys/class/dmi/id/board_name 2>/dev/null)

DMI_INFO="$(echo "$PRODUCT_NAME $SYS_VENDOR $BOARD_NAME" | tr '[:upper:]' '[:lower:]')"

SCORE=0

# ==========================================================
# Virtualization Detection
# ==========================================================

VIRT="none"

if command -v systemd-detect-virt >/dev/null 2>&1; then
    VIRT=$(systemd-detect-virt 2>/dev/null)
fi

# Docker fallback

if [ -f /.dockerenv ]; then
    VIRT="docker"
fi

# LXC fallback

if grep -qa container=lxc /proc/1/environ 2>/dev/null; then
    VIRT="lxc"
fi

# OpenVZ

if [ -d /proc/vz ] && [ ! -d /proc/bc ]; then
    VIRT="openvz"
fi

# ==========================================================
# Server Type
# ==========================================================

SERVER_TYPE="Unknown"

case "$VIRT" in

docker)
SERVER_TYPE="Docker Container"
;;

lxc)
SERVER_TYPE="LXC Container"
;;

podman)
SERVER_TYPE="Podman Container"
;;

openvz)
SERVER_TYPE="OpenVZ Container"
;;

kvm)
SERVER_TYPE="KVM VPS"
;;

qemu)
SERVER_TYPE="QEMU VPS"
;;

vmware)
SERVER_TYPE="VMware VM"
;;

xen)
SERVER_TYPE="Xen VPS"
;;

oracle)
SERVER_TYPE="VirtualBox VM"
;;

microsoft)
SERVER_TYPE="Hyper-V VPS"
;;

amazon)
SERVER_TYPE="Amazon EC2"
;;

google)
SERVER_TYPE="Google Cloud VM"
;;

none)
SERVER_TYPE="Bare Metal Server"
;;

*)
SERVER_TYPE="$VIRT"
;;

esac

# ==========================================================
# Machine Type Detection
# ==========================================================

MACHINE_TYPE="Unknown"

case "$DMI_INFO" in

*q35*)
MACHINE_TYPE="Q35"
;;

*i440fx*)
MACHINE_TYPE="i440FX"
;;

*kvm*)
MACHINE_TYPE="KVM"
;;

*qemu*)
MACHINE_TYPE="QEMU"
;;

*vmware*)
MACHINE_TYPE="VMware"
;;

*virtualbox*)
MACHINE_TYPE="VirtualBox"
;;

*xen*)
MACHINE_TYPE="Xen"
;;

*hyper-v*|*microsoft*)
MACHINE_TYPE="Hyper-V"
;;

*proxmox*)
MACHINE_TYPE="Proxmox"
;;

*openstack*)
MACHINE_TYPE="OpenStack"
;;

*amazon*)
MACHINE_TYPE="Amazon EC2"
;;

*google*)
MACHINE_TYPE="Google Cloud"
;;

*azure*)
MACHINE_TYPE="Microsoft Azure"
;;

*)
if [ "$VIRT" != "none" ]; then
    MACHINE_TYPE=$(echo "$VIRT" | tr '[:lower:]' '[:upper:]')
fi
;;

esac

# ==========================================================
# Hypervisor
# ==========================================================

HYPERVISOR="Bare Metal"

if grep -qi hypervisor /proc/cpuinfo; then
    HYPERVISOR="Detected"
    SCORE=$((SCORE+2))
fi

# ==========================================================
# VPS / VDS Estimation
# ==========================================================

ASSESSMENT="Unknown"

case "$VIRT" in

docker|lxc|podman|openvz)
ASSESSMENT="Container"
;;

none)
ASSESSMENT="Bare Metal"
;;

*)
if echo "$CPU_MODEL" | grep -qi "epyc"; then
    SCORE=$((SCORE+2))
fi

if echo "$CPU_MODEL" | grep -qi "xeon"; then
    SCORE=$((SCORE+1))
fi

if [ "$CPU_CORES" -ge 8 ]; then
    SCORE=$((SCORE+1))
fi

if grep -qi hypervisor /proc/cpuinfo; then
    SCORE=$((SCORE+1))
fi

if [ "$SCORE" -ge 4 ]; then
    ASSESSMENT="VDS"
else
    ASSESSMENT="VPS"
fi
;;

esac

# ==========================================================
# Output
# ==========================================================

echo -e "${WHITE}Hostname       :${NC} $HOSTNAME"
echo -e "${WHITE}Operating Sys  :${NC} $OS"
echo -e "${WHITE}Kernel         :${NC} $KERNEL"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo -e "${WHITE}Server Type    :${NC} $SERVER_TYPE"
echo -e "${WHITE}Virtualization :${NC} $VIRT"
echo -e "${WHITE}Machine Type   :${NC} $MACHINE_TYPE"

echo
echo -e "${WHITE}Product Name   :${NC} ${PRODUCT_NAME:-Unknown}"
echo -e "${WHITE}System Vendor  :${NC} ${SYS_VENDOR:-Unknown}"
echo -e "${WHITE}Board Name     :${NC} ${BOARD_NAME:-Unknown}"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo -e "${WHITE}CPU Model      :${NC} $CPU_MODEL"
echo -e "${WHITE}CPU Cores      :${NC} $CPU_CORES"
echo -e "${WHITE}RAM            :${NC} $RAM"
echo -e "${WHITE}Disk Size      :${NC} $DISK"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

case "$ASSESSMENT" in

Container)
echo -e "${BLUE}Environment    : Container${NC}"
;;

Bare\ Metal)
echo -e "${GREEN}Environment    : Bare Metal${NC}"
;;

VDS)
echo -e "${GREEN}Environment    : VDS${NC}"
;;

VPS)
echo -e "${YELLOW}Environment    : VPS${NC}"
;;

*)
echo -e "${WHITE}Environment    : Unknown${NC}"
;;

esac

echo
echo -e "${WHITE}Detection Score:${NC} $SCORE"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$ASSESSMENT" = "Bare Metal" ]; then
    echo -e "${GREEN}RESULT:${NC} Bare Metal Server"
elif [ "$ASSESSMENT" = "Container" ]; then
    echo -e "${BLUE}RESULT:${NC} Container Environment"
else
    echo -e "${CYAN}RESULT:${NC} $ASSESSMENT ($SERVER_TYPE)"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

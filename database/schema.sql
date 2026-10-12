-- HVM Control Panel - MariaDB Schema (Port 7090)
CREATE DATABASE IF NOT EXISTS hvm_panel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hvm_panel;

-- Users Table (Admin & User roles, Bcrypt hash + Admin-visible password, TOTP 2FA)
CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    plain_password VARCHAR(255) DEFAULT NULL,
    role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
    is_suspended TINYINT(1) NOT NULL DEFAULT 0,
    totp_secret VARCHAR(64) DEFAULT NULL,
    totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_username (username),
    INDEX idx_users_email (email),
    INDEX idx_users_role (role)
) ENGINE=InnoDB;

-- Instances Table (VPS = shared resources, VDS = dedicated pinned CPU & locked RAM)
CREATE TABLE IF NOT EXISTS instances (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    uuid CHAR(36) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL UNIQUE,
    hostname VARCHAR(128) NOT NULL DEFAULT 'kvm-node',
    root_password VARCHAR(255) NOT NULL DEFAULT 'root',
    user_id INT UNSIGNED DEFAULT NULL,
    instance_type ENUM('VPS', 'VDS') NOT NULL DEFAULT 'VPS',
    vcpus INT UNSIGNED NOT NULL,
    pinned_cpus VARCHAR(128) DEFAULT NULL COMMENT 'Host physical CPU core list for VDS (e.g. 1,2,3,4)',
    ram_mb INT UNSIGNED NOT NULL,
    disk_gb INT UNSIGNED NOT NULL,
    disk_path VARCHAR(512) NOT NULL,
    os_image VARCHAR(255) NOT NULL,
    network_mode VARCHAR(32) NOT NULL DEFAULT 'ipv4',
    ip_address VARCHAR(128) DEFAULT NULL,
    ipv6_address VARCHAR(128) DEFAULT NULL,
    nat_port INT UNSIGNED DEFAULT NULL,
    vnc_port INT UNSIGNED DEFAULT NULL,
    mac_address CHAR(17) NOT NULL UNIQUE,
    status ENUM('running', 'stopped', 'paused', 'error') NOT NULL DEFAULT 'stopped',
    sshx_url VARCHAR(512) DEFAULT NULL,
    tailscale_url VARCHAR(512) DEFAULT NULL,
    booted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_instances_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_instances_user (user_id),
    INDEX idx_instances_type (instance_type)
) ENGINE=InnoDB;

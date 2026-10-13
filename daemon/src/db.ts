import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const mysqlPool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 7090),
  user: process.env.DB_USER || "hvm_user",
  password: process.env.DB_PASSWORD || "StrongHvmDbPassword123!",
  database: process.env.DB_NAME || "hvm_panel",
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  connectTimeout: 2500,
});

interface LocalStore {
  users: any[];
  instances: any[];
  nextUserId: number;
  nextInstanceId: number;
}

export const DATA_DIR = path.join(__dirname, "..", "data");
const LOCAL_DB_FILE = path.join(DATA_DIR, "hvm_db.json");
let useLocalFallback = false;

function loadLocalStore(): LocalStore {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOCAL_DB_FILE)) {
    const initial: LocalStore = { users: [], instances: [], nextUserId: 1, nextInstanceId: 1 };
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(initial, null, 2), "utf-8");
    return initial;
  }
  return JSON.parse(fs.readFileSync(LOCAL_DB_FILE, "utf-8"));
}

function saveLocalStore(store: LocalStore): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(store, null, 2), "utf-8");
}

async function executeLocalQuery(sql: string, params: any[] = []): Promise<[any, any]> {
  const s = sql.replace(/\s+/g, " ").trim();
  const upper = s.toUpperCase();
  const store = loadLocalStore();

  if (upper.startsWith("CREATE TABLE") || upper.startsWith("ALTER TABLE")) {
    return [[], null];
  }

  // ============================================================================
  // DELETE QUERIES (MUST RUN FIRST BEFORE SELECT/FROM CHECKS)
  // ============================================================================
  if (upper.startsWith("DELETE FROM USERS WHERE ID = ?")) {
    const id = Number(params[0]);
    const before = store.users.length;
    store.users = store.users.filter((x) => Number(x.id) !== id);
    for (const inst of store.instances) {
      if (Number(inst.user_id) === id) inst.user_id = null;
    }
    saveLocalStore(store);
    return [{ affectedRows: before - store.users.length }, null];
  }

  if (upper.startsWith("DELETE FROM INSTANCES WHERE ID = ?")) {
    const id = Number(params[0]);
    const before = store.instances.length;
    store.instances = store.instances.filter((i) => Number(i.id) !== id);
    saveLocalStore(store);
    return [{ affectedRows: before - store.instances.length }, null];
  }

  // ============================================================================
  // USERS QUERIES
  // ============================================================================
  if (upper.startsWith("SELECT") && upper.includes("FROM USERS WHERE USERNAME = ? OR EMAIL = ?")) {
    const [u, e] = params;
    const rows = store.users.filter(
      (x) =>
        x.username.toLowerCase() === String(u).toLowerCase() ||
        x.email.toLowerCase() === String(e).toLowerCase()
    );
    return [rows.slice(0, 1), null];
  }

  if (upper.startsWith("SELECT") && upper.includes("FROM USERS WHERE EMAIL = ? OR USERNAME = ?")) {
    const [e, u] = params;
    const rows = store.users.filter(
      (x) =>
        x.email.toLowerCase() === String(e).toLowerCase() ||
        x.username.toLowerCase() === String(u).toLowerCase()
    );
    return [rows.slice(0, 1), null];
  }

  if (
    upper.startsWith("SELECT") &&
    upper.includes("FROM USERS WHERE LOWER(USERNAME) = ? OR LOWER(EMAIL) = ?")
  ) {
    const [u, e] = params;
    const rows = store.users.filter(
      (x) =>
        x.username.toLowerCase() === String(u).toLowerCase() ||
        x.email.toLowerCase() === String(e).toLowerCase()
    );
    return [rows.slice(0, 1), null];
  }

  if (upper.startsWith("INSERT INTO USERS")) {
    const [username, email, password_hash, plain_password] = params;
    const role = upper.includes("'ADMIN'") ? "admin" : "user";
    const newUser = {
      id: store.nextUserId++,
      username,
      email,
      password_hash,
      plain_password: plain_password || "",
      role,
      is_suspended: 0,
      totp_secret: null,
      totp_enabled: 0,
      created_at: new Date().toISOString(),
    };
    store.users.push(newUser);
    saveLocalStore(store);
    return [{ insertId: newUser.id, affectedRows: 1 }, null];
  }

  if (upper.startsWith("SELECT") && upper.includes("FROM USERS WHERE EMAIL = ? AND ID != ?")) {
    const [email, id] = params;
    const rows = store.users.filter(
      (x) => x.email.toLowerCase() === String(email).toLowerCase() && Number(x.id) !== Number(id)
    );
    return [rows.slice(0, 1), null];
  }

  if (upper.startsWith("SELECT") && upper.includes("FROM USERS WHERE ID = ?")) {
    const id = Number(params[0]);
    const rows = store.users.filter((x) => Number(x.id) === id);
    return [rows.slice(0, 1), null];
  }

  if (upper.startsWith("SELECT") && upper.includes("FROM USERS ORDER BY ID ASC")) {
    const rows = [...store.users].sort((a, b) => Number(a.id) - Number(b.id));
    return [rows, null];
  }

  if (upper.startsWith("UPDATE USERS SET EMAIL = ? WHERE ID = ?")) {
    const [email, id] = params;
    const u = store.users.find((x) => Number(x.id) === Number(id));
    if (u) u.email = email;
    saveLocalStore(store);
    return [{ affectedRows: u ? 1 : 0 }, null];
  }

  if (upper.startsWith("UPDATE USERS SET PASSWORD_HASH = ?, PLAIN_PASSWORD = ? WHERE ID = ?")) {
    const [hash, plain, id] = params;
    const u = store.users.find((x) => Number(x.id) === Number(id));
    if (u) {
      u.password_hash = hash;
      u.plain_password = plain;
    }
    saveLocalStore(store);
    return [{ affectedRows: u ? 1 : 0 }, null];
  }

  if (upper.startsWith("UPDATE USERS SET TOTP_SECRET = ? WHERE ID = ?")) {
    const [secret, id] = params;
    const u = store.users.find((x) => Number(x.id) === Number(id));
    if (u) u.totp_secret = secret;
    saveLocalStore(store);
    return [{ affectedRows: u ? 1 : 0 }, null];
  }

  if (upper.startsWith("UPDATE USERS SET TOTP_ENABLED = 1 WHERE ID = ?")) {
    const [id] = params;
    const u = store.users.find((x) => Number(x.id) === Number(id));
    if (u) u.totp_enabled = 1;
    saveLocalStore(store);
    return [{ affectedRows: u ? 1 : 0 }, null];
  }

  if (upper.startsWith("UPDATE USERS SET TOTP_ENABLED = 0, TOTP_SECRET = NULL WHERE ID = ?")) {
    const [id] = params;
    const u = store.users.find((x) => Number(x.id) === Number(id));
    if (u) {
      u.totp_enabled = 0;
      u.totp_secret = null;
    }
    saveLocalStore(store);
    return [{ affectedRows: u ? 1 : 0 }, null];
  }

  if (upper.startsWith("UPDATE USERS SET IS_SUSPENDED = ? WHERE ID = ?")) {
    const [state, id] = params;
    const u = store.users.find((x) => Number(x.id) === Number(id));
    if (u) u.is_suspended = Number(state);
    saveLocalStore(store);
    return [{ affectedRows: u ? 1 : 0 }, null];
  }

  // ============================================================================
  // INSTANCES QUERIES
  // ============================================================================
  if (
    upper.startsWith("SELECT") &&
    upper.includes("SELECT PINNED_CPUS FROM INSTANCES WHERE INSTANCE_TYPE = 'VDS'")
  ) {
    const rows = store.instances.filter((i) => i.instance_type === "VDS" && i.pinned_cpus);
    return [rows, null];
  }

  if (
    upper.startsWith("SELECT") &&
    upper.includes("SELECT NAT_PORT FROM INSTANCES WHERE NAT_PORT IS NOT NULL")
  ) {
    const rows = store.instances.filter((i) => i.nat_port != null);
    return [rows, null];
  }

  if (
    upper.startsWith("SELECT") &&
    upper.includes("SELECT VNC_PORT FROM INSTANCES WHERE VNC_PORT IS NOT NULL")
  ) {
    const rows = store.instances.filter((i) => i.vnc_port != null);
    return [rows, null];
  }

  if (upper.startsWith("SELECT") && upper.includes("FROM INSTANCES WHERE NAME = ?")) {
    const [name] = params;
    const rows = store.instances.filter((i) => i.name.toLowerCase() === String(name).toLowerCase());
    return [rows.slice(0, 1), null];
  }

  if (upper.startsWith("INSERT INTO INSTANCES")) {
    const [
      uuid,
      name,
      hostname,
      root_password,
      user_id,
      instance_type,
      vcpus,
      pinned_cpus,
      ram_mb,
      disk_gb,
      disk_path,
      os_image,
      network_mode,
      ip_address,
      ipv6_address,
      nat_port,
      vnc_port,
      mac_address,
      status,
    ] = params;
    const now = new Date().toISOString();
    const newInst = {
      id: store.nextInstanceId++,
      uuid,
      name,
      hostname: hostname || name,
      root_password: root_password || "root",
      user_id: user_id ?? null,
      instance_type,
      vcpus,
      pinned_cpus,
      ram_mb,
      disk_gb,
      disk_path,
      os_image,
      network_mode: network_mode || "ipv4",
      ip_address,
      ipv6_address: ipv6_address || null,
      nat_port: nat_port || null,
      vnc_port: vnc_port || 5901,
      mac_address,
      status,
      sshx_url: null,
      tailscale_url: null,
      booted_at: now,
      created_at: now,
    };
    store.instances.push(newInst);
    saveLocalStore(store);
    return [{ insertId: newInst.id, affectedRows: 1 }, null];
  }

  if (upper.startsWith("SELECT") && upper.includes("FROM INSTANCES WHERE ID = ?")) {
    const id = Number(params[0]);
    const rows = store.instances.filter((i) => Number(i.id) === id);
    return [rows.slice(0, 1), null];
  }

  if (
    upper.startsWith("SELECT") &&
    upper.includes("FROM INSTANCES I LEFT JOIN USERS U ON I.USER_ID = U.ID WHERE I.USER_ID = ?")
  ) {
    const userId = Number(params[0]);
    const rows = store.instances
      .filter((i) => Number(i.user_id) === userId)
      .map((i) => {
        const owner = store.users.find((u) => Number(u.id) === Number(i.user_id));
        return { ...i, owner_email: owner ? owner.email : null };
      })
      .sort((a, b) => Number(b.id) - Number(a.id));
    return [rows, null];
  }

  if (
    upper.startsWith("SELECT") &&
    upper.includes("FROM INSTANCES I LEFT JOIN USERS U ON I.USER_ID = U.ID")
  ) {
    const rows = store.instances
      .map((i) => {
        const owner = store.users.find((u) => Number(u.id) === Number(i.user_id));
        return { ...i, owner_email: owner ? owner.email : null };
      })
      .sort((a, b) => Number(b.id) - Number(a.id));
    return [rows, null];
  }

  if (
    upper.startsWith("SELECT") &&
    upper.includes("FROM INSTANCES WHERE USER_ID = ? ORDER BY ID DESC")
  ) {
    const userId = Number(params[0]);
    const rows = store.instances
      .filter((i) => Number(i.user_id) === userId)
      .sort((a, b) => Number(b.id) - Number(a.id));
    return [rows, null];
  }

  if (upper.startsWith("SELECT") && upper.includes("FROM INSTANCES ORDER BY ID DESC")) {
    const rows = [...store.instances].sort((a, b) => Number(b.id) - Number(a.id));
    return [rows, null];
  }

  if (upper.startsWith("UPDATE INSTANCES SET USER_ID = ? WHERE ID = ?")) {
    const [userId, id] = params;
    const inst = store.instances.find((i) => Number(i.id) === Number(id));
    if (inst) inst.user_id = userId ?? null;
    saveLocalStore(store);
    return [{ affectedRows: inst ? 1 : 0 }, null];
  }

  if (upper.startsWith("UPDATE INSTANCES SET SSHX_URL = ? WHERE ID = ?")) {
    const [sshxUrl, id] = params;
    const inst = store.instances.find((i) => Number(i.id) === Number(id));
    if (inst) inst.sshx_url = sshxUrl ?? null;
    saveLocalStore(store);
    return [{ affectedRows: inst ? 1 : 0 }, null];
  }

  if (upper.startsWith("UPDATE INSTANCES SET TAILSCALE_URL = ? WHERE ID = ?")) {
    const [tsUrl, id] = params;
    const inst = store.instances.find((i) => Number(i.id) === Number(id));
    if (inst) inst.tailscale_url = tsUrl ?? null;
    saveLocalStore(store);
    return [{ affectedRows: inst ? 1 : 0 }, null];
  }

  if (
    upper.startsWith("UPDATE INSTANCES SET STATUS = ?, BOOTED_AT = NOW() WHERE ID = ?") ||
    upper.startsWith("UPDATE INSTANCES SET STATUS = ?, BOOTED_AT = ? WHERE ID = ?")
  ) {
    const isNow = upper.includes("BOOTED_AT = NOW()");
    const status = params[0];
    const bootedAt = isNow ? new Date().toISOString() : params[1];
    const id = isNow ? params[1] : params[2];
    const inst = store.instances.find((i) => Number(i.id) === Number(id));
    if (inst) {
      inst.status = status;
      inst.booted_at = bootedAt;
      inst.sshx_url = null;
      inst.tailscale_url = null;
    }
    saveLocalStore(store);
    return [{ affectedRows: inst ? 1 : 0 }, null];
  }

  if (upper.startsWith("UPDATE INSTANCES SET STATUS = ? WHERE ID = ?")) {
    const [status, id] = params;
    const inst = store.instances.find((i) => Number(i.id) === Number(id));
    if (inst) {
      inst.status = status;
      if (status !== "running") {
        inst.sshx_url = null;
        inst.tailscale_url = null;
      }
    }
    saveLocalStore(store);
    return [{ affectedRows: inst ? 1 : 0 }, null];
  }

  if (
    upper.startsWith(
      "UPDATE INSTANCES SET OS_IMAGE = ?, ROOT_PASSWORD = ?, STATUS = 'RUNNING', BOOTED_AT = NOW() WHERE ID = ?"
    ) ||
    upper.startsWith(
      "UPDATE INSTANCES SET OS_IMAGE = ?, ROOT_PASSWORD = ?, STATUS = 'RUNNING', BOOTED_AT = ? WHERE ID = ?"
    )
  ) {
    const isNow = upper.includes("BOOTED_AT = NOW()");
    const [osImage, rootPass] = params;
    const bootedAt = isNow ? new Date().toISOString() : params[2];
    const id = isNow ? params[2] : params[3];
    const inst = store.instances.find((i) => Number(i.id) === Number(id));
    if (inst) {
      inst.os_image = osImage;
      inst.root_password = rootPass;
      inst.status = "running";
      inst.booted_at = bootedAt;
      inst.sshx_url = null;
      inst.tailscale_url = null;
    }
    saveLocalStore(store);
    return [{ affectedRows: inst ? 1 : 0 }, null];
  }

  return [[], null];
}

export const pool = {
  async query<T = any>(sql: string, params?: any[]): Promise<[T, any]> {
    if (useLocalFallback) {
      return executeLocalQuery(sql, params) as Promise<[T, any]>;
    }
    return (await mysqlPool.query(sql, params)) as unknown as [T, any];
  },
  async getConnection() {
    if (useLocalFallback) {
      return {
        query: (sql: string, params?: any[]) => executeLocalQuery(sql, params),
        release: () => {},
      };
    }
    return await mysqlPool.getConnection();
  },
};

export async function initDatabase(): Promise<void> {
  try {
    const testConn = await mysqlPool.getConnection();
    testConn.release();
    useLocalFallback = false;
  } catch {
    useLocalFallback = true;
  }

  const conn = await pool.getConnection();
  try {
    await conn.query(`
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
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS instances (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        uuid CHAR(36) NOT NULL UNIQUE,
        name VARCHAR(128) NOT NULL UNIQUE,
        hostname VARCHAR(128) NOT NULL DEFAULT 'kvm-node',
        root_password VARCHAR(255) NOT NULL DEFAULT 'root',
        user_id INT UNSIGNED DEFAULT NULL,
        instance_type ENUM('VPS', 'VDS') NOT NULL DEFAULT 'VPS',
        vcpus INT UNSIGNED NOT NULL,
        pinned_cpus VARCHAR(128) DEFAULT NULL,
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
    `);

    await conn.query(`
      ALTER TABLE instances ADD COLUMN IF NOT EXISTS port_forwards VARCHAR(255) DEFAULT NULL;
    `).catch(() => {});
    await conn.query(`
      ALTER TABLE instances ADD COLUMN IF NOT EXISTS virt_type VARCHAR(32) DEFAULT 'kvm';
    `).catch(() => {});

    const adminUsername = process.env.DEFAULT_ADMIN_USERNAME || "admin";
    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || "admin@hvm.local";
    const adminPass = process.env.DEFAULT_ADMIN_PASSWORD || "admin";

    const [rows] = await conn.query(
      "SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1",
      [adminUsername, adminEmail]
    );

    if ((rows as any[]).length === 0) {
      const hash = await bcrypt.hash(adminPass, 10);
      await conn.query(
        "INSERT INTO users (username, email, password_hash, plain_password, role) VALUES (?, ?, ?, ?, 'admin')",
        [adminUsername, adminEmail, hash, adminPass]
      );
    } else if (useLocalFallback) {
      const store = loadLocalStore();
      const adm = store.users.find((u) => u.username === adminUsername);
      if (adm && !adm.plain_password) {
        adm.plain_password = adminPass;
        saveLocalStore(store);
      }
    }
  } finally {
    conn.release();
  }
}

import { Router, Request, Response } from "express";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import mysql from "mysql2/promise";
import { pool } from "../db";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { LibvirtService, IMAGES_DIR, InstanceType } from "../libvirt";
import { QemuVpsService } from "../qemu";

const router = Router();

router.use(requireAuth, requireAdmin);

// ==========================================
// USER MANAGEMENT (ADMIN CAN SEE USERNAME, EMAIL/GMAIL, AND PASSWORD)
// ==========================================
router.get("/users", async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id, username, email, plain_password, role, is_suspended, totp_enabled, created_at FROM users ORDER BY id ASC"
    );
    res.json(
      rows.map((u) => ({
        ...u,
        plain_password: u.plain_password || "••••••••",
        is_suspended: Boolean(u.is_suspended),
        totp_enabled: Boolean(u.totp_enabled),
      }))
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/users/:id/suspend", async (req: Request, res: Response) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.user!.id) {
      res.status(400).json({ error: "You cannot suspend your own administrator account" });
      return;
    }

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id, is_suspended FROM users WHERE id = ? LIMIT 1",
      [targetId]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const nextState = rows[0].is_suspended ? 0 : 1;
    await pool.query("UPDATE users SET is_suspended = ? WHERE id = ?", [nextState, targetId]);
    res.json({ id: targetId, is_suspended: Boolean(nextState) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/users/:id", async (req: Request, res: Response) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.user!.id) {
      res.status(400).json({ error: "You cannot delete your own administrator account" });
      return;
    }

    await pool.query("DELETE FROM users WHERE id = ?", [targetId]);
    res.json({ message: "User account deleted" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// HVM PROVISIONING (VPS & VDS, IPv4, IPv6-Only, Dual-Stack, NAT Auto-Port)
// ==========================================
router.post("/instances", async (req: Request, res: Response) => {
  try {
    const {
      name,
      hostname,
      root_password,
      instance_type,
      vcpus,
      ram_mb,
      disk_gb,
      os_image,
      ip_address,
      ipv6_address,
      network_mode,
      user_id,
    } = req.body;

    if (!name || !/^[a-zA-Z0-9-_]+$/.test(name)) {
      res.status(400).json({ error: "VPS/VDS Name must be alphanumeric (hyphens/underscores allowed)" });
      return;
    }

    const guestHostname = String(hostname || name).trim();
    const rootPass = String(root_password || "root123").trim();
    const type: InstanceType = instance_type === "VDS" ? "VDS" : "VPS";
    const cpuCount = Math.max(1, Number(vcpus || 1));
    const ramMb = Math.max(512, Number(ram_mb || 1024));
    const diskGb = Math.max(5, Number(disk_gb || 20));
    const image = String(os_image || "ubuntu-24.04-server-cloudimg-amd64.qcow2");
    const netMode = String(network_mode || "ipv4");

    const [dup] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM instances WHERE name = ? LIMIT 1",
      [name]
    );
    if (dup.length > 0) {
      res.status(400).json({ error: "An instance with that name already exists" });
      return;
    }

    // If VDS, allocate dedicated physical CPU cores
    let pinnedCores: number[] | undefined;
    let pinnedStr: string | null = null;
    if (type === "VDS") {
      pinnedCores = await LibvirtService.allocateDedicatedCores(cpuCount);
      pinnedStr = pinnedCores.join(",");
    }

    const vmUuid = uuidv4();
    const macAddress = LibvirtService.generateMac();
    const diskPath = path.posix.join(IMAGES_DIR, `${name}.qcow2`);
    const vncPort = await LibvirtService.allocateUnusedVncPort();

    const trimmedIp = typeof ip_address === "string" ? ip_address.trim() : "";
    const trimmedIpv6 = typeof ipv6_address === "string" ? ipv6_address.trim() : "";
    const hexBlock = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");

    let assignedIp: string | null = null;
    let assignedIpv6: string | null = null;
    let assignedNatPort: number | null = null;

    const requestedPort = req.body.ssh_port ? Number(req.body.ssh_port) : null;
    if (requestedPort && requestedPort >= 1024 && requestedPort <= 65535) {
      assignedNatPort = requestedPort;
    } else {
      assignedNatPort = await LibvirtService.allocateUnusedNatPort();
    }

    if (netMode === "nat") {
      const internalOctet = (assignedNatPort % 200) + 20;
      assignedIp = `NAT 10.0.80.${internalOctet} (SSH :${assignedNatPort})`;
    } else if (netMode === "ipv6_only") {
      assignedIpv6 = trimmedIpv6 || trimmedIp || `fd00:hvm:2026::${hexBlock}/64`;
      assignedIp = assignedIpv6;
    } else if (netMode === "dual_stack") {
      assignedIp = trimmedIp || `192.168.122.${Math.floor(Math.random() * 220) + 20}`;
      assignedIpv6 = trimmedIpv6 || `fd00:hvm:2026::${hexBlock}/64`;
    } else if (netMode === "none") {
      assignedIp = "No IPv4 / No IPv6 (Isolated L2)";
    } else {
      assignedIp = trimmedIp || `192.168.122.${Math.floor(Math.random() * 220) + 20}`;
    }

    const hasHostKvm = QemuVpsService.hasKvmAcceleration();
    const requestedVirt = req.body.virt_type;
    const virtType: "kvm" | "qemu" =
      requestedVirt === "qemu" || requestedVirt === "non-kvm" || !hasHostKvm ? "qemu" : "kvm";

    const initialStatus: "running" | "stopped" = "running";
    const domainSpec = {
      uuid: vmUuid,
      name,
      hostname: guestHostname,
      rootPassword: rootPass,
      instanceType: type,
      vcpus: cpuCount,
      pinnedCores,
      ramMb,
      diskGb,
      diskPath,
      macAddress,
      osImage: image,
      ipAddress: assignedIp,
      ipv6Address: assignedIpv6,
      natPort: assignedNatPort,
      vncPort,
      networkMode: netMode,
      virtType,
      portForwards: req.body.port_forwards ? String(req.body.port_forwards).trim() : "",
      guiMode: Boolean(req.body.gui_mode),
    };

    try {
      const seedIsoPath = await LibvirtService.createDiskAndSeedIso(domainSpec);
      const domainXml = LibvirtService.buildDomainXml({ ...domainSpec, seedIsoPath });
      await LibvirtService.defineAndStartXml(domainXml, name);
    } catch (libvirtErr: any) {
      console.warn(`[HVM-Libvirt] Hypervisor note (${name}): ${libvirtErr.message}`);
    }

    const [result] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO instances
       (uuid, name, hostname, root_password, user_id, instance_type, vcpus, pinned_cpus, ram_mb, disk_gb, disk_path, os_image, network_mode, ip_address, ipv6_address, nat_port, vnc_port, mac_address, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vmUuid,
        name,
        guestHostname,
        rootPass,
        user_id ? Number(user_id) : null,
        type,
        cpuCount,
        pinnedStr,
        ramMb,
        diskGb,
        domainSpec.diskPath,
        image,
        netMode,
        assignedIp,
        assignedIpv6,
        domainSpec.natPort,
        vncPort,
        macAddress,
        initialStatus,
      ]
    );

    const [created] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM instances WHERE id = ? LIMIT 1",
      [result.insertId]
    );
    const createdInst = created[0];
    const bootState = LibvirtService.getBootState(createdInst);
    res.status(201).json({
      ...createdInst,
      status: bootState.effectiveStatus,
      boot_progress: bootState.bootProgress,
      sshx_url: null,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Failed to provision instance" });
  }
});

// Assign existing VPS/VDS to a specific registered user
router.patch("/instances/:id/assign", async (req: Request, res: Response) => {
  try {
    const instanceId = Number(req.params.id);
    const { user_id } = req.body;

    await pool.query("UPDATE instances SET user_id = ? WHERE id = ?", [
      user_id ? Number(user_id) : null,
      instanceId,
    ]);
    res.json({ id: instanceId, user_id: user_id ? Number(user_id) : null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete instance & destroy underlying libvirt domain + disk
router.delete("/instances/:id", async (req: Request, res: Response) => {
  try {
    const instanceId = Number(req.params.id);
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM instances WHERE id = ? LIMIT 1",
      [instanceId]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    const inst = rows[0];
    await LibvirtService.destroyAndDelete(inst.name, inst.disk_path, inst.uuid, instanceId);
    await pool.query("DELETE FROM instances WHERE id = ?", [instanceId]);

    res.json({ message: `Instance ${inst.name} destroyed and removed` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

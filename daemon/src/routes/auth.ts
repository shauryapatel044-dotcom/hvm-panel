import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import mysql from "mysql2/promise";
import { pool } from "../db";
import { requireAuth, signToken } from "../middleware/auth";

const router = Router();

// Register a new user account (saves plain_password for Admin visibility alongside bcrypt hash)
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const derivedUsername = username
      ? String(username).trim().toLowerCase()
      : normalizedEmail.split("@")[0] + "_" + Math.floor(Math.random() * 1000);

    const [existing] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1",
      [normalizedEmail, derivedUsername]
    );
    if (existing.length > 0) {
      res.status(400).json({ error: "Username or Email address is already registered" });
      return;
    }

    const passwordStr = String(password);
    const passwordHash = await bcrypt.hash(passwordStr, 10);
    const [result] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO users (username, email, password_hash, plain_password, role) VALUES (?, ?, ?, ?, 'user')",
      [derivedUsername, normalizedEmail, passwordHash, passwordStr]
    );

    const user = {
      id: result.insertId,
      username: derivedUsername,
      email: normalizedEmail,
      role: "user" as const,
      totp_enabled: false,
    };
    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Registration failed" });
  }
});

// Login with Username OR Email, Password, and optional TOTP 2FA code
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { identifier, email, username, password, totp_code } = req.body;
    const loginId = String(identifier || email || username || "").trim().toLowerCase();

    if (!loginId || !password) {
      res.status(400).json({ error: "Username/Email and password are required" });
      return;
    }

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ? LIMIT 1",
      [loginId, loginId]
    );

    if (rows.length === 0) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const user = rows[0];
    const validPassword = await bcrypt.compare(String(password), user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (user.is_suspended) {
      res.status(403).json({ error: "Account is suspended by an administrator" });
      return;
    }

    if (user.totp_enabled) {
      if (!totp_code) {
        res.status(200).json({ require_2fa: true, message: "2FA code required" });
        return;
      }
      const isValidTotp = authenticator.check(String(totp_code).trim(), user.totp_secret);
      if (!isValidTotp) {
        res.status(401).json({ error: "Invalid 2FA authenticator code" });
        return;
      }
    }

    const token = signToken({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    });
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        totp_enabled: Boolean(user.totp_enabled),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Login failed" });
  }
});

// Get current user profile
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  res.json({ user: req.user });
});

// Profile Update: Email & Password
router.put("/profile", requireAuth, async (req: Request, res: Response) => {
  try {
    const { email, current_password, new_password } = req.body;
    const userId = req.user!.id;

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    const dbUser = rows[0];

    if (email && email.trim().toLowerCase() !== dbUser.email) {
      const newEmail = email.trim().toLowerCase();
      const [conflict] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1",
        [newEmail, userId]
      );
      if (conflict.length > 0) {
        res.status(400).json({ error: "Email address is already in use" });
        return;
      }
      await pool.query("UPDATE users SET email = ? WHERE id = ?", [newEmail, userId]);
      dbUser.email = newEmail;
    }

    if (new_password) {
      if (!current_password) {
        res.status(400).json({ error: "Current password is required to set a new password" });
        return;
      }
      const matches = await bcrypt.compare(String(current_password), dbUser.password_hash);
      if (!matches) {
        res.status(400).json({ error: "Current password is incorrect" });
        return;
      }
      const newPassStr = String(new_password);
      const newHash = await bcrypt.hash(newPassStr, 10);
      await pool.query(
        "UPDATE users SET password_hash = ?, plain_password = ? WHERE id = ?",
        [newHash, newPassStr, userId]
      );
    }

    res.json({
      message: "Profile updated successfully",
      user: {
        id: dbUser.id,
        username: dbUser.username,
        email: dbUser.email,
        role: dbUser.role,
        totp_enabled: Boolean(dbUser.totp_enabled),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to update profile" });
  }
});

// Generate TOTP Secret & QR Code for Google Authenticator
router.post("/2fa/setup", requireAuth, async (req: Request, res: Response) => {
  try {
    const secret = authenticator.generateSecret();
    const otpauthUri = authenticator.keyuri(req.user!.email, "HVM Control Panel", secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);

    await pool.query("UPDATE users SET totp_secret = ? WHERE id = ?", [secret, req.user!.id]);
    res.json({ secret, otpauth_uri: otpauthUri, qr_code: qrCodeDataUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to setup 2FA" });
  }
});

// Verify TOTP code and enable 2FA
router.post("/2fa/enable", requireAuth, async (req: Request, res: Response) => {
  try {
    const { totp_code } = req.body;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT totp_secret FROM users WHERE id = ? LIMIT 1",
      [req.user!.id]
    );
    const secret = rows[0]?.totp_secret;
    if (!secret) {
      res.status(400).json({ error: "Run 2FA setup first" });
      return;
    }

    const isValid = authenticator.check(String(totp_code || "").trim(), secret);
    if (!isValid) {
      res.status(400).json({ error: "Invalid 6-digit verification code" });
      return;
    }

    await pool.query("UPDATE users SET totp_enabled = 1 WHERE id = ?", [req.user!.id]);
    res.json({ message: "Two-Factor Authentication (2FA) enabled", totp_enabled: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to enable 2FA" });
  }
});

// Disable 2FA
router.post("/2fa/disable", requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?", [
      req.user!.id,
    ]);
    res.json({ message: "Two-Factor Authentication (2FA) disabled", totp_enabled: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to disable 2FA" });
  }
});

export default router;

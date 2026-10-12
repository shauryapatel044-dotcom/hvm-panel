import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../db";
import mysql from "mysql2/promise";

const JWT_SECRET = process.env.JWT_SECRET || "change-this-super-secret-hvm-jwt-key-in-production";

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  role: "admin" | "user";
  is_suspended: boolean;
  totp_enabled: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: {
  id: number;
  username: string;
  email: string;
  role: "admin" | "user";
}): string {
  return jwt.sign(
    { sub: user.id, username: user.username, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as { sub: number | string };
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id, username, email, role, is_suspended, totp_enabled FROM users WHERE id = ? LIMIT 1",
      [Number(payload.sub)]
    );

    if (rows.length === 0) {
      res.status(401).json({ error: "User no longer exists" });
      return;
    }

    const user = rows[0] as AuthUser;
    if (user.is_suspended) {
      res.status(403).json({ error: "Your account has been suspended by an administrator" });
      return;
    }

    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      is_suspended: Boolean(user.is_suspended),
      totp_enabled: Boolean(user.totp_enabled),
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired JWT token" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Administrator privileges required" });
    return;
  }
  next();
}

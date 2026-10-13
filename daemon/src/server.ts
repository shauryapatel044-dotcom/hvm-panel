import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initDatabase } from "./db";
import { LibvirtService } from "./libvirt";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import instanceRoutes from "./routes/instances";
import systemRoutes from "./routes/system";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 5090);

app.use(cors());
app.use(express.json());

// Healthcheck
app.get("/api/health", (_req, res) => {
  res.json({
    service: "hvm-daemon",
    status: "ok",
    port: PORT,
    hypervisor: process.env.LIBVIRT_URI || "qemu:///system",
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/instances", instanceRoutes);
app.use("/api/system", systemRoutes);

async function bootstrap() {
  try {
    await initDatabase();
    LibvirtService.initWslKeeper();
    console.log("[HVM-Daemon] Connected to Database & initialized WSL2 Linux kernel keeper");
  } catch (err: any) {
    console.error("[HVM-Daemon] Database initialization error:", err.message);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[HVM-Daemon] Listening on http://0.0.0.0:${PORT}`);
  });
}

bootstrap();

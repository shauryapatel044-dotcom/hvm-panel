import { Router, Request, Response } from "express";
import { EnvironmentDetector } from "../environment";
import { requireAuth } from "../middleware/auth";
import { QemuVpsService } from "../qemu";

const router = Router();

// Allow authenticated users to view environment details
router.use(requireAuth);

/**
 * GET /api/system/environment
 * Returns the detected server environment according to hopingboyz detect-server.sh
 */
router.get("/environment", async (_req: Request, res: Response) => {
  try {
    const envInfo = await EnvironmentDetector.detect(false);
    res.json(envInfo);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/system/environment/detect
 * Forces a fresh detection run
 */
router.post("/environment/detect", async (_req: Request, res: Response) => {
  try {
    const envInfo = await EnvironmentDetector.detect(true);
    res.json(envInfo);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/system/capabilities
 * Returns hypervisor and virtualization capabilities
 */
router.get("/capabilities", async (_req: Request, res: Response) => {
  try {
    const envInfo = await EnvironmentDetector.detect(false);
    const hasKvm = QemuVpsService.hasKvmAcceleration();
    res.json({
      hasKvm,
      supportsTcg: true,
      defaultVirtType: hasKvm ? "kvm" : "qemu",
      serverType: envInfo.serverType,
      virt: envInfo.virt,
      assessment: envInfo.assessment,
      score: envInfo.score,
      cpuModel: envInfo.cpuModel,
      cpuCores: envInfo.cpuCores,
      ram: envInfo.ram,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

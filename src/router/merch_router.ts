import { Router } from "express";

import * as merchController from "@/controllers/merch_controller";

const router: Router = Router();

// Mounted under /merch behind verifyToken. Returns 404 unless MERCH_PREVIEWS_ENABLED=true.
router.get("/previews/:generationId", merchController.getPreviews);

export default router;

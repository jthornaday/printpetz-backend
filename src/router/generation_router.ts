import { Router } from "express";

import * as generationController from "@/controllers/generation_controller";

const router: Router = Router();

router.post("/create", generationController.createImage);
router.get("/:id/download", generationController.downloadImage);
router.post("/edit-look", generationController.editLook);
router.post("/remove-background", generationController.removeBackground);

export default router;

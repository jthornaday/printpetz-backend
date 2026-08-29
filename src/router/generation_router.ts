import { Router } from "express";

import * as generationController from "@/controllers/generation_controller";

const router: Router = Router();

router.post("/create", generationController.createImage);
router.post("/edit-look", generationController.editLook);
router.post("/remove-background", generationController.removeBackground);

export default router;

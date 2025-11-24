import { Router } from "express";

import * as generationController from "@/controllers/generation_controller";

const router: Router = Router();

router.post("/create", generationController.createImage);

export default router;

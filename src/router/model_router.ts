import { Router } from "express";

import * as modelController from "@/controllers/model_controller";

const router: Router = Router();

router.post("/train", modelController.trainModel);

export default router;

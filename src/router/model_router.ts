import { Router } from "express";

import * as modelController from "@/controllers/model_controller";

const router: Router = Router();

router.post("/train", modelController.trainModel);
router.delete("/:id", modelController.deleteModel);

export default router;

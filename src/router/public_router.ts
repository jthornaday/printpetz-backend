import { Router } from "express";

import * as publicController from "@/controllers/public_controller";

const router: Router = Router();

router.get("/test", publicController.test);

export default router;

import { Router } from "express";
import multer from "multer";

import * as fileController from "@/controllers/file_controller";

const upload = multer();
const router: Router = Router();

router.post("/upload", upload.array("file", 5), fileController.uploadFile);

export default router;

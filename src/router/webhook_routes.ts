import { Router } from "express";

import * as webhookController from "@/controllers/webhook_controller";

const router: Router = Router();

// router.post(
//   "/stripe/checkout-completed",
//   webhookController.stripeEventForCheckout,
// );
router.post("/fal/training-result", webhookController.falTrainingResult);
router.post(
  "/fal/generation-result",
  webhookController.falImageGenerationResult,
);

export default router;

import { Router } from "express";

import * as stripeController from "@/controllers/stripe_controller";

const router: Router = Router();

router.post("/checkout", stripeController.handleCheckoutSession);

export default router;

import { Router } from "express";

import * as shopifyWebhookController from "@/controllers/shopify_webhook_controller";

const router: Router = Router();

// Mounted under /webhook. Full path: POST /webhook/shopify/orders-paid
router.post("/orders-paid", shopifyWebhookController.shopifyOrderPaid);

export default router;

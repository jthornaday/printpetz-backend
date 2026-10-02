import { Router } from "express";

import * as shopifyWebhookController from "@/controllers/shopify_webhook_controller";

const router: Router = Router();

// Mounted under /webhook. Full path: POST /webhook/shopify/orders-paid
router.post("/orders-paid", shopifyWebhookController.shopifyOrderPaid);
// POST /webhook/shopify/orders-cancelled and /webhook/shopify/refunds-create (launch checklist B2)
router.post(
  "/orders-cancelled",
  shopifyWebhookController.shopifyOrderCancelled,
);
router.post("/refunds-create", shopifyWebhookController.shopifyRefundCreated);

export default router;

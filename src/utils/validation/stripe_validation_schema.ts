import { z } from "zod";

export const checkoutSessionSchema = z.object({
  priceId: z.string(),
  redirectUrl: z.string().optional(),
});

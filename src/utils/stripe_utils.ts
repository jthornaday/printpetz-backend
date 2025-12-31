import Stripe from "stripe";

import AppConstants from "@/constants/app_constants";
import { IPrice } from "@/types/price";

import errorResponse from "./errors/errorResponse";

export const getStripeEventFromRawBody = (
  rawPayload: string | Buffer,
  sig: string | Buffer | string[],
  type: "CHECKOUT" | "PRICE_CHANGE",
) => {
  if (!rawPayload) {
    throw errorResponse.Api400Error({
      errorDescription: "missing payload",
    });
  }

  const stripe = new Stripe(AppConstants.stripeKey);

  const stripeWebhookSecret =
    type === "CHECKOUT"
      ? AppConstants.stripeCheckoutWebhookSecret
      : AppConstants.stripePriceChangeWebhookSecret;

  return stripe.webhooks.constructEvent(rawPayload, sig, stripeWebhookSecret);
};

export const priceObjectFromStripeEvent = (
  event: Stripe.PriceCreatedEvent | Stripe.PriceUpdatedEvent,
): Partial<IPrice> => {
  const stripePrice = event.data.object;
  const { name, credits, popular, description } = stripePrice.metadata;

  return {
    name: name ?? null,
    description: description ?? null,
    credits: credits ? Number(credits) : 0,
    amount: stripePrice.unit_amount / 100,
    currency: stripePrice.currency,
    is_active: stripePrice.active,
    is_test_mode: !stripePrice.livemode,
    is_most_popular: popular === "true",
    price_id: stripePrice.id,
  };
};

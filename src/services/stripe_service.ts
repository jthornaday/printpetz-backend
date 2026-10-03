import Stripe from "stripe";

import AppConstants from "@/constants/app_constants";
import { IPrice } from "@/types/price";
import { IUser } from "@/types/user";
import errorResponse from "@/utils/errors/errorResponse";
import { getStripeEventFromRawBody } from "@/utils/stripe_utils";

import { addErrorLog } from "./error_logs_service";
import { unlockFreeImages } from "./generation_service";
import { getPriceByPriceId } from "./price_service";
import { syncPricesFromStripe } from "./price_sync_service";
import { addPurchase } from "./purchase_service";
import {
  addPaidCredits,
  getUser,
  getUserByStripeCustomerId,
  updateUser,
} from "./user_service";

type CheckoutSessionProps = {
  price: IPrice;
  redirectUrl: string;
  metadata: {
    credits: string;
    userId: string;
    priceId: string;
  };
  stripeCustomerId: string;
};

const stripe = new Stripe(AppConstants.stripeKey);

/**
 * Create a stripe customer.
 * @param user The user data
 * @returns The stripe customer id
 */
export const createStripeCustomer = async (user: IUser) => {
  const dataToCreate = {
    name: user.name,
    email: user.email,
    metadata: {
      user_id: user.id,
    },
  };
  const customer = await stripe.customers.create(dataToCreate);

  await updateUser({
    id: user.id,
    stripe_customer_id: customer.id,
  });

  return customer.id;
};

/**
 * Create a checkout session.
 * @param input The checkout session props
 * @returns The checkout session url and id
 */
export const createCheckoutSession = async (input: CheckoutSessionProps) => {
  const { price, redirectUrl, metadata, stripeCustomerId } = input;

  // Successful purchases should return users to the creation flow, not back to
  // the credit purchase page. Keep the original page as the cancel destination.
  const clientBaseUrl = AppConstants.clientBaseUrl.replace(/\/$/, "");
  const successUrl = `${clientBaseUrl}/create?purchase=success&id=${price.id}&session_id={CHECKOUT_SESSION_ID}`;
  const failedUrl = `${redirectUrl}?id=${price.id}&success=false`;

  const session = await stripe.checkout.sessions.create({
    line_items: [{ price: price.price_id, quantity: 1 }],
    metadata,
    customer: stripeCustomerId,
    mode: "payment",
    success_url: successUrl,
    cancel_url: failedUrl,
  });

  return { id: session.id, url: session.url };
};

/**
 * Handle a price change event.
 * @param rawPayload The raw payload of the event
 * @param sig The signature of the event
 */
/**
 * Any price or product change: re-sync every credit pack from Stripe (price_sync_service). A failure
 * throws, so the webhook answers an error and Stripe retries, instead of a silent half-update.
 */
export const handlePriceChange = async (
  rawPayload: string | Buffer,
  sig: string | Buffer | string[],
) => {
  const event = getStripeEventFromRawBody(rawPayload, sig, "PRICE_CHANGE");
  if (
    !event.type.startsWith("price.") &&
    event.type !== "product.updated" &&
    event.type !== "product.deleted"
  ) {
    console.log(`Unhandled event type ${event.type}`);
    return;
  }
  const result = await syncPricesFromStripe(stripe);
  console.log(
    "[stripe-prices] synced",
    JSON.stringify({ event: event.type, ...result }),
  );
};

/**
 * Handle a checkout session completed event.
 * @param rawPayload The raw payload of the event
 * @param sig The signature of the event
 */
export const handleCheckout = async (
  rawPayload: string | Buffer,
  sig: string | Buffer | string[],
) => {
  const event = getStripeEventFromRawBody(rawPayload, sig, "CHECKOUT");
  if (event?.type !== "checkout.session.completed") {
    console.log(`Unhandled event type ${event.type}`);
    return;
  }

  // Handle the event
  const checkoutSessionObject = event.data.object;
  const { userId, credits, priceId } = checkoutSessionObject.metadata;

  const stripeCustomerId = checkoutSessionObject.customer as string;

  const [user, price] = await Promise.all([
    stripeCustomerId
      ? getUserByStripeCustomerId(stripeCustomerId)
      : getUser(userId),
    getPriceByPriceId(priceId),
  ]);
  if (!user || !price) {
    throw errorResponse.Api404Error({
      errorDescription: `${!user ? "User" : "Price"} not found`,
    });
  }

  // Cards complete as "paid". Anything else (a delayed bank payment) hasn't been paid yet, so no
  // credits: those would arrive with checkout.session.async_payment_succeeded, which we don't
  // offer today.
  if (checkoutSessionObject.payment_status !== "paid") {
    addErrorLog({
      input: JSON.stringify({ sessionId: checkoutSessionObject.id, userId }),
      error: JSON.stringify({
        payment_status: checkoutSessionObject.payment_status,
      }),
      type: "STRIPE_CHECKOUT_NOT_PAID",
    });
    return;
  }

  const transactionId = checkoutSessionObject.payment_intent;
  const amount = checkoutSessionObject.amount_total / 100;
  const purchased = credits ? Number(credits) : 0;

  // Once per checkout session: a redelivered webhook changes nothing.
  const { applied } = await addPaidCredits(
    userId,
    purchased,
    checkoutSessionObject.id,
  );
  if (!applied) {
    return;
  }
  await addPurchase({
    user_id: userId,
    transaction_id: transactionId as string,
    credits: purchased,
    amount,
    currency: checkoutSessionObject.currency,
  });

  // A purchase unlocks the customer's watermarked starter images. The credits are already theirs,
  // so a failure here is logged, not thrown; the next purchase retries it.
  try {
    await unlockFreeImages(userId);
  } catch (error) {
    addErrorLog({
      input: JSON.stringify({ userId, sessionId: checkoutSessionObject.id }),
      error: JSON.stringify({ message: (error as Error).message }),
      type: "UNLOCK_FREE_IMAGES",
    });
  }
};

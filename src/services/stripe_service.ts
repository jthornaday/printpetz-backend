import Stripe from "stripe";

import AppConstants from "@/constants/app_constants";
import { IPrice } from "@/types/price";
import { IUser } from "@/types/user";
import errorResponse from "@/utils/errors/errorResponse";
import {
  getStripeEventFromRawBody,
  priceObjectFromStripeEvent,
} from "@/utils/stripe_utils";

import {
  createPrice,
  deletePrice,
  getPriceByPriceId,
  updatePrice,
} from "./price_service";
import { addPurchase } from "./purchase_service";
import { getUser, getUserByStripeCustomerId, updateUser } from "./user_service";

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
export const handlePriceChange = async (
  rawPayload: string | Buffer,
  sig: string | Buffer | string[],
) => {
  const event = getStripeEventFromRawBody(rawPayload, sig, "PRICE_CHANGE");

  // Handle the event
  switch (event.type) {
    case "price.created":
      {
        const dataToCreate = priceObjectFromStripeEvent(event);
        await createPrice(dataToCreate);
      }
      break;
    case "price.updated":
      {
        const dataToUpdate = priceObjectFromStripeEvent(event);
        await updatePrice(dataToUpdate);
      }
      break;
    case "price.deleted":
      {
        const stripePrice = event.data.object;
        await deletePrice(stripePrice.id);
      }
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }
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

  const transactionId = checkoutSessionObject.payment_intent;
  const amount = checkoutSessionObject.amount_total / 100;

  await Promise.all([
    addPurchase({
      user_id: userId,
      transaction_id: transactionId as string,
      credits: credits ? Number(credits) : 0,
      amount,
      currency: checkoutSessionObject.currency,
    }),
    updateUser({
      id: userId,
      credits: user.credits + (credits ? Number(credits) : 0),
    }),
  ]);
};

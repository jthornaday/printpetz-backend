import AppConstants from "@/constants/app_constants";
import AsyncHandler from "@/context/async_handler";
import { getPriceByPriceId } from "@/services/price_service";
import {
  createCheckoutSession,
  createStripeCustomer,
} from "@/services/stripe_service";
import errorResponse from "@/utils/errors/errorResponse";
import { checkoutSessionSchema } from "@/utils/validation/stripe_validation_schema";

const handleCheckoutSession = AsyncHandler.handle(async (req, res) => {
  const user = req.user;

  const { priceId, redirectUrl } = checkoutSessionSchema.parse(req.body);

  const price = await getPriceByPriceId(priceId);
  // Only active packs from the same Stripe mode as our key: a test-mode price can't be bought with
  // the live key (and vice versa), and an archived pack mustn't be sold.
  const liveKey = AppConstants.stripeKey?.startsWith("sk_live_") ?? false;
  if (!price || !price.is_active || price.is_test_mode === liveKey) {
    throw errorResponse.Api404Error({
      errorDescription:
        "This credit pack isn't available. Please refresh and choose another.",
    });
  }

  // create and update stripe customer if user has not stripeId
  if (!user.stripe_customer_id) {
    const customerId = await createStripeCustomer(user);
    user.stripe_customer_id = customerId;
  }

  const sessionFor = (stripeCustomerId: string) =>
    createCheckoutSession({
      price,
      redirectUrl,
      stripeCustomerId,
      metadata: {
        userId: user.id,
        credits: price.credits.toString(),
        priceId: price.price_id,
      },
    });

  let session;
  try {
    session = await sessionFor(user.stripe_customer_id);
  } catch (error) {
    // A customer saved while Stripe was in test mode doesn't exist in live mode (and vice versa).
    // Make a fresh one in the current mode and try once more.
    const e = error as { code?: string; param?: string };
    if (e.code !== "resource_missing" || e.param !== "customer") {
      throw error;
    }
    user.stripe_customer_id = await createStripeCustomer(user);
    session = await sessionFor(user.stripe_customer_id);
  }

  res.dataUpdateSuccess({ data: { session } });
});

export { handleCheckoutSession };

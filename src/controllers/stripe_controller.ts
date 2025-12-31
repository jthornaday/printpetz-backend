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
  if (!price) {
    throw errorResponse.Api404Error({
      errorDescription: "Price not found",
    });
  }

  // create and update stripe customer if user has not stripeId
  if (!user.stripe_customer_id) {
    const customerId = await createStripeCustomer(user);
    user.stripe_customer_id = customerId;
  }

  const session = await createCheckoutSession({
    price,
    redirectUrl,
    stripeCustomerId: user.stripe_customer_id,
    metadata: {
      userId: user.id,
      credits: price.credits.toString(),
      priceId: price.price_id,
    },
  });

  res.dataUpdateSuccess({ data: { session } });
});

export { handleCheckoutSession };

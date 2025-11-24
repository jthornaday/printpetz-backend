// import Stripe from "stripe";

// import AppConstants from "@/constants/app_constants";
// import AsyncHandler from "@/context/async_handler";
// import {
//   createCheckoutSession,
//   createStripeCustomer,
//   getPlan,
// } from "@/services/stripe_service";
// import { dataReturnOnlyIfUserExist } from "@/services/user_service";
// import { checkoutSessionSchema } from "@/validation/stripe_schema";

// const stripe = new Stripe(AppConstants.stripeKey);

// const createCheckout = AsyncHandler.handle(async (req, res) => {
//   const userId = req.userId;
//   const validatedData = await checkoutSessionSchema.validateAsync(req.body);

//   const [user, { metadata }] = await Promise.all([
//     dataReturnOnlyIfUserExist({
//       userId,
//     }),
//     stripe.prices.retrieve(validatedData.priceId),
//   ]);

//   // create and update stripe customer if user has not stripeId
//   if (!user.stripeCustomerId) {
//     const name = `${user.basicInfo.firstName} ${user.basicInfo.lastName}`;
//     const customerId = await createStripeCustomer(
//       {
//         name,
//         email: user.email,
//         metadata: { user_id: userId },
//       },
//       userId,
//     );

//     user.stripeCustomerId = customerId;
//   }

//   const sessionConfig = await createCheckoutSession({
//     ...validatedData,
//     stripeCustomerId: user.stripeCustomerId,
//     metadata: { ...metadata, userId },
//   });

//   res.dataUpdateSuccess({ data: sessionConfig });
// });

// export { createCheckout };

// import Stripe from "stripe";

// import errorResponse from "@/utils/errors/errorResponse";

// import AppConstants from "../constants/app_constants";
// import userModel from "../models/user_model";

// type CheckoutSessionProps = {
//   priceId: string;
//   redirectUrl: string;
//   metadata: Stripe.Metadata;
//   stripeCustomerId: string;
// };

// type PlanProps = {
//   priceId: string;
//   credit: number;
// };

// const stripe = new Stripe(AppConstants.stripeKey);

// export const createStripeCustomer = async (
//   data: { name: string; email: string; metadata: { user_id: string } },
//   userId: string,
// ) => {
//   const customer = await stripe.customers.create(data);

//   await userModel.updateOne(
//     { _id: userId },
//     {
//       $set: {
//         stripeCustomerId: customer.id,
//       },
//     },
//   );

//   return customer.id;
// };

// export const createCheckoutSession = async (input: CheckoutSessionProps) => {
//   try {
//     const { priceId, redirectUrl, metadata, stripeCustomerId } = input;

//     const successUrl = `${redirectUrl}?credit=${metadata.credit}&session_id={CHECKOUT_SESSION_ID}&success=true`;
//     const failedUrl = `${redirectUrl}?credit=${metadata.credit}&success=false`;

//     const session = await stripe.checkout.sessions.create({
//       line_items: [
//         {
//           price: priceId,
//           quantity: 1,
//         },
//       ],
//       metadata,
//       customer: stripeCustomerId,
//       mode: "payment",
//       success_url: successUrl,
//       cancel_url: failedUrl,
//       allow_promotion_codes: true,
//     });

//     return { sessionUrl: session.url, sessionId: session.id };
//   } catch (error) {
//     throw errorResponse.Api404Error({
//       errorDescription: error.raw.message,
//     });
//   }
// };

// export const getPlan = async ({ priceId, credit }: PlanProps) => {
//   const priceObj = await stripe.prices.retrieve(priceId);
//   if (!priceObj) {
//     throw errorResponse.Api500Error({
//       errorDescription: "priceId " + priceId + " is not available",
//     });
//   }

//   return {
//     priceId,
//     credit,
//     price: priceObj.unit_amount / 100,
//     currency: priceObj.currency,
//   };
// };

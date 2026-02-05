import AsyncHandler from "@/context/async_handler";
import { handleImageGenerationResponse } from "@/services/generation_service";
import { handleModelTrainingResponse } from "@/services/model_service";
import { handleCheckout, handlePriceChange } from "@/services/stripe_service";

const stripeEventForCheckout = AsyncHandler.handle(async (req, res) => {
  const rawPayload = req.rawbody;
  const sig = req.headers["stripe-signature"];

  await handleCheckout(rawPayload, sig);

  res.dataUpdateSuccess();
});

const stripeEventForPriceChange = AsyncHandler.handle(async (req, res) => {
  const rawPayload = req.rawbody;
  const sig = req.headers["stripe-signature"];

  await handlePriceChange(rawPayload, sig);

  res.dataUpdateSuccess();
});

const falTrainingResult = AsyncHandler.handle(async (req, res) => {
  const reqBody = req.body;

  await handleModelTrainingResponse(reqBody);

  res.dataUpdateSuccess();
});

const falImageGenerationResult = AsyncHandler.handle(async (req, res) => {
  const reqBody = req.body;

  await handleImageGenerationResponse(reqBody);

  res.dataUpdateSuccess();
});

export {
  falImageGenerationResult,
  falTrainingResult,
  stripeEventForCheckout,
  stripeEventForPriceChange,
};

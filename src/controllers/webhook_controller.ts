import Stripe from "stripe";
import { OutputFileType } from "typescript";

import AppConstants from "@/constants/app_constants";
import AsyncHandler from "@/context/async_handler";
import { streamUploadToS3, uploadFileToS3 } from "@/services/aws_service";
import { addErrorLog } from "@/services/error_logs_service";
import { getFileBufferFromUrl } from "@/services/file_service";
import {
  getGenerationByRequestId,
  updateGeneration,
} from "@/services/generation_service";
import { getModelByRequestId, updateModel } from "@/services/model_service";
import { nonRenewingPurchaseHandler } from "@/services/purchase_service";
import { EUploadPath } from "@/types/aws";
import { EGenerationStatus } from "@/types/generation";
import { EModelStatus } from "@/types/model";
import errorResponse from "@/utils/errors/errorResponse";

// const stripe = new Stripe(AppConstants.stripeKey);

// const stripeEventForCheckout = AsyncHandler.handle(async (req, res) => {
//   const rawPayload = req.rawbody;
//   const sig = req.headers["stripe-signature"];
//   const stripeWebhookSecret = AppConstants.stripeWebhookSecret;

//   const event = stripe.webhooks.constructEvent(
//     rawPayload,
//     sig,
//     stripeWebhookSecret,
//   );

//   // Handle the event
//   switch (event.type) {
//     case "checkout.session.completed":
//       {
//         const eventObject = event.data.object;

//         const { userId, credit } = eventObject.metadata;
//         const transferId = eventObject.payment_intent;

//         const amount = eventObject.amount_total / 100;

//         await nonRenewingPurchaseHandler({
//           user_id: userId,
//           transfer_id: transferId as string,
//           credit: Number(credit),
//           price_details: {
//             price: amount,
//             currency: eventObject.currency,
//           },
//         });
//       }
//       break;
//     case "invoice.payment_failed":
//       break;
//     default:
//       console.log(`Unhandled event type ${event.type}`);
//   }

//   res.status(200).json({ success: true });
// });

const falTrainingResult = AsyncHandler.handle(async (req, res) => {
  const reqBody = req.body;

  const model = await getModelByRequestId(reqBody.request_id);
  if (!model) {
    throw errorResponse.Api404Error({
      errorDescription: `Model not found with this request-id`,
    });
  }

  if (reqBody.status === "ERROR") {
    await updateModel({
      id: model.id,
      status: EModelStatus.ERROR,
      error: reqBody.payload?.details?.[0],
    });
  }

  if (reqBody.status === "OK") {
    const modelUrl = reqBody.payload?.lora_file?.url;
    // const fileName = modelUrl?.split("/").at(-1);
    // const fileType = "binary/octet-stream";

    // const uploadData = {
    //   url: modelUrl,
    //   fileType: fileType,
    //   Key: `${EUploadPath.MODEL.replace("[USER_ID]", model.user_id)}/${fileName}`,
    // };
    // const url = await streamUploadToS3(uploadData);

    // console.log({ url });

    await updateModel({
      id: model.id,
      status: EModelStatus.COMPLETED,
      model_path: modelUrl,
    });
  }

  res.dataUpdateSuccess();
});

const falImageGenerationResult = AsyncHandler.handle(async (req, res) => {
  const reqBody = req.body;

  console.log(reqBody.payload, reqBody);

  const generation = await getGenerationByRequestId(reqBody.request_id);
  if (!generation) {
    throw errorResponse.Api404Error({
      errorDescription: `Generation not found with this request-id`,
    });
  }

  if (reqBody.status === "ERROR") {
    const error = {
      error: reqBody.error ?? reqBody.payload_error,
      details: reqBody.payload?.details,
    };

    await updateGeneration({
      id: generation.id,
      status: EGenerationStatus.ERROR,
      error,
    });
  }

  if (reqBody.status === "OK") {
    const image = reqBody.payload?.images?.[0];
    if (!image) {
      throw errorResponse.Api400Error({
        errorDescription: "image data required",
      });
    }

    const imageUrl = image.url;
    const fileName = imageUrl?.split("/").at(-1);
    const fileType = image.content_type;

    const imageBuffer = await getFileBufferFromUrl(imageUrl, fileType);

    const uploadData = {
      buffer: imageBuffer,
      fileType,
      Key: `${EUploadPath.GENERATION_IMAGE.replace("[USER_ID]", generation.user_id)}/${fileName}`,
    };
    const url = await uploadFileToS3(uploadData);

    console.log({ url });

    await updateGeneration({
      id: generation.id,
      status: EGenerationStatus.COMPLETED,
      image: url,
    });
  }

  res.dataUpdateSuccess();
});

export { falImageGenerationResult, falTrainingResult };

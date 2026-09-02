import axios from "axios";

import AppConstants from "@/constants/app_constants";

import { addErrorLog } from "./error_logs_service";

interface ISendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  idempotencyKey?: string;
  tags?: { name: string; value: string }[];
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export const sendEmail = async ({
  to,
  subject,
  html,
  text,
  idempotencyKey,
  tags,
}: ISendEmailInput) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? process.env.RESEND_FROM_EMAIL;

  console.log("EMAIL_SEND_ATTEMPT", {
    to,
    subject,
    hasApiKey: Boolean(apiKey),
    hasFrom: Boolean(from),
    from,
  });

  if (!apiKey || !from) {
    console.error("EMAIL_CONFIG_MISSING", {
      hasApiKey: Boolean(apiKey),
      hasFrom: Boolean(from),
    });

    await addErrorLog({
      error:
        "Email service is not configured. RESEND_API_KEY and EMAIL_FROM or RESEND_FROM_EMAIL are required.",
      input: JSON.stringify({ to, subject }),
      type: "EMAIL_CONFIG_MISSING",
    });
    return false;
  }

  try {
    const response = await axios.post(
      "https://api.resend.com/emails",
      {
        from,
        to: [to],
        subject,
        html,
        ...(text ? { text } : {}),
        ...(tags ? { tags } : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
      },
    );

    console.log("EMAIL_SEND_SUCCESS", {
      to,
      subject,
      status: response.status,
      id: response.data?.id,
    });

    return true;
  } catch (error) {
    const responseError = axios.isAxiosError(error)
      ? JSON.stringify(error.response?.data ?? error.message)
      : String(error);

    console.error("SEND_EMAIL_FAILED", {
      to,
      subject,
      status: axios.isAxiosError(error) ? error.response?.status : undefined,
      error: responseError,
    });

    await addErrorLog({
      error: responseError,
      input: JSON.stringify({ to, subject }),
      type: "SEND_EMAIL_FAILED",
    });

    return false;
  }
};

interface ISendModelReadyEmailInput {
  to: string;
  modelId: number;
  petName: string;
  recipientName?: string | null;
}

export const sendModelReadyEmail = async ({
  to,
  modelId,
  petName,
  recipientName,
}: ISendModelReadyEmailInput) => {
  const safeName = escapeHtml(petName);
  const greeting = recipientName?.trim() || "there";
  const safeGreeting = escapeHtml(greeting);
  const createUrl = `${AppConstants.clientBaseUrl.replace(/\/$/, "")}/create`;

  return sendEmail({
    to,
    subject: `${petName} is ready to create!`,
    html: `
      <div style="background:#f6f4ff;padding:40px 16px;font-family:Arial,sans-serif;color:#17151f">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:20px;padding:36px">
          <div style="font-size:26px;font-weight:800;color:#6d5dfc;margin-bottom:24px">PrintPetz</div>
          <p style="font-size:17px;line-height:1.6;color:#5d5868;margin:0 0 12px">Hi ${safeGreeting},</p>
          <h1 style="font-size:30px;line-height:1.2;margin:0 0 16px">${safeName} is ready!</h1>
          <p style="font-size:17px;line-height:1.6;color:#5d5868;margin:0 0 28px">
            Your pet's AI model finished training. Choose a style and create an image that's ready for personalized products.
          </p>
          <a href="${createUrl}" style="display:inline-block;background:#6d5dfc;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:10px">
            Create your image
          </a>
          <p style="font-size:13px;line-height:1.5;color:#8a8495;margin:30px 0 0">
            You received this email because you trained a pet model on PrintPetz.
          </p>
        </div>
      </div>
    `,
    text: `Hi ${greeting}, ${petName} is ready! Your pet's AI model finished training. Create your image at ${createUrl}`,
    idempotencyKey: `model-ready-${modelId}`,
    tags: [{ name: "model_id", value: String(modelId) }],
  });
};

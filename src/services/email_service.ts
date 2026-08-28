import axios from "axios";

import { addErrorLog } from "./error_logs_service";

interface ISendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export const sendEmail = async ({ to, subject, html }: ISendEmailInput) => {
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
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
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

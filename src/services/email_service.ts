import axios from "axios";

import { addErrorLog } from "./error_logs_service";

interface ISendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export const sendEmail = async ({ to, subject, html }: ISendEmailInput) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    await addErrorLog({
      error: "Email service is not configured. RESEND_API_KEY and EMAIL_FROM are required.",
      input: JSON.stringify({ to, subject }),
      type: "EMAIL_CONFIG_MISSING",
    });
    return false;
  }

  try {
    await axios.post(
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

    return true;
  } catch (error) {
    const responseError = axios.isAxiosError(error)
      ? JSON.stringify(error.response?.data ?? error.message)
      : String(error);

    await addErrorLog({
      error: responseError,
      input: JSON.stringify({ to, subject }),
      type: "SEND_EMAIL_FAILED",
    });

    return false;
  }
};

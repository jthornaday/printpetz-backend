import AppConstants from "@/constants/app_constants";

const CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 15_000;

export type TrademarkCheckResult = { blocked: boolean; reason?: string };

// Every failure path returns this. Custom generations end up on physical
// merchandise, so an unanswered check is a "no", never a "probably fine".
const UNAVAILABLE: TrademarkCheckResult = {
  blocked: true,
  reason: "moderation check unavailable",
};

const SYSTEM_PROMPT =
  "You screen requests for a pet-portrait print shop. Flag any request whose text or image names or depicts a copyrighted character, a franchise, a brand, a logo, or a licensed product (for example Marvel or Disney characters, sports teams, Nike, a branded toy, a logo on clothing). Original descriptions and generic costumes or professions are fine. When flagged, `reason` is one plain-English sentence naming what was caught. When not flagged, `reason` is an empty string.";

const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "trademark_check",
    strict: true,
    schema: {
      type: "object",
      properties: {
        flagged: { type: "boolean" },
        reason: { type: "string" },
      },
      required: ["flagged", "reason"],
      additionalProperties: false,
    },
  },
};

const runCheck = async (
  description: string,
  referencePhotoUrl?: string,
): Promise<TrademarkCheckResult> => {
  const apiKey = AppConstants.openaiApiKey;
  if (!apiKey) {
    return UNAVAILABLE;
  }

  const userContent: Array<Record<string, unknown>> = [
    { type: "text", text: `Description: ${description}` },
  ];
  if (referencePhotoUrl) {
    userContent.push({
      type: "image_url",
      image_url: { url: referencePhotoUrl },
    });
  }

  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.PRINTPETZ_TRADEMARK_MODEL?.trim() || DEFAULT_MODEL,
      temperature: 0,
      response_format: RESPONSE_FORMAT,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    return UNAVAILABLE;
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    return UNAVAILABLE;
  }

  const parsed = JSON.parse(content) as { flagged?: unknown; reason?: unknown };
  if (typeof parsed.flagged !== "boolean") {
    return UNAVAILABLE;
  }

  return parsed.flagged
    ? {
        blocked: true,
        reason:
          typeof parsed.reason === "string" && parsed.reason.trim()
            ? parsed.reason.trim()
            : "This looks like licensed or trademarked content.",
      }
    : { blocked: false };
};

/** Fails closed by construction: any error, timeout or malformed answer is a block. */
export const checkTrademarkViolation = async (
  description: string,
  referencePhotoUrl?: string,
): Promise<TrademarkCheckResult> => {
  try {
    return await runCheck(description, referencePhotoUrl);
  } catch {
    return UNAVAILABLE;
  }
};

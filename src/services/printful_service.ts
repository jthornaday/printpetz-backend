/**
 * Printful fulfilment — turns a paid order into a Printful order carrying THAT
 * customer's pet.
 *
 * Proven 2026-09-22 against store 18796047: POST /orders with an explicit
 * items[].files[] array works on a Shopify-platform store. The per-order file is
 * used; the synced product's design does not override it. Printful fetched our file
 * and reported status ok at dpi 300. See specs/merch-parent.md.
 *
 * SAFETY: orders are created as DRAFTS unless PRINTFUL_AUTO_CONFIRM=true. A draft
 * never prints, never ships and never charges. Do not flip that default casually.
 */
import AppConstants from "@/constants/app_constants";
import { Treatment } from "@/constants/print_products";
import { variantForProduct } from "@/constants/printful_variants";

import { addErrorLog } from "./error_logs_service";
import { uploadFileToS3 } from "./aws_service";
import { buildPrintFile } from "./print_file_service";

const API = "https://api.printful.com";

// Could move to EUploadPath in types/aws.ts, but that file is outside this
// milestone's free-edit list, so the path lives here for now.
const PRINT_FILE_PREFIX = "print-files";

const autoConfirm = () => process.env.PRINTFUL_AUTO_CONFIRM === "true";

export type PrintfulRecipient = {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state_code?: string;
  country_code: string;
  zip: string;
  email?: string;
  phone?: string;
};

export type FulfillmentItem = {
  /** Where the finished generation lives. Fetched, not trusted as a print file. */
  sourceImageUrl: string;
  productKey: string;
  treatment: Treatment;
  quantity: number;
  /** For tracing a complaint back to an image. Logged on every order. */
  generationId?: string | number;
};

export type FulfillmentRequest = {
  /** The upstream order id (Shopify). Printful's external_id — our idempotency key. */
  externalId: string;
  recipient: PrintfulRecipient;
  items: FulfillmentItem[];
};

/** Printful's envelope. Typed loosely on purpose — their shape varies by endpoint. */
type PrintfulResponse = {
  code?: number;
  result?: any;
  error?: { message?: string };
};

/**
 * Describe the credential WITHOUT revealing it, so a config problem in a deployed
 * environment is diagnosable from the error alone. Printful returns the identical
 * "access token provided is invalid" message whether the token is wrong, empty or
 * undefined, which is useless when you cannot read the environment directly.
 */
const credentialShape = () => {
  const raw = process.env.PRINTFUL_API_KEY;
  if (raw === undefined) return "PRINTFUL_API_KEY is UNDEFINED in this environment";
  const trimmed = raw.trim();
  return [
    `len=${raw.length}`,
    `trimmed_len=${trimmed.length}`,
    `has_whitespace=${raw !== trimmed}`,
    `has_quotes=${/^["']|["']$/.test(trimmed)}`,
    `first4=${trimmed.slice(0, 4)}`,
    `last4=${trimmed.slice(-4)}`,
  ].join(" ");
};

const printfulFetch = async (
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: PrintfulResponse }> => {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as PrintfulResponse;
  return { status: res.status, json };
};

/**
 * Idempotency without a new table: Printful can look an order up by the external id
 * we set. A webhook retry finds the existing order instead of printing twice.
 */
export const findOrderByExternalId = async (externalId: string) => {
  const { status, json } = await printfulFetch(`/orders/@${encodeURIComponent(externalId)}`);
  if (status === 200 && json?.result?.id) return json.result;
  return null;
};

/** Build the print file for one line item and put it somewhere Printful can fetch it. */
const preparePrintFile = async (item: FulfillmentItem, externalId: string, index: number) => {
  const res = await fetch(item.sourceImageUrl);
  if (!res.ok) {
    throw new Error(`source image fetch failed ${res.status} for ${item.sourceImageUrl}`);
  }
  const source = Buffer.from(await res.arrayBuffer());

  const built = await buildPrintFile(source, item.productKey, item.treatment);

  const key = `${PRINT_FILE_PREFIX}/${externalId}/${index}-${item.productKey}-${item.treatment}.${built.format === "png" ? "png" : "jpg"}`;
  const url = await uploadFileToS3({
    Key: key,
    buffer: built.buffer,
    fileType: built.format === "png" ? "image/png" : "image/jpeg",
  });
  if (!url) throw new Error(`S3 upload returned null for ${key}`);

  return { url, built };
};

/**
 * Create a Printful order for an upstream paid order.
 *
 * Every file is built and uploaded BEFORE the order is created. A failure halfway
 * through leaves nothing in Printful — half an order is worse than none.
 */
export const createFulfillmentOrder = async (req: FulfillmentRequest) => {
  const existing = await findOrderByExternalId(req.externalId);
  if (existing) {
    return {
      created: false as const,
      reason: "already exists for this external id",
      orderId: existing.id,
      status: existing.status,
    };
  }

  if (!req.items.length) throw new Error("fulfillment request has no items");

  const prepared: Array<{ item: FulfillmentItem; url: string; built: Awaited<ReturnType<typeof buildPrintFile>> }> = [];
  for (const [i, item] of req.items.entries()) {
    const { url, built } = await preparePrintFile(item, req.externalId, i);
    prepared.push({ item, url, built });
  }

  const body = {
    external_id: req.externalId,
    recipient: req.recipient,
    items: prepared.map(({ item, url }) => ({
      variant_id: variantForProduct(item.productKey).variantId,
      quantity: item.quantity,
      files: [{ url }],
    })),
  };

  const query = autoConfirm() ? "?confirm=1" : "";
  const { status, json } = await printfulFetch(`/orders${query}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (status !== 200 || !json?.result?.id) {
    const message = json?.error?.message ?? json?.result ?? `HTTP ${status}`;
    // A 401 here is almost always configuration, not code. Say what the credential
    // looks like so nobody spends an hour trading theories about it.
    const detail =
      status === 401 || /access token/i.test(String(message))
        ? ` [credential: ${credentialShape()}]`
        : "";
    addErrorLog({
      input: JSON.stringify({ externalId: req.externalId, body }),
      error: JSON.stringify(json),
      type: "PRINTFUL_ORDER_CREATE",
    });
    throw new Error(`Printful order create failed: ${message}${detail}`);
  }

  // Traceability: a complaint about the wrong pet must be answerable with one grep.
  for (const { item, url } of prepared) {
    console.log(
      "[printful-order]",
      JSON.stringify({
        externalId: req.externalId,
        printfulOrderId: json.result.id,
        generationId: item.generationId ?? null,
        productKey: item.productKey,
        treatment: item.treatment,
        fileUrl: url,
      }),
    );
  }

  return {
    created: true as const,
    orderId: json.result.id as number,
    status: json.result.status as string,
    confirmed: autoConfirm(),
    costs: json.result.costs,
    items: json.result.items,
  };
};

/** Poll until Printful has fetched and validated the print files, or give up. */
export const waitForFileValidation = async (orderId: number, attempts = 6, delayMs = 5000) => {
  for (let i = 0; i < attempts; i++) {
    const { json } = await printfulFetch(`/orders/${orderId}`);
    const files = (json?.result?.items ?? []).flatMap((it: any) => it.files ?? []);
    if (files.length && files.every((f: any) => f.status === "ok")) return files;
    if (files.some((f: any) => f.status === "failed")) return files;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
};

export const cancelOrder = async (orderId: number) => {
  const { status, json } = await printfulFetch(`/orders/${orderId}`, { method: "DELETE" });
  return { ok: status === 200, status: json?.result?.status ?? null };
};

export const printfulConfigured = () => Boolean(AppConstants.awsBucketName && process.env.PRINTFUL_API_KEY);

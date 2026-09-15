export type ImageProviderName = "fal" | "openai";

export type GenerateImageRequest = {
  /** The fully assembled prompt, identical in both lanes apart from the
   * trigger word and the identity wording. */
  prompt: string;
  /** The trained LoRA. Meaningless to a reference-image provider. */
  modelPath: string;
  /** The pet's training photos as public URLs. Meaningless to FAL, which
   * carries identity in the LoRA instead. */
  referenceImageUrls: string[];
  petName: string;
  seed: number;
  styleName?: string;
};

export type ProviderMeta = {
  latencyMs: number;
  /** OpenAI's response id, for chasing a specific call in their dashboard. */
  responseId?: string;
  /** Estimated from the usage block and the published token rates. Absent when
   * the provider does not report usage (FAL bills per request, not per token). */
  costUsd?: number;
  usage?: Record<string, unknown>;
};

/**
 * FAL is queued and OpenAI is synchronous, and no single return shape is honest
 * about both. FAL hands back a request id and a webhook finishes the row
 * minutes later; OpenAI hands back the finished image bytes. Collapsing those
 * into one "imageUrl" would mean either blocking a request thread for a minute
 * on the FAL path or inventing a fake request id on the OpenAI path.
 *
 * So the caller branches once, on `kind`, and everything downstream -- credits,
 * the generations table, the frontend's polling -- stays as it is.
 */
export type GenerateImageResult =
  | {
      kind: "queued";
      provider: ImageProviderName;
      providerModel: string;
      requestId: string;
    }
  | {
      kind: "complete";
      provider: ImageProviderName;
      providerModel: string;
      image: { buffer: Buffer; contentType: string; extension: string };
      providerMeta: ProviderMeta;
    };

/** Thrown when a provider refuses or fails in a way the caller must not bill
 * for. Moderation refusals are the main case: the customer gets no image, so
 * the customer pays no credit -- the same rule as any other AI failure. */
export class ImageGenerationFailure extends Error {
  readonly provider: ImageProviderName;
  readonly reason: "moderation" | "rate_limit" | "provider_error";
  readonly detail?: string;

  constructor(
    provider: ImageProviderName,
    reason: "moderation" | "rate_limit" | "provider_error",
    message: string,
    detail?: string,
  ) {
    super(message);
    this.name = "ImageGenerationFailure";
    this.provider = provider;
    this.reason = reason;
    this.detail = detail;
  }
}

export interface ImageProvider {
  readonly name: ImageProviderName;
  generate(request: GenerateImageRequest): Promise<GenerateImageResult>;
}

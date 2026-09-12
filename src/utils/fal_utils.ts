import axios from "axios";
import JSZip from "jszip";

import { addErrorLog } from "@/services/error_logs_service";
import errorResponse from "@/utils/errors/errorResponse";
import { getRoleBlueprintPrompt } from "@/utils/role_blueprints";

const MINIMUM_TRAINING_IMAGES = 3;

interface CreateDatasetZipOptions {
  imageUrls: string[];
}

export const createTrainingZip = async ({
  imageUrls,
}: CreateDatasetZipOptions): Promise<Blob> => {
  try {
    const zip = new JSZip();
    let successfulImageCount = 0;

    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];

      try {
        const imageResponse = await axios.get(url, {
          responseType: "arraybuffer",
        });
        const contentType = imageResponse.headers["content-type"];

        if (contentType && !contentType.startsWith("image/")) {
          throw new Error(`Unsupported training file type: ${contentType}`);
        }

        if (!imageResponse.data?.byteLength) {
          throw new Error("Training image is empty");
        }

        const filename = `image_${successfulImageCount + 1}.jpg`;
        zip.file(filename, imageResponse.data);
        successfulImageCount += 1;
      } catch (error) {
        addErrorLog({
          input: JSON.stringify({ url }),
          error: JSON.stringify({ error }),
          type: "FETCH_FILE",
        });
      }
    }

    if (successfulImageCount < MINIMUM_TRAINING_IMAGES) {
      throw errorResponse.Api400Error({
        errorDescription:
          "At least 3 readable pet photos are required. Please replace any photos that failed to upload.",
      });
    }

    const content = await zip.generateAsync({ type: "blob" });
    return content;
  } catch (error) {
    addErrorLog({
      input: JSON.stringify({ imageUrls }),
      error: JSON.stringify({ error }),
      type: "CREATE_TRAINING_ZIP",
    });

    throw error;
  }
};

// FLUX's T5 text encoder accepts 512 tokens and silently truncates anything
// past that — no error, the extra text simply never reaches the model. The
// assembled prompt is budgeted well under that so every instruction is read.
const PROMPT_TOKEN_BUDGET = 480;

// A real T5 count needs a SentencePiece tokenizer, which would mean a native
// dependency in the API process for what is only a guard rail. This is an
// estimate: the two standard heuristics (~4 chars/token and ~1.3 tokens/word)
// disagree by 10-20% on prose, so take the higher one and warn early.
export const estimateTokenCount = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  const wordCount = trimmed.split(/\s+/).length;
  return Math.ceil(Math.max(trimmed.length / 4, wordCount * 1.3));
};

export const warnIfPromptOverBudget = (
  prompt: string,
  context: { styleName?: string; lookLevel?: number },
) => {
  const estimatedTokens = estimateTokenCount(prompt);
  if (estimatedTokens <= PROMPT_TOKEN_BUDGET) {
    return estimatedTokens;
  }

  const details = {
    estimatedTokens,
    budget: PROMPT_TOKEN_BUDGET,
    words: prompt.trim().split(/\s+/).length,
    characters: prompt.length,
    styleName: context.styleName ?? "unknown",
    lookLevel: context.lookLevel ?? "unknown",
  };

  // eslint-disable-next-line no-console
  console.warn(
    `[prompt-budget] Assembled prompt is ~${estimatedTokens} tokens, over the ${PROMPT_TOKEN_BUDGET} budget. FLUX truncates at 512, so the tail of this prompt will not reach the model. style=${details.styleName} look=${details.lookLevel} words=${details.words}`,
  );

  addErrorLog({
    input: JSON.stringify(details),
    error: JSON.stringify({ message: "Assembled prompt over token budget", prompt }),
    type: "PROMPT_OVER_TOKEN_BUDGET",
  });

  return estimatedTokens;
};

const getLookPrompt = (lookLevel: number) => {
  if (lookLevel === 1) {
    return "STYLE: photoreal, real fur texture, natural head and eye size. No cartoon or mascot styling.";
  }

  if (lookLevel === 3) {
    return "STYLE: animated cartoon, simplified fur and expressive eyes, keeping the real markings, muzzle length and coat colors.";
  }

  return "STYLE: clean mascot illustration, balanced proportions and normal eye size, keeping the real face structure.";
};

const getPetDisplayName = (modelName?: string) => {
  const cleanName = modelName?.trim();
  if (!cleanName) return "";

  const withoutVersion = cleanName
    .replace(/\s+\(\d+\)$/i, "")
    .replace(/\s+v\s*\d+$/i, "")
    .replace(/\s+\d+$/i, "")
    .trim();

  return withoutVersion || cleanName;
};

// Where the name sits for each role. One short phrase each: the model needs the
// location, not an essay about it.
const NAME_PLACEMENTS: Array<{ aliases: string[]; garment: string; placement: string }> = [
  {
    aliases: ["baseball", "football", "basketball", "soccer", "hockey", "cricket"],
    garment: "jersey",
    placement: "across the upper back or on a chest nameplate",
  },
  {
    aliases: ["boxing", "boxer"],
    garment: "trunks waistband",
    placement: "in clean block letters",
  },
  {
    aliases: ["chef"],
    garment: "chef coat",
    placement: "embroidered on the chest",
  },
  {
    aliases: ["doctor", "physician", "police", "firefighter", "pilot", "astronaut"],
    garment: "plain name patch",
    placement: "with no agency, department or airline insignia",
  },
];

const getPetNamePrompt = (petName?: string, styleName?: string) => {
  const cleanName = getPetDisplayName(petName);
  if (!cleanName) return "";

  const upperName = cleanName.toUpperCase();
  const normalizedStyle = styleName?.trim().toLowerCase() ?? "";
  const match = NAME_PLACEMENTS.find(({ aliases }) =>
    aliases.some((alias) => normalizedStyle.includes(alias)),
  );

  if (!match) {
    return ` NAME: the uniform reads "${upperName}" once, spelled exactly, on a clean name patch.`;
  }

  return ` NAME: the ${match.garment} reads "${upperName}" once, spelled exactly, ${match.placement}.`;
};

const getBrandingPrompt = (hasPetName: boolean) =>
  hasPetName
    ? "BRANDING: the pet name is the only text. No logos, team names, sponsors, numbers or invented lettering."
    : "BRANDING: no text anywhere. No logos, team names, sponsors, numbers or invented lettering.";

// Capped hard: this text sits inside the identity block, which must survive
// well inside the 480-token guard. A description longer than this is almost
// always someone pasting a paragraph, and the extra words dilute rather than
// sharpen the identity.
const PET_DESCRIPTION_MAX_WORDS = 25;

// The LoRA is the only thing telling the model what the pet looks like, and for
// a dark coat that is demonstrably not enough — "keep its exact coat color"
// says nothing about *which* colour. This states it in words.
const getPetDescriptionClause = (petDescription?: string) => {
  const cleaned = petDescription?.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";

  const words = cleaned.split(" ");
  if (words.length <= PET_DESCRIPTION_MAX_WORDS) {
    return cleaned.replace(/[.\s]+$/, "");
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[pet-description] Description is ${words.length} words, over the ${PET_DESCRIPTION_MAX_WORDS}-word cap. Truncating.`,
  );

  return words
    .slice(0, PET_DESCRIPTION_MAX_WORDS)
    .join(" ")
    .replace(/[,;:.\s]+$/, "");
};

const getIdentityPrompt = (petDescription?: string) => {
  const description = getPetDescriptionClause(petDescription);
  const subject = description
    ? `one pet only, the trained pet — ${description}`
    : "one pet only, the trained pet";

  return `IDENTITY: ${subject}. Keep its exact coat color and pattern, markings, breed, build, muzzle length and projection, ears, nose and eye color. Never lighten or recolor the coat.`;
};

const POSE_PROMPT =
  "POSE: upright on hind legs as the participant, shoulders and arms readable in role wardrobe. Forepaws stay animal paws, never human hands. Props gripped or supported, never floating or doubled.";

// Order is deliberate and load-bearing: FLUX truncates from the end, so the
// sections appear in descending order of how much they matter. Theme first
// (it is the whole point of the image), then identity, name, style, pose.
export const generateIdentityPrompt = (
  subject: string,
  lookLevel = 1,
  petName?: string,
  styleName?: string,
  petDescription?: string,
) => {
  const roleBlueprint = getRoleBlueprintPrompt(styleName);
  const namePrompt = getPetNamePrompt(petName, styleName);

  const prompt = [
    subject.trim().replace(/\.?$/, "."),
    getIdentityPrompt(petDescription),
    namePrompt.trim(),
    getLookPrompt(lookLevel),
    POSE_PROMPT,
    roleBlueprint,
    getBrandingPrompt(Boolean(namePrompt)),
  ]
    .filter(Boolean)
    .join(" ");

  warnIfPromptOverBudget(prompt, { styleName, lookLevel });

  return prompt;
};

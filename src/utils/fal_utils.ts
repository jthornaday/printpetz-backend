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
// location, not an essay about it — and a location is all it may be. The
// uniformed roles used to carry "with no agency, department or airline
// insignia", which named three things to avoid plus the word insignia itself.
// FLUX draws nouns whether or not they are negated, so that phrasing invited
// the badge it was meant to prevent. Keeping every placement purely positional
// leaves the MARKINGS line as the single place the plain-fabric rule is stated.
const NAME_PLACEMENTS: Array<{ aliases: string[]; garment: string; placement: string }> = [
// The expansion themes come FIRST, deliberately. Matching is substring-based
// (`styleName.includes(alias)`) and returns the first hit, so a more specific
// alias has to sit above a more general one or it can never win. Three real
// collisions depend on this order:
//   "Viking Chieftain"      contains "king"
//   "Harvest Chef"          contains "chef"
//   "Medieval Queen"        contains "queen"
// Each of those has its own entry here; without this ordering they would
// silently inherit the royal sash or the chef coat instead.
  // --- Fantasy + Intergalactic + construction trades, added 19 Sept 2026 ---
  // Placed here, above the pre-existing entries below, so "elf ranger" wins
  // over the plain "elf" (Christmas Elf) entry and "space pirate" wins over
  // the plain "pirate" entry -- both are real substring collisions.
  { aliases: ["wizard"], garment: "robe cincture", placement: "in clean embroidered letters" },
  { aliases: ["knight in shining armor", "shining armor"], garment: "breastplate", placement: "in clean engraved letters" },
  { aliases: ["elf ranger"], garment: "leather vest", placement: "in clean stitched letters across the chest" },
  { aliases: ["pixie"], garment: "petal dress bodice", placement: "in delicate stitched letters" },
  { aliases: ["dragon rider"], garment: "flight jacket", placement: "in clean stitched letters across the chest" },
  { aliases: ["royal sorceress"], garment: "gown sash", placement: "in clean embroidered letters" },
  { aliases: ["troll"], garment: "burlap vest", placement: "in clean stitched letters across the chest" },
  { aliases: ["gnome"], garment: "tunic", placement: "in clean stitched letters across the chest" },
  { aliases: ["dwarf lord"], garment: "leather vest", placement: "in clean engraved letters" },
  { aliases: ["necromancer"], garment: "robe hem", placement: "in clean stitched letters" },
  { aliases: ["barbarian"], garment: "chest armor", placement: "in clean stitched letters" },
  { aliases: ["thief"], garment: "chest harness", placement: "in clean stitched letters" },
  { aliases: ["bard"], garment: "doublet", placement: "in clean stitched letters across the chest" },
  { aliases: ["witch"], garment: "shawl", placement: "in clean stitched letters" },
  { aliases: ["alchemist"], garment: "apron", placement: "in clean stitched letters across the chest" },
  { aliases: ["space marine"], garment: "combat suit chest plate", placement: "in clean stenciled letters" },
  { aliases: ["starship captain"], garment: "command jacket", placement: "in clean stitched letters across the chest" },
  { aliases: ["galactic bounty hunter", "bounty hunter"], garment: "utility harness", placement: "in clean stenciled letters" },
  { aliases: ["smuggler"], garment: "leather jacket", placement: "in clean stitched letters across the back" },
  { aliases: ["space pirate"], garment: "bandolier", placement: "in clean stenciled letters" },
  { aliases: ["alien diplomat"], garment: "formal robe sash", placement: "in clean embroidered letters" },
  { aliases: ["galactic royalty"], garment: "formal robe", placement: "in clean embroidered letters" },
  { aliases: ["void knight"], garment: "armor plate chest panel", placement: "in clean stenciled letters" },
  { aliases: ["cosmic sorcerer"], garment: "starlit robe", placement: "in clean embroidered letters" },
  { aliases: ["nebula explorer"], garment: "expedition suit", placement: "in clean stenciled letters across the chest" },
  { aliases: ["asteroid miner"], garment: "work suit", placement: "in clean stenciled letters across the back" },
  { aliases: ["cyborg engineer"], garment: "tool harness", placement: "in clean stenciled letters" },
  { aliases: ["android companion"], garment: "plated bodysuit", placement: "in clean stenciled letters across the chest" },
  { aliases: ["star cadet"], garment: "academy uniform", placement: "in clean stitched letters across the chest" },
  { aliases: ["zero-g racer", "zero g racer"], garment: "racing suit chest panel", placement: "in clean stitched letters" },
  { aliases: ["construction"], garment: "hi-vis vest", placement: "in clean block letters across the back" },
  { aliases: ["mason"], garment: "canvas apron", placement: "in clean block letters across the chest" },
  { aliases: ["roofer", "roofing"], garment: "hard hat", placement: "in clean block letters across the front brim" },
  { aliases: ["framer", "framing"], garment: "tool belt", placement: "stamped in clean block letters on the leather" },

  { aliases: ["rowing", "rower"], garment: "rowing singlet", placement: "in clean block letters across the chest" }, // Rowing
  { aliases: ["archery", "archer"], garment: "quiver strap", placement: "in clean block letters across the chest" }, // Archery
  { aliases: ["curling", "curler"], garment: "curling jacket", placement: "in clean block letters across the back" }, // Curling
  { aliases: ["darts"], garment: "darts shirt", placement: "in clean block letters across the back" }, // Darts
  { aliases: ["billiards", "snooker"], garment: "waistcoat", placement: "embroidered on the chest" }, // Billiards
  { aliases: ["bowling"], garment: "bowling shirt", placement: "in clean block letters across the back" }, // Bowling
  { aliases: ["sailboat", "sailing", "sailor"], garment: "sailing jacket", placement: "in clean block letters across the chest" }, // Sailboat Racer
  { aliases: ["race car", "racing driver"], garment: "racing suit chest panel", placement: "in clean block letters" }, // Race Car Driver
  { aliases: ["motocross"], garment: "motocross jersey", placement: "in clean block letters across the back" }, // Motocross Racer
  { aliases: ["softball"], garment: "jersey", placement: "across the upper back or on a chest nameplate" }, // Softball
  { aliases: ["swimmer", "swimming"], garment: "swim cap", placement: "in clean block letters" }, // Swimmer
  { aliases: ["rugby"], garment: "jersey", placement: "across the upper back or on a chest nameplate" }, // Rugby
  { aliases: ["lacrosse"], garment: "jersey", placement: "across the upper back or on a chest nameplate" }, // Lacrosse
  { aliases: ["field hockey"], garment: "jersey", placement: "across the upper back or on a chest nameplate" }, // Field Hockey
  { aliases: ["track and field", "athletics"], garment: "running singlet", placement: "in clean block letters across the chest" }, // Track and Field
  { aliases: ["tennis"], garment: "tennis shirt", placement: "in clean block letters across the back" }, // Tennis
  { aliases: ["aussie rules"], garment: "jersey", placement: "across the upper back or on a chest nameplate" }, // Aussie Rules Football
  { aliases: ["santa"], garment: "belt buckle", placement: "in clean block letters" }, // Santa Claus
  { aliases: ["mrs. claus", "mrs claus"], garment: "apron bib", placement: "in clean block letters across the chest" }, // Mrs. Claus
  { aliases: ["elf"], garment: "tunic", placement: "in clean block letters across the chest" }, // Elf
  { aliases: ["gingerbread"], garment: "icing panel", placement: "piped in clean block letters across the chest" }, // Gingerbread Man
  { aliases: ["snowman"], garment: "knit scarf", placement: "in clean block letters along the length" }, // Snowman
  { aliases: ["angel"], garment: "gold sash", placement: "in clean embroidered letters" }, // Christmas Angel
  { aliases: ["fairy"], garment: "ribbon sash", placement: "in clean block letters" }, // Christmas Fairy
  { aliases: ["wise man"], garment: "gold sash", placement: "in clean embroidered letters" }, // Wise Man
  { aliases: ["nativity"], garment: "cloth sash", placement: "in clean block letters" }, // Nativity Visitor
  { aliases: ["cosy christmas", "cozy christmas"], garment: "knit sweater", placement: "in clean block letters across the chest" }, // Cosy Christmas
  { aliases: ["reindeer"], garment: "collar tag", placement: "in clean block letters" }, // Reindeer Helper
  { aliases: ["pilgrim"], garment: "cloth sash", placement: "in clean block letters" }, // Pilgrim
  { aliases: ["harvest chef"], garment: "apron bib", placement: "in clean block letters across the chest" }, // Harvest Chef
  { aliases: ["autumn portrait"], garment: "knit scarf", placement: "in clean block letters along the length" }, // Autumn Portrait
  { aliases: ["uncle sam"], garment: "hat band", placement: "in clean block letters around the crown" }, // Uncle Sam
  { aliases: ["stars and stripes", "stars-and-stripes"], garment: "chest sash", placement: "in clean block letters" }, // Stars and Stripes
  { aliases: ["backyard barbecue", "barbecue"], garment: "apron bib", placement: "in clean block letters across the chest" }, // Backyard Barbecue
  { aliases: ["founding father"], garment: "cloth sash", placement: "in clean embroidered letters" }, // Founding Father
  { aliases: ["roman emperor", "emperor"], garment: "crimson sash", placement: "in clean embroidered letters" }, // Roman Emperor
  { aliases: ["pharaoh"], garment: "gold collar plate", placement: "in clean engraved letters" }, // Egyptian Pharaoh
  { aliases: ["napoleonic"], garment: "white sash", placement: "in clean embroidered letters" }, // Napoleonic General
  { aliases: ["medieval queen"], garment: "chest sash", placement: "in clean embroidered letters" }, // Medieval Queen
  { aliases: ["viking"], garment: "cloth sash", placement: "in clean embroidered letters" }, // Viking Chieftain
  { aliases: ["samurai"], garment: "chest plate", placement: "in clean engraved letters" }, // Samurai
  { aliases: ["jazz age", "jazz-age", "1920s"], garment: "hat band", placement: "in clean block letters around the crown" }, // Jazz Age Dapper
  { aliases: ["caped hero"], garment: "chest panel", placement: "in clean block letters" }, // Caped Hero
  { aliases: ["armoured tech", "armored tech"], garment: "chest plate", placement: "in clean block letters" }, // Armoured Tech Hero
  { aliases: ["masked vigilante", "vigilante"], garment: "chest panel", placement: "in clean block letters" }, // Masked Vigilante
  { aliases: ["flying hero"], garment: "chest panel", placement: "in clean block letters" }, // Flying Hero
  { aliases: ["super strength", "super-strength"], garment: "belt buckle", placement: "in clean block letters" }, // Super Strength Hero

  // --- themes that predate the expansion ---
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
    garment: "plain fabric name patch",
    placement: "stitched flat on the chest",
  },
  // Everything below used to fall through to the generic "the uniform reads X
  // on a clean name patch" default, which invents a patch on a ballgown and a
  // uniform on a pirate. Each of these names a surface the role actually has,
  // so the DB base_prompt and this line describe the same piece of cloth
  // instead of competing for where the name goes.
  { aliases: ["skateboard", "skater"], garment: "skate tee", placement: "in clean block letters across the back" },
  { aliases: ["soldier"], garment: "name tape", placement: "stitched flat above the chest pocket" },
  { aliases: ["scientist"], garment: "lab coat", placement: "embroidered on the chest" },
  { aliases: ["artist"], garment: "apron bib", placement: "in clean block letters across the chest" },
  { aliases: ["superhero"], garment: "plain chest panel on the suit", placement: "in clean block letters" },
  { aliases: ["king", "queen"], garment: "chest sash", placement: "in clean embroidered letters" },
  { aliases: ["cowboy"], garment: "hat band", placement: "in clean block letters around the crown" },
  // "Warrier" is how the theme is spelled in the styles table; both spellings
  // are matched so fixing the typo later does not silently break the lookup.
  { aliases: ["warrior", "warrier"], garment: "cloth banner", placement: "hanging on the wall behind" },
  { aliases: ["pirate"], garment: "waist sash", placement: "in clean block letters" },
  { aliases: ["rockstar"], garment: "guitar strap", placement: "in clean block letters" },
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

// Stated as what the fabric IS, not as a list of things to avoid. The old
// wording named logos, team names and sponsors explicitly, and on a model that
// renders nouns regardless of negation that reads closer to a shopping list
// than a prohibition. flux-lora also drops negative_prompt entirely, so this
// line is the only place the rule can land at all.
const getBrandingPrompt = (hasPetName: boolean) =>
  hasPetName
    ? "MARKINGS: the pet name is the only text in the image, and may appear on more than one garment. Every other fabric surface stays plain and unmarked."
    : "MARKINGS: every fabric surface stays plain and unmarked.";

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

/** Which lane is assembling this prompt. "lora" carries the pet's identity in
 * trained weights; "reference" carries it in attached photographs. */
export type GenerationLane = "lora" | "reference";

// "the trained pet" is a LoRA sentence: it points at weights the model carries.
// A reference-image provider has no trained pet, it has photographs, and
// telling it to preserve the identity of something it was never trained on is
// the kind of wording that invents a lookalike. Same clause, different referent.
const getIdentityPrompt = (
  petDescription?: string,
  lane: GenerationLane = "lora",
) => {
  const description = getPetDescriptionClause(petDescription);
  const referent =
    lane === "reference" ? "the pet in the reference photographs" : "the trained pet";
  const subject = description
    ? `one pet only, ${referent} — ${description}`
    : `one pet only, ${referent}`;

  return `IDENTITY: ${subject}. Keep its exact coat color and pattern, markings, breed, build, muzzle length and projection, ears, nose and eye color. Never lighten or recolor the coat.`;
};

const POSE_PROMPT =
  "POSE: upright on hind legs as the participant, shoulders and arms readable in role wardrobe. Furred animal forepaws with visible paw pads, wrapped around the grip. Props gripped or supported, never floating or doubled.";

// Order is deliberate and load-bearing: FLUX truncates from the end, so the
// sections appear in descending order of how much they matter. Theme first
// (it is the whole point of the image), then identity, name, style, pose.
export const generateIdentityPrompt = (
  subject: string,
  lookLevel = 1,
  petName?: string,
  styleName?: string,
  petDescription?: string,
  lane: GenerationLane = "lora",
) => {
  const roleBlueprint = getRoleBlueprintPrompt(styleName);
  const namePrompt = getPetNamePrompt(petName, styleName);

  const prompt = [
    subject.trim().replace(/\.?$/, "."),
    getIdentityPrompt(petDescription, lane),
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

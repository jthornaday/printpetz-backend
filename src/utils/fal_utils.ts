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

const getLookPrompt = (lookLevel: number) => {
  if (lookLevel === 1) {
    return "NATURAL LOOK: keep the exact same full anthropomorphic role transformation, wardrobe, pose, equipment, and participant body language, but make the pet's face stay as close as possible to the real trained pet. Preserve realistic facial proportions, normal eye size, natural head size, true muzzle length and shape, exact ear shape, nose, coat texture, coat pattern, markings, and eye color. The muzzle must keep its real forward projection from the face; never shorten, flatten, compress, widen, or push the nose back toward the eyes. Do not reduce the anthropomorphism: this must still clearly be the pet actively functioning as the selected role. Avoid chibi, mascot exaggeration, toy-like anatomy, giant eyes, or an oversized head.";
  }

  if (lookLevel === 3) {
    return "CARTOON LOOK: keep the exact same full anthropomorphic role transformation, wardrobe, pose, equipment, and participant body language, but render the pet with a clearly illustrated animated-cartoon treatment. Allow more expressive eyes, smoother shapes, simplified fur detail, and tasteful exaggerated character proportions while preserving the pet's defining facial markings, ear shape, true muzzle length and forward projection, nose, coat colors and pattern, and overall identity. Do not flatten or smush the muzzle. The pet must still unmistakably perform the selected role rather than merely attend the scene.";
  }

  return "MASCOT LOOK: keep the exact same full anthropomorphic role transformation, wardrobe, pose, equipment, and participant body language. Render the pet as a polished professional mascot: strongly recognizable as the real pet, with faithful coat pattern, markings, ears, true muzzle length and forward projection, nose, and eye color, plus modestly enhanced expression and clean merchandise-ready character styling. Do not shorten, flatten, smush, or widen the muzzle. Use balanced mascot proportions without giant eyes, extreme chibi, toy-like anatomy, or losing the pet's identity. The pet must clearly perform the selected role.";
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

const getPetNamePrompt = (petName?: string, styleName?: string) => {
  const cleanName = getPetDisplayName(petName);
  if (!cleanName) return "";

  const upperName = cleanName.toUpperCase();
  const normalizedStyle = styleName?.trim().toLowerCase() ?? "";

  let placement =
    "Place the name on the most natural visible part of the wardrobe or role equipment.";
  let requirement =
    "If no natural wardrobe placement is visible, omit the name rather than placing it unnaturally.";

  if (normalizedStyle.includes("baseball")) {
    placement = `For baseball, the pet name must be visible in the final image. If the jersey back is visible, use a clean upper-back nameplate reading \"${upperName}\". If the player is front-facing, place \"${upperName}\" clearly on a simple chest nameplate or clean jersey wordmark area. Reserve that area for the pet name instead of a team letter, team logo, city name, sponsor, or number.`;
    requirement = `For baseball, do not omit the pet name. The visible jersey must contain the readable text \"${upperName}\" exactly once.`;
  } else if (normalizedStyle.includes("football")) {
    placement =
      `For American football, place \"${upperName}\" as a clean player nameplate across the upper back when visible; in a front-facing pose, use a small clean chest nameplate.`;
  } else if (normalizedStyle.includes("basketball")) {
    placement =
      `For basketball, place \"${upperName}\" across the upper back when visible, or use a clean chest nameplate if the pose is front-facing.`;
  } else if (normalizedStyle.includes("soccer")) {
    placement =
      `For soccer, place \"${upperName}\" across the upper back when visible, or use a clean chest nameplate in a front-facing pose.`;
  } else if (normalizedStyle.includes("hockey")) {
    placement =
      `For hockey, place \"${upperName}\" as a clean player nameplate across the upper back when visible, or on a clean chest nameplate when front-facing.`;
  } else if (normalizedStyle.includes("boxing") || normalizedStyle.includes("boxer")) {
    placement =
      `For boxing, place \"${upperName}\" cleanly across the trunks waistband or on the robe if one is present.`;
  } else if (normalizedStyle.includes("cricket")) {
    placement =
      `For cricket, place \"${upperName}\" across the upper back when visible, or use a clean chest nameplate in a front-facing pose.`;
  } else if (normalizedStyle.includes("doctor")) {
    placement =
      `For a doctor, place \"${upperName}\" as a clean professional name badge or embroidered coat detail.`;
  } else if (normalizedStyle.includes("police")) {
    placement =
      `For a police officer, place \"${upperName}\" as a tasteful generic nameplate on the uniform without copying a real department badge or insignia.`;
  } else if (normalizedStyle.includes("firefighter")) {
    placement =
      `For a firefighter, place \"${upperName}\" on a tasteful generic turnout-gear name patch without copying real department branding.`;
  } else if (normalizedStyle.includes("chef")) {
    placement = `For a chef, embroider \"${upperName}\" tastefully on the chef coat.`;
  } else if (normalizedStyle.includes("pilot")) {
    placement =
      `For a pilot, place \"${upperName}\" on a tasteful generic pilot name badge without copying real airline branding.`;
  } else if (normalizedStyle.includes("astronaut")) {
    placement =
      `For an astronaut, place \"${upperName}\" on a generic suit name patch without copying real agency logos or mission insignia.`;
  }

  return ` PET NAME PERSONALIZATION: the pet's name is "${cleanName}". Include the readable name "${upperName}" naturally on the outfit whenever the selected role has a believable uniform, jersey, trunks, coat, badge, patch, or similar placement. ${placement} Spell the name exactly as "${upperName}". Keep it legible, integrated into the garment, and proportionate to the design. Do not invent any other words, letters, team names, logos, sponsors, trademarks, or branding. Do not put the name on the pet's fur, face, body, or floating in the background. ${requirement}`;
};

export const generateIdentityPrompt = (
  subject: string,
  lookLevel = 2,
  petName?: string,
  styleName?: string,
) => {
  const roleBlueprint = getRoleBlueprintPrompt(styleName);

  return `${subject}. IMPORTANT PRINTPETZ CHARACTER RULES: fully transform the trained pet into the selected role, outfit, pose, and environment described above. For sports and human-like roles, the pet must read as the actual participant, not a pet attending the event. DEFAULT BODY LANGUAGE: unless the role clearly requires another action, pose the pet upright on its hind legs like a human participant, with a balanced athletic or professional stance, a clear torso, readable shoulders and arms, and both forepaws positioned intentionally for the role. Do not make the pet sit on all fours or look like a normal pet simply wearing clothes. Preserve animal anatomy at the extremities: forepaws must remain true pet paws with pads/claws/fur appropriate to the animal, never human hands, fingers, thumbs, palms, or knuckles. Use an upright anthropomorphic body with believable shoulders, torso, arms, and role-appropriate wardrobe. Any equipment or prop must be visibly and anatomically supported, correctly gripped, worn, or resting on a believable surface; never allow floating, intersecting, duplicated, broken, or unsupported props. Keep the forepaws and role-defining equipment fully visible whenever equipment is central to the pose. If correct prop interaction would require human-like fingers or impossible anatomy, simplify the pose or omit the prop rather than changing the paws into human hands. Do not recreate the original training-photo background, camera angle, pose, people, hands, furniture, blankets, couches, or setting. Do not show spectators or unrelated people. Do not invent real team logos, letters, trademarks, or recognizable professional sports branding unless licensed branding is explicitly supplied. IDENTITY LOCK: preserve the pet's real head and face proportions from the trained photos. Keep the true muzzle length, width, bridge shape, and forward projection; keep the nose in the same proportional position relative to the eyes. Never compress the muzzle toward the face, flatten the snout, widen the nose bridge, make the face brachycephalic, or substitute another breed's head shape. Preserve coat colors and pattern, facial markings, eye color, ear shape, nose, and recognizable facial structure. Show one pet only.${getPetNamePrompt(petName, styleName)} ${getLookPrompt(lookLevel)} ${roleBlueprint} Use a clean, purpose-built environment that supports the selected role. The result should feel like polished, print-ready, photorealistic PrintPetz artwork with real fur texture and natural lighting.`;
};

type RoleBlueprint = {
  aliases: string[];
  prompt: string;
  negative?: string;
  sports?: boolean;
};

// The global POSE line in fal_utils already describes the forepaws and covers
// prop support for every role. These blueprints only add what is specific to
// the role: how many of each prop, and how they are held.
const roleBlueprints: RoleBlueprint[] = [
  {
    aliases: ["baseball"],
    sports: true,
    // Counts the props rather than forbidding one of them: both are now in
    // every image. The old wording ("Batting: ... no glove. Fielding: ... no
    // bat.") contradicted the subject outright. It also stated both poses in
    // every prompt; the subject already describes whichever pose is being
    // rendered, so this line stays a count and nothing more.
    prompt:
      "Exactly one bat and exactly one glove, each in contact with a forepaw.",
    negative:
      "floating baseball bat, duplicate bat, broken bat, bent bat, bat through body, bat through face, bat through arm, detached paw, missing paw on bat, one-handed unsupported batting pose, glove and bat fused together, bat fused with paw, baseball glove with human fingers, bare human hand",
  },
  {
    aliases: ["golf", "golfer"],
    sports: true,
    prompt:
      "Exactly one golf club, both paws together on the grip, shaft straight and unbroken.",
    negative:
      "floating golf club, duplicate golf club, broken shaft, bent shaft, detached club head, club through body, missing paw on grip, impossible golf grip, human hand on golf club, human fingers on golf club",
  },
  {
    aliases: ["boxing", "boxer"],
    sports: true,
    prompt:
      "Exactly two boxing gloves, one over each forepaw, in a readable guard or punch.",
    negative:
      "floating boxing glove, duplicate boxing glove, detached glove, glove merged with face, missing glove, tangled arms, crossed impossible arms, extra fist, human fist, human fingers coming out of glove",
  },
  {
    aliases: ["football"],
    sports: true,
    prompt:
      "Exactly one football, cradled against the body with one forepaw over the top.",
    negative:
      "floating football, duplicate football, football through torso, football replacing paw, detached paw, impossible ball grip, human hand holding football, human fingers on football",
  },
  {
    aliases: ["basketball"],
    sports: true,
    prompt:
      "Exactly one basketball, held against one or both paws rather than dribbled.",
    negative:
      "floating basketball, duplicate basketball, basketball fused with paw, basketball through body, detached paw, impossible ball grip, human hand on basketball, human fingers on basketball",
  },
  {
    aliases: ["soccer", "footballer"],
    sports: true,
    prompt:
      "Exactly one soccer ball, on or near the ground at the feet, never floating.",
    negative:
      "floating soccer ball, duplicate soccer ball, ball through leg, ball fused with foot, extra leg, impossible kicking pose, human hands on soccer player",
  },
  // Must sit above the ice-hockey entry: "field hockey" contains "hockey", and
  // the ice blueprint would otherwise put a puck on a grass pitch.
  {
    aliases: ["field hockey"],
    sports: true,
    prompt:
      "Exactly one field hockey stick, both paws on the handle. At most one ball, on the turf.",
    negative:
      "floating hockey stick, duplicate hockey stick, broken stick, stick through body, missing paw on stick, floating ball, duplicate ball, human hand on hockey stick, human fingers on hockey stick",
  },
  {
    aliases: ["hockey"],
    sports: true,
    prompt:
      "Exactly one hockey stick, both gloved paws on the shaft. At most one puck, on the ice.",
    negative:
      "floating hockey stick, duplicate hockey stick, broken hockey stick, stick through body, missing paw on stick, floating puck, duplicate puck, human fingers from hockey glove, human hand on hockey stick",
  },
  {
    aliases: ["cricket"],
    sports: true,
    prompt:
      "Batting: exactly one cricket bat, both paws together on the handle. Fielding: no bat.",
    negative:
      "floating cricket bat, duplicate cricket bat, broken cricket bat, bat through body, missing paw on bat, impossible batting grip, human hand on cricket bat, human fingers on cricket bat",
  },
  {
    aliases: ["skateboard", "skateboarding", "skater"],
    sports: true,
    prompt:
      "Exactly one skateboard, both feet placed believably on or above the deck.",
    negative:
      "floating skateboard, duplicate skateboard, bent skateboard through body, detached foot, extra leg, impossible foot placement, human hands on skateboarder",
  },
  {
    aliases: ["doctor", "physician"],
    prompt: "Any stethoscope is worn around the neck, not floating.",
  },
  {
    aliases: ["police"],
    prompt: "Any radio or flashlight is clipped to the uniform or held in one paw.",
  },
  {
    aliases: ["firefighter", "fire fighter"],
    prompt: "Any hose, axe or helmet is worn or held, continuous and unbroken.",
  },
  {
    aliases: ["chef"],
    prompt: "Any utensil or pan is held or resting on the work surface.",
  },
  {
    aliases: ["astronaut"],
    // The helmet is deliberately absent here: the rewritten base_prompt has it
    // off and held so the pet's face is visible, and a suit that "encloses the
    // body, with helmet attached" would fight that every generation.
    prompt: "The suit encloses the body, with gloves and hoses attached.",
  },
];

const findRoleBlueprint = (styleName?: string) => {
  if (!styleName) return undefined;

  const normalized = styleName.trim().toLowerCase();
  return roleBlueprints.find(({ aliases }) =>
    aliases.some((alias) => normalized.includes(alias)),
  );
};

export const getRoleBlueprintPrompt = (styleName?: string) =>
  findRoleBlueprint(styleName)?.prompt ?? "";

// Unchanged: the negative prompt is a separate question (open issue #13) and is
// deliberately untouched by the prompt-budget work.
const SPORTS_PAW_NEGATIVE_PROMPT =
  "human hand, human fingers, furry human hand, human palm, human thumb, human knuckles, fingernails, extra fingers, six fingers, malformed fingers, detached paw, extra paw, paw fused with glove, paw fused with prop, glove fused with paw";

export const getRoleNegativePrompt = (styleName?: string) => {
  const blueprint = findRoleBlueprint(styleName);
  if (!blueprint) return "";

  const negative = blueprint.negative ?? "";
  return blueprint.sports
    ? `${SPORTS_PAW_NEGATIVE_PROMPT}${negative ? `, ${negative}` : ""}`
    : negative;
};

type RoleBlueprint = {
  aliases: string[];
  prompt: string;
  negative?: string;
  sports?: boolean;
};

const SPORTS_PAW_ANATOMY_PROMPT =
  "SPORTS PAW ANATOMY RULES: preserve unmistakable animal forepaws rather than human hands. Do not create human palms, human fingers, thumbs, knuckles, fingernails, or furry human hands. The paws may grasp role equipment only through believable paw contact and positioning. Keep each forepaw compact, furry, species-appropriate, and anatomically connected to the wrist/foreleg. If a glove is worn, the paw must be naturally inside the glove with no extra fingers or second hand visible. If the requested grip cannot be rendered cleanly with animal paws, simplify the pose or omit the prop rather than inventing human hand anatomy. Never merge a paw, glove, bat, stick, ball, or other prop together.";

const SPORTS_PAW_NEGATIVE_PROMPT =
  "human hand, human fingers, furry human hand, human palm, human thumb, human knuckles, fingernails, extra fingers, six fingers, malformed fingers, detached paw, extra paw, paw fused with glove, paw fused with prop, glove fused with paw";

const roleBlueprints: RoleBlueprint[] = [
  {
    aliases: ["baseball"],
    sports: true,
    prompt:
      "BASEBALL POSE BLUEPRINT: choose one clear baseball action only. For batting, render exactly one baseball bat and no fielding glove; use a conventional batter stance with both animal forepaws making clear, compact contact around the bat handle next to each other, elbows bent naturally, and the barrel extending away from the body. For fielding, render exactly one baseball glove naturally fitted over one forepaw and no bat. Do not combine a bat and fielding glove in the same grip. The bat must never float, pass through the face or torso, split into multiple bats, or be supported by an extra limb. Prefer a waist-up or three-quarter composition that keeps both forepaws and all role-defining equipment fully visible. If a clean two-paw bat grip cannot be rendered, use a simpler baseball portrait pose with the bat resting against the shoulder or omit the bat rather than inventing human fingers.",
    negative:
      "floating baseball bat, duplicate bat, broken bat, bent bat, bat through body, bat through face, bat through arm, detached paw, missing paw on bat, one-handed unsupported batting pose, glove and bat fused together, bat fused with paw, baseball glove with human fingers, bare human hand",
  },
  {
    aliases: ["golf", "golfer"],
    sports: true,
    prompt:
      "GOLF POSE BLUEPRINT: render exactly one golf club. Both animal forepaws must meet cleanly around the grip without human fingers or thumbs, with believable wrist, elbow, shoulder, and torso alignment. Use a realistic address, backswing, impact, or follow-through pose. The shaft must remain continuous and straight, must not pass through the body, and the club head must remain attached. Prefer a three-quarter or full-body composition that keeps both paws and the club visible. If the two-paw grip cannot be rendered cleanly, simplify to a posed golfer portrait with the club resting naturally rather than inventing human hands.",
    negative:
      "floating golf club, duplicate golf club, broken shaft, bent shaft, detached club head, club through body, missing paw on grip, impossible golf grip, human hand on golf club, human fingers on golf club",
  },
  {
    aliases: ["boxing", "boxer"],
    sports: true,
    prompt:
      "BOXING POSE BLUEPRINT: show exactly two boxing gloves, one correctly fitted over each animal forepaw. The gloves should read as padded sports gloves containing paws, never human fists or fingered hands. Use a believable boxing guard, jab, cross, or victory pose with coherent shoulders, elbows, wrists, and forelegs. Gloves must never float, duplicate, merge with the face, or appear unattached. Keep both arms clearly readable and avoid crossed or tangled limbs. Prefer a waist-up or three-quarter composition.",
    negative:
      "floating boxing glove, duplicate boxing glove, detached glove, glove merged with face, missing glove, tangled arms, crossed impossible arms, extra fist, human fist, human fingers coming out of glove",
  },
  {
    aliases: ["football"],
    sports: true,
    prompt:
      "FOOTBALL POSE BLUEPRINT: if holding a football, show exactly one football securely cradled against the body or supported naturally by compact animal forepaws. Do not form human fingers around the ball. Keep shoulders, elbows, wrists, forepaws, and ball placement anatomically believable. The football must not float, intersect the torso, duplicate, or replace a paw. Prefer a waist-up or three-quarter player composition. If a clean paw grip is unreliable, cradle the ball against the torso rather than inventing a human hand.",
    negative:
      "floating football, duplicate football, football through torso, football replacing paw, detached paw, impossible ball grip, human hand holding football, human fingers on football",
  },
  {
    aliases: ["basketball"],
    sports: true,
    prompt:
      "BASKETBALL POSE BLUEPRINT: render exactly one basketball. Place it naturally against one or both compact animal forepaws for a hold, pass setup, or supported pose. Paws must make visible physical contact with the ball without becoming human hands or merging into it. Do not duplicate or float the ball. Keep both arms and the ball clearly visible. Prefer a stable hold over a complex finger-dependent dribble or shooting pose.",
    negative:
      "floating basketball, duplicate basketball, basketball fused with paw, basketball through body, detached paw, impossible ball grip, human hand on basketball, human fingers on basketball",
  },
  {
    aliases: ["soccer", "footballer"],
    sports: true,
    prompt:
      "SOCCER POSE BLUEPRINT: render exactly one soccer ball. Use a believable dribble, trap, pass, strike, or poised player stance with anatomically coherent animal legs and paws/feet. The ball must be physically located on or near the playing surface, never floating or intersecting a leg. Prefer a three-quarter or full-body composition when the ball is included. Keep forepaws relaxed and species-appropriate; do not invent human hands just because the body is anthropomorphic.",
    negative:
      "floating soccer ball, duplicate soccer ball, ball through leg, ball fused with foot, extra leg, impossible kicking pose, human hands on soccer player",
  },
  {
    aliases: ["hockey"],
    sports: true,
    prompt:
      "HOCKEY POSE BLUEPRINT: render exactly one hockey stick. Both gloved animal forepaws must contact the shaft in a believable hockey position with coherent elbows and shoulders. Gloves should contain paws and must not expose human fingers. The stick must remain continuous, must not pass through the body, and must not float. If a puck is shown, use exactly one puck on the ice near the blade. Prefer a three-quarter or full-body composition. If the grip cannot be rendered cleanly, simplify to a stable posed hockey stance rather than inventing human hands.",
    negative:
      "floating hockey stick, duplicate hockey stick, broken hockey stick, stick through body, missing paw on stick, floating puck, duplicate puck, human fingers from hockey glove, human hand on hockey stick",
  },
  {
    aliases: ["cricket"],
    sports: true,
    prompt:
      "CRICKET POSE BLUEPRINT: if batting, render exactly one cricket bat held with both compact animal forepaws together on the handle, with believable arm and shoulder alignment and no human fingers. The bat must remain continuous and must not float or intersect the body. If fielding instead, omit the bat and use a clean athletic fielding pose. Prefer a three-quarter composition that keeps both forepaws and equipment visible. If a clean two-paw batting grip cannot be rendered, simplify the pose rather than inventing human hands.",
    negative:
      "floating cricket bat, duplicate cricket bat, broken cricket bat, bat through body, missing paw on bat, impossible batting grip, human hand on cricket bat, human fingers on cricket bat",
  },
  {
    aliases: ["skateboard", "skateboarding", "skater"],
    sports: true,
    prompt:
      "SKATEBOARD POSE BLUEPRINT: render exactly one skateboard with both feet/paws placed believably on or immediately above the deck according to the trick. Keep knees, hips, ankles, and board orientation coherent. The board must not duplicate, bend through the body, or float independently of the rider. Prefer a full-body composition. Forepaws should remain relaxed, compact animal paws without human fingers.",
    negative:
      "floating skateboard, duplicate skateboard, bent skateboard through body, detached foot, extra leg, impossible foot placement, human hands on skateboarder",
  },
  {
    aliases: ["doctor", "physician"],
    prompt:
      "DOCTOR POSE BLUEPRINT: use a clear upright professional pose with believable arms and paws/hands. If a stethoscope is shown, it must be worn around the neck or held naturally, not floating or intersecting the body. Keep medical props minimal and physically supported.",
  },
  {
    aliases: ["police"],
    prompt:
      "POLICE POSE BLUEPRINT: use a confident upright professional stance with anatomically coherent arms and paws/hands. Any radio, badge, flashlight, or other prop must be worn or held naturally and must not float or duplicate. Keep the silhouette clean and readable.",
  },
  {
    aliases: ["firefighter", "fire fighter"],
    prompt:
      "FIREFIGHTER POSE BLUEPRINT: use a strong upright working pose with believable shoulders, elbows, paws/hands, and protective gear. Any hose, axe, helmet, or tool must be physically supported, continuous, and correctly held or worn. Do not allow floating or intersecting equipment.",
  },
  {
    aliases: ["chef"],
    prompt:
      "CHEF POSE BLUEPRINT: use a clear upright chef pose. Any utensil, pan, or food prop must be held naturally or rest on a believable work surface. Keep paws/hands visible and anatomically coherent; do not allow floating utensils or duplicated props.",
  },
  {
    aliases: ["astronaut"],
    prompt:
      "ASTRONAUT POSE BLUEPRINT: use a coherent upright or zero-gravity astronaut pose with the suit enclosing the anthropomorphic body correctly. Helmet, gloves, hoses, and equipment must remain attached and anatomically aligned. Avoid detached or floating suit components unless they are intentionally separate environmental objects.",
  },
];

const findRoleBlueprint = (styleName?: string) => {
  if (!styleName) return undefined;

  const normalized = styleName.trim().toLowerCase();
  return roleBlueprints.find(({ aliases }) =>
    aliases.some((alias) => normalized.includes(alias)),
  );
};

export const getRoleBlueprintPrompt = (styleName?: string) => {
  const blueprint = findRoleBlueprint(styleName);
  if (!blueprint) return "";

  return blueprint.sports
    ? `${SPORTS_PAW_ANATOMY_PROMPT} ${blueprint.prompt}`
    : blueprint.prompt;
};

export const getRoleNegativePrompt = (styleName?: string) => {
  const blueprint = findRoleBlueprint(styleName);
  if (!blueprint) return "";

  const negative = blueprint.negative ?? "";
  return blueprint.sports
    ? `${SPORTS_PAW_NEGATIVE_PROMPT}${negative ? `, ${negative}` : ""}`
    : negative;
};

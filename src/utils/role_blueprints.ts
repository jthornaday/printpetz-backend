type RoleBlueprint = {
  aliases: string[];
  prompt: string;
};

const roleBlueprints: RoleBlueprint[] = [
  {
    aliases: ["baseball"],
    prompt:
      "BASEBALL POSE BLUEPRINT: render exactly one baseball bat if a bat is present. Use a conventional batter stance with the upper body clearly visible, both forepaws/hands wrapped around the bat handle next to each other, elbows bent naturally, and the barrel extending away from the body. The bat must never float, pass through the face or torso, split into multiple bats, or be gripped by only one unsupported paw. If fielding instead, show exactly one glove worn naturally on one hand and no bat. Prefer a waist-up or three-quarter composition that keeps both hands and all equipment fully visible.",
  },
  {
    aliases: ["golf", "golfer"],
    prompt:
      "GOLF POSE BLUEPRINT: render exactly one golf club. Both forepaws/hands must be joined correctly on the grip with believable wrist, elbow, shoulder, and torso alignment. Use a realistic address, backswing, impact, or follow-through pose. The shaft must remain continuous and straight, must not pass through the body, and the club head must remain attached. Prefer a three-quarter or full-body composition that keeps the hands and club visible.",
  },
  {
    aliases: ["boxing", "boxer"],
    prompt:
      "BOXING POSE BLUEPRINT: show exactly two boxing gloves, one correctly fitted to each hand. Use a believable boxing guard, jab, cross, or victory pose with anatomically coherent shoulders, elbows, wrists, and fists. Gloves must never float, duplicate, merge with the face, or appear unattached. Keep both arms clearly readable and avoid crossed or tangled limbs. Prefer a waist-up or three-quarter composition.",
  },
  {
    aliases: ["football"],
    prompt:
      "FOOTBALL POSE BLUEPRINT: if holding a football, show exactly one football securely cradled against the body or gripped naturally by one hand with the other arm supporting the athletic pose. Keep shoulders, elbows, wrists, and ball placement anatomically believable. The football must not float, intersect the torso, duplicate, or replace a hand. Prefer a waist-up or three-quarter player composition.",
  },
  {
    aliases: ["basketball"],
    prompt:
      "BASKETBALL POSE BLUEPRINT: render exactly one basketball. Place it naturally in one or both hands for a hold, pass, shot setup, or dribble pose. Hands must make physical contact with the ball and fingers/paws must not merge into it. Do not duplicate or float the ball. Keep both arms and the ball clearly visible.",
  },
  {
    aliases: ["soccer", "footballer"],
    prompt:
      "SOCCER POSE BLUEPRINT: render exactly one soccer ball. Use a believable dribble, trap, pass, strike, or poised player stance with anatomically coherent legs and feet. The ball must be physically located on or near the playing surface, never floating or intersecting a leg. Prefer a three-quarter or full-body composition when the ball is included.",
  },
  {
    aliases: ["hockey"],
    prompt:
      "HOCKEY POSE BLUEPRINT: render exactly one hockey stick. Both gloved hands must grip the shaft in a believable hockey position with coherent elbows and shoulders. The stick must remain continuous, must not pass through the body, and must not float. If a puck is shown, use exactly one puck on the ice near the blade. Prefer a three-quarter or full-body composition.",
  },
  {
    aliases: ["cricket"],
    prompt:
      "CRICKET POSE BLUEPRINT: if batting, render exactly one cricket bat held correctly with both hands together on the handle, with believable arm and shoulder alignment. The bat must remain continuous and must not float or intersect the body. If fielding instead, omit the bat and use a clean athletic fielding pose. Prefer a three-quarter composition that keeps both hands and equipment visible.",
  },
  {
    aliases: ["skateboard", "skateboarding", "skater"],
    prompt:
      "SKATEBOARD POSE BLUEPRINT: render exactly one skateboard with both feet placed believably on or immediately above the deck according to the trick. Keep knees, hips, ankles, and board orientation coherent. The board must not duplicate, bend through the body, or float independently of the rider. Prefer a full-body composition.",
  },
  {
    aliases: ["doctor", "physician"],
    prompt:
      "DOCTOR POSE BLUEPRINT: use a clear upright professional pose with believable arms and hands. If a stethoscope is shown, it must be worn around the neck or held naturally, not floating or intersecting the body. Keep medical props minimal and physically supported.",
  },
  {
    aliases: ["police"],
    prompt:
      "POLICE POSE BLUEPRINT: use a confident upright professional stance with anatomically coherent arms and hands. Any radio, badge, flashlight, or other prop must be worn or held naturally and must not float or duplicate. Keep the silhouette clean and readable.",
  },
  {
    aliases: ["firefighter", "fire fighter"],
    prompt:
      "FIREFIGHTER POSE BLUEPRINT: use a strong upright working pose with believable shoulders, elbows, hands, and protective gear. Any hose, axe, helmet, or tool must be physically supported, continuous, and correctly held or worn. Do not allow floating or intersecting equipment.",
  },
  {
    aliases: ["chef"],
    prompt:
      "CHEF POSE BLUEPRINT: use a clear upright chef pose. Any utensil, pan, or food prop must be held naturally or rest on a believable work surface. Keep hands visible and anatomically coherent; do not allow floating utensils or duplicated props.",
  },
  {
    aliases: ["astronaut"],
    prompt:
      "ASTRONAUT POSE BLUEPRINT: use a coherent upright or zero-gravity astronaut pose with the suit enclosing the anthropomorphic body correctly. Helmet, gloves, hoses, and equipment must remain attached and anatomically aligned. Avoid detached or floating suit components unless they are intentionally separate environmental objects.",
  },
];

export const getRoleBlueprintPrompt = (styleName?: string) => {
  if (!styleName) return "";

  const normalized = styleName.trim().toLowerCase();
  const blueprint = roleBlueprints.find(({ aliases }) =>
    aliases.some((alias) => normalized.includes(alias)),
  );

  return blueprint?.prompt ?? "";
};

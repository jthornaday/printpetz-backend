type PoseReferenceConfig = {
  aliases: string[];
  envKey: string;
  guidance: string;
  strength?: number;
};

export type PoseReference = {
  url: string;
  guidance: string;
  strength: number;
};

const POSE_REFERENCES: PoseReferenceConfig[] = [
  {
    aliases: ["baseball"],
    envKey: "PRINTPETZ_BASEBALL_POSE_REFERENCES",
    strength: 0.72,
    guidance:
      "POSE REFERENCE RULE: use the reference image only for body pose, limb placement, camera framing, and equipment geometry. Keep the trained pet's identity, face, coat, markings, species, and selected wardrobe from the prompt. For a batting reference, render one bat and no fielding glove. Preserve compact animal forepaws rather than human hands or fingers.",
  },
  {
    aliases: ["boxing", "boxer"],
    envKey: "PRINTPETZ_BOXING_POSE_REFERENCES",
    strength: 0.72,
    guidance:
      "POSE REFERENCE RULE: use the reference image only for boxing stance, shoulder/elbow placement, camera framing, and glove geometry. Keep the trained pet's identity and species. Render exactly two boxing gloves fitted over animal forepaws; do not create human hands or fingers.",
  },
  {
    aliases: ["football"],
    envKey: "PRINTPETZ_FOOTBALL_POSE_REFERENCES",
    strength: 0.7,
    guidance:
      "POSE REFERENCE RULE: use the reference image only for player stance, limb placement, framing, and football placement. Keep the trained pet's identity and species. Preserve compact animal forepaws and simplify any grip that would require human fingers.",
  },
  {
    aliases: ["basketball"],
    envKey: "PRINTPETZ_BASKETBALL_POSE_REFERENCES",
    strength: 0.7,
    guidance:
      "POSE REFERENCE RULE: use the reference image only for player stance, limb placement, framing, and basketball placement. Keep the trained pet's identity and species. Preserve compact animal forepaws rather than human hands.",
  },
  {
    aliases: ["soccer", "footballer"],
    envKey: "PRINTPETZ_SOCCER_POSE_REFERENCES",
    strength: 0.68,
    guidance:
      "POSE REFERENCE RULE: use the reference image only for athletic stance, leg placement, framing, and ball position. Keep the trained pet's identity and species. Do not introduce human hands or unrelated anatomy.",
  },
  {
    aliases: ["hockey"],
    envKey: "PRINTPETZ_HOCKEY_POSE_REFERENCES",
    strength: 0.72,
    guidance:
      "POSE REFERENCE RULE: use the reference image only for hockey stance, arm placement, framing, and stick geometry. Keep the trained pet's identity and species. Gloves contain animal forepaws; never expose human fingers.",
  },
  {
    aliases: ["cricket"],
    envKey: "PRINTPETZ_CRICKET_POSE_REFERENCES",
    strength: 0.72,
    guidance:
      "POSE REFERENCE RULE: use the reference image only for cricket stance, limb placement, framing, and bat geometry. Keep the trained pet's identity and species. Preserve compact animal forepaws rather than human hands.",
  },
  {
    aliases: ["skateboard", "skateboarding", "skater"],
    envKey: "PRINTPETZ_SKATEBOARD_POSE_REFERENCES",
    strength: 0.68,
    guidance:
      "POSE REFERENCE RULE: use the reference image only for rider stance, limb placement, framing, and skateboard orientation. Keep the trained pet's identity and species. Preserve animal paws and coherent leg anatomy.",
  },
];

const getConfig = (styleName?: string) => {
  if (!styleName) return undefined;
  const normalized = styleName.trim().toLowerCase();
  return POSE_REFERENCES.find(({ aliases }) =>
    aliases.some((alias) => normalized.includes(alias)),
  );
};

const parseUrls = (raw?: string) =>
  (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^https?:\/\//i.test(value));

export const getPoseReference = (styleName?: string): PoseReference | undefined => {
  const config = getConfig(styleName);
  if (!config) return undefined;

  const urls = parseUrls(process.env[config.envKey]);
  if (!urls.length) return undefined;

  // Rotate across the approved pose library so generations do not all use the
  // same composition while still staying inside vetted geometry.
  const url = urls[Math.floor(Math.random() * urls.length)];

  return {
    url,
    guidance: config.guidance,
    strength: config.strength ?? 0.7,
  };
};

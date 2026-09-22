/** Chief Delphi tags that have working `/tag/{name}.rss` feeds. */
export const KNOWN_TAGS = [
  "intake",
  "shooter",
  "elevator",
  "swerve",
  "hopper",
  "cad",
  "reefscape",
  "crescendo",
  "charged-up",
  "notes",
  "pneumatics",
  "gearbox",
  "manufacturing",
] as const;

const TOKEN_TO_TAGS: Record<string, string[]> = {
  intake: ["intake"],
  intakes: ["intake"],
  indexer: ["intake", "hopper"],
  hopper: ["hopper"],
  shooter: ["shooter"],
  flywheel: ["shooter"],
  elevator: ["elevator"],
  cascade: ["elevator"],
  swerve: ["swerve"],
  mk4i: ["swerve"],
  mk4: ["swerve"],
  maxswerve: ["swerve"],
  gearbox: ["gearbox"],
  pneumatics: ["pneumatics"],
  pneumatic: ["pneumatics"],
  cad: ["cad"],
  manufacturing: ["manufacturing"],
  algae: ["reefscape"],
  algal: ["reefscape"],
  coral: ["reefscape"],
  reef: ["reefscape"],
  reefscape: ["reefscape"],
  note: ["notes", "crescendo"],
  notes: ["notes", "crescendo"],
  crescendo: ["crescendo", "notes"],
  cone: ["charged-up"],
  cube: ["charged-up"],
  charged: ["charged-up"],
  chargedup: ["charged-up"],
};

export function tagsForTokens(tokens: string[]): string[] {
  const tags = new Set<string>();
  for (const token of tokens) {
    for (const tag of TOKEN_TO_TAGS[token.toLowerCase()] ?? []) {
      if ((KNOWN_TAGS as readonly string[]).includes(tag)) tags.add(tag);
    }
  }
  return [...tags];
}

export function tagRssUrl(tag: string): string {
  return `https://www.chiefdelphi.com/tag/${tag}.rss`;
}

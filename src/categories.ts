export interface Category {
  slug: string;
  id: number;
  name: string;
  path: string;
  designRelevant: boolean;
}

/**
 * Known Chief Delphi categories. Paths match Discourse RSS:
 * https://www.chiefdelphi.com/c/{path}/{id}.rss
 */
export const CATEGORIES: Category[] = [
  { slug: "technical", id: 9, name: "Technical", path: "technical", designRelevant: true },
  {
    slug: "technical-discussion",
    id: 25,
    name: "Technical Discussion",
    path: "technical/technical-discussion",
    designRelevant: true,
  },
  { slug: "cad", id: 68, name: "CAD", path: "technical/cad", designRelevant: true },
  { slug: "onshape", id: 81, name: "Onshape", path: "technical/onshape", designRelevant: true },
  { slug: "solidworks", id: 62, name: "SolidWorks", path: "technical/solidworks", designRelevant: true },
  { slug: "inventor", id: 36, name: "Inventor", path: "technical/inventor", designRelevant: true },
  { slug: "manufacturing", id: 80, name: "Manufacturing", path: "technical/manufacturing", designRelevant: true },
  { slug: "pneumatics", id: 33, name: "Pneumatics", path: "technical/pneumatics", designRelevant: true },
  { slug: "motors", id: 31, name: "Motors", path: "technical/motors", designRelevant: true },
  { slug: "electrical", id: 32, name: "Electrical", path: "technical/electrical", designRelevant: true },
  { slug: "sensors", id: 70, name: "Sensors", path: "technical/sensors", designRelevant: true },
  {
    slug: "kit-hardware",
    id: 34,
    name: "Kit & Additional Hardware",
    path: "technical/kit-additional-hardware",
    designRelevant: true,
  },
  { slug: "control-system", id: 72, name: "Control System", path: "technical/control-system", designRelevant: false },
  { slug: "programming", id: 30, name: "Programming", path: "technical/programming", designRelevant: false },
  { slug: "python", id: 77, name: "Python", path: "technical/python", designRelevant: false },
  { slug: "java", id: 75, name: "Java", path: "technical/java", designRelevant: false },
  { slug: "cpp", id: 74, name: "C/C++", path: "technical/c-c", designRelevant: false },
  { slug: "labview", id: 73, name: "NI LabVIEW", path: "technical/ni-labview", designRelevant: false },
  { slug: "photonvision", id: 87, name: "PhotonVision", path: "technical/photonvision", designRelevant: false },
  { slug: "papers", id: 82, name: "CD-Media: Papers", path: "cd-media-papers", designRelevant: true },
  { slug: "photos", id: 11, name: "CD-Media: Photos", path: "cd-media", designRelevant: false },
  { slug: "competition", id: 5, name: "Competition", path: "competition", designRelevant: false },
  { slug: "first", id: 7, name: "FIRST", path: "first", designRelevant: false },
];

const ALIASES: Record<string, string> = {
  mechanical: "technical-discussion",
  "technical discussion": "technical-discussion",
  paper: "papers",
  whitepaper: "papers",
  whitepapers: "papers",
  "cd-media-papers": "papers",
  "kit-additional-hardware": "kit-hardware",
  hardware: "kit-hardware",
  "c-c": "cpp",
  "c++": "cpp",
  sw: "solidworks",
};

export function isDesignBias(input: string | undefined): boolean {
  return input?.trim().toLowerCase() === "design";
}

export function findCategory(input: string | undefined): Category | undefined {
  if (!input) return undefined;
  const key = input.trim().toLowerCase();
  if (key === "latest" || key === "all" || isDesignBias(key)) return undefined;
  const slug = ALIASES[key] ?? key;
  return CATEGORIES.find(
    (c) => c.slug === slug || c.name.toLowerCase() === key || c.path === slug,
  );
}

export function categoryRssUrl(category: Category): string {
  return `https://www.chiefdelphi.com/c/${category.path}/${category.id}.rss`;
}

export function designSearchHint(query: string): string {
  return `${query} (CAD OR manufacturing OR elevator OR gearbox OR swerve OR "technical discussion")`;
}

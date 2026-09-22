import { getDb } from "./db.js";
import { fetchText } from "./http.js";
import { parseTopicId } from "./rss.js";

const INDEX_URL = "https://www.chiefdelphi.com/sitemap.xml";

export function slugCount(): number {
  ensureSlugTable();
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM topic_slugs").get() as unknown as
    | { n: number }
    | undefined;
  return Number(row?.n) || 0;
}

export function searchTopicSlugs(tokens: string[], limit: number): Array<{ id: number; slug: string; score: number }> {
  const usable = tokens.map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, "")).filter((t) => t.length > 1);
  if (usable.length === 0) return [];
  ensureSlugTable();
  const clauses = usable.map(() => "slug LIKE ?").join(" OR ");
  const params = usable.map((t) => `%${t}%`);
  const rows = getDb()
    .prepare(`SELECT id, slug FROM topic_slugs WHERE ${clauses} LIMIT 200`)
    .all(...params) as unknown as Array<{ id: number; slug: string }>;

  return rows
    .map((row) => {
      const hay = row.slug.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (hay.includes(token.toLowerCase())) score += hay === token || hay.includes(`-${token}-`) ? 3 : 1;
      }
      return { ...row, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.id - a.id)
    .slice(0, limit);
}

export async function ensureTopicSlugs(mode: "recent" | "all"): Promise<{ fetched: number; slugs: number }> {
  ensureSlugTable();
  const existing = slugCount();
  if (mode === "recent" && existing >= 5000) return { fetched: 0, slugs: existing };
  if (mode === "all" && existing >= 50000) return { fetched: 0, slugs: existing };

  const indexXml = await fetchText(INDEX_URL, { ttlMs: 24 * 60 * 60 * 1000 });
  const files = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const numbered = files.filter((u) => /sitemap_\d+\.xml$/.test(u)).sort();
  const recent = files.filter((u) => u.includes("sitemap_recent"));
  const selected =
    mode === "all" ? [...recent, ...numbered] : [...recent, ...numbered.slice(-3)];

  let fetched = 0;
  for (const url of selected) {
    fetched += await ingestSitemapFile(url);
  }
  return { fetched, slugs: slugCount() };
}

function ensureSlugTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS topic_slugs (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL DEFAULT ''
    );
  `);
}

async function ingestSitemapFile(url: string): Promise<number> {
  const xml = await fetchText(url, { ttlMs: 24 * 60 * 60 * 1000 });
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const database = getDb();
  const insert = database.prepare("INSERT OR IGNORE INTO topic_slugs (id, slug) VALUES (?, ?)");
  database.exec("BEGIN");
  let added = 0;
  try {
    for (const loc of locs) {
      const id = parseTopicId(loc);
      const slug = loc.match(/\/t\/([^/?#]+)\//)?.[1] ?? "";
      if (!id || !slug) continue;
      insert.run(id, slug.replace(/-/g, " "));
      added += 1;
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return added;
}

import { getDb } from "./db.js";
import { fetchText } from "./http.js";
import { recencyScore } from "./query.js";
import { parseTopicId } from "./rss.js";

const INDEX_URL = "https://www.chiefdelphi.com/sitemap.xml";
const RECENT_TOPIC_FLOOR = 400000;

export function slugCount(): number {
  ensureSlugTable();
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM topic_slugs").get() as unknown as
    | { n: number }
    | undefined;
  return Number(row?.n) || 0;
}

export function slugMaxId(): number {
  ensureSlugTable();
  const row = getDb().prepare("SELECT MAX(id) AS n FROM topic_slugs").get() as unknown as
    | { n: number }
    | undefined;
  return Number(row?.n) || 0;
}

export function searchTopicSlugs(groups: string[][], limit: number): Array<{ id: number; slug: string; score: number }> {
  const usableGroups = groups
    .map((group) => uniqueTerms(group))
    .filter((group) => group.length > 0);
  if (usableGroups.length === 0) return [];
  ensureSlugTable();

  const andGroups = usableGroups.length >= 2 ? usableGroups : [];
  const rows = andGroups.length > 0 ? slugRowsMatchingAll(andGroups, 400) : slugRowsMatchingAny(usableGroups.flat(), 400);

  const scored = rows
    .map((row) => {
      const hay = row.slug.toLowerCase();
      let matches = 0;
      let score = recencyScore(row.id);
      for (const group of usableGroups) {
        const hit = group.some((token) => hay.includes(token));
        if (!hit) continue;
        matches += 1;
        score += group.some((token) => hay === token || hay.includes(`-${token}-`) || hay.includes(` ${token} `))
          ? 4
          : 2;
      }
      return { ...row, score, matches };
    })
    .filter((row) => (usableGroups.length >= 2 ? row.matches >= 2 : row.matches > 0))
    .sort((a, b) => b.score - a.score || b.id - a.id)
    .slice(0, limit);

  return scored.map(({ id, slug, score }) => ({ id, slug, score }));
}

export function searchSlugsContaining(phrases: string[], limit: number): Array<{ id: number; slug: string }> {
  const usable = phrases.map((p) => p.toLowerCase().trim()).filter((p) => p.length > 2);
  if (usable.length === 0) return [];
  ensureSlugTable();
  const clauses = usable.map(() => "slug LIKE ?").join(" OR ");
  const params = usable.map((p) => `%${p}%`);
  const rows = getDb()
    .prepare(`SELECT id, slug FROM topic_slugs WHERE ${clauses} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit) as unknown as Array<{ id: number; slug: string }>;
  return rows;
}

export async function ensureTopicSlugs(mode: "recent" | "all"): Promise<{ fetched: number; slugs: number }> {
  ensureSlugTable();
  const existing = slugCount();
  const maxId = slugMaxId();
  if (mode === "recent" && existing >= 5000 && maxId >= RECENT_TOPIC_FLOOR) {
    return { fetched: 0, slugs: existing };
  }
  if (mode === "all" && existing >= 50000 && maxId >= RECENT_TOPIC_FLOOR) {
    return { fetched: 0, slugs: existing };
  }

  const indexXml = await fetchText(INDEX_URL, { ttlMs: 24 * 60 * 60 * 1000 });
  const files = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const selected = mode === "all" ? files : await newestSitemapFiles(files);

  let fetched = 0;
  for (const url of selected) {
    fetched += await ingestSitemapFile(url);
  }
  return { fetched, slugs: slugCount() };
}

function uniqueTerms(group: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of group) {
    const token = raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (token.length < 2 || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function slugRowsMatchingAll(
  groups: string[][],
  limit: number,
): Array<{ id: number; slug: string }> {
  const clauses = groups.map((group) => `(${group.map(() => "slug LIKE ?").join(" OR ")})`);
  const params = groups.flatMap((group) => group.map((token) => `%${token}%`));
  return getDb()
    .prepare(`SELECT id, slug FROM topic_slugs WHERE ${clauses.join(" AND ")} LIMIT ?`)
    .all(...params, limit) as unknown as Array<{ id: number; slug: string }>;
}

function slugRowsMatchingAny(tokens: string[], limit: number): Array<{ id: number; slug: string }> {
  const unique = [...new Set(tokens)];
  const clauses = unique.map(() => "slug LIKE ?").join(" OR ");
  const params = unique.map((token) => `%${token}%`);
  return getDb()
    .prepare(`SELECT id, slug FROM topic_slugs WHERE ${clauses} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit) as unknown as Array<{ id: number; slug: string }>;
}

async function newestSitemapFiles(files: string[]): Promise<string[]> {
  const numbered = files.filter((u) => /sitemap_\d+\.xml$/.test(u));
  const recent = files.filter((u) => u.includes("sitemap_recent"));
  const ranges: Array<{ url: string; max: number }> = [];
  for (const url of numbered) {
    const xml = await fetchText(url, { ttlMs: 24 * 60 * 60 * 1000 });
    const ids = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((m) => parseTopicId(m[1]))
      .filter((id): id is number => Boolean(id));
    ranges.push({ url, max: ids.length ? Math.max(...ids) : 0 });
  }
  ranges.sort((a, b) => b.max - a.max);
  const fresh = ranges.filter((row) => row.max >= RECENT_TOPIC_FLOOR).map((row) => row.url);
  const selected = fresh.length > 0 ? fresh : ranges.slice(0, 5).map((row) => row.url);
  return [...recent, ...selected];
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

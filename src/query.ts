import { expansionsFor, GAME_PIECES, normalizeToken, STOP_WORDS, SYNONYMS, WEAK_DISCOVERY_TOKENS } from "./synonyms.js";

export interface ParsedQuery {
  raw: string;
  tokens: string[];
  requiredTokens: string[];
  groups: string[][];
  ftsRequired: string;
  ftsStrict: string;
  ftsExpanded: string;
  ftsBroad: string;
}

export function tokenizeQuery(query: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of query.toLowerCase().replace(/[-_/]+/g, " ").split(/\s+/)) {
    const token = normalizeToken(raw.replace(/[^\w+.-]/g, ""));
    if (token.length < 2 || STOP_WORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

export function parseQuery(query: string, gamePiece?: string): ParsedQuery {
  const tokens = tokenizeQuery(query);
  const piece = gamePiece?.trim().toLowerCase();
  if (piece) {
    const mapped = GAME_PIECES[piece] ?? piece;
    if (!tokens.includes(mapped) && !tokens.includes(piece)) tokens.push(mapped);
  }

  const synonymTokens = tokens.filter((token) => token in SYNONYMS);
  const core = synonymTokens.filter((token) => !WEAK_DISCOVERY_TOKENS.has(token));
  const weak = synonymTokens.filter((token) => WEAK_DISCOVERY_TOKENS.has(token));
  const required = core.length > 0 ? [...core, ...weak.slice(0, 2)] : synonymTokens.length > 0 ? synonymTokens : tokens;
  const groups = tokens.map((token) => expansionsFor(token));
  const requiredGroups = required.map((token) => expansionsFor(token));
  return {
    raw: query,
    tokens,
    requiredTokens: required,
    groups,
    ftsRequired: andGroups(requiredGroups),
    ftsStrict: andGroups(tokens.map((t) => [t])),
    ftsExpanded: andGroups(groups),
    ftsBroad: orTerms(groups.flat()),
  };
}

/** Rough chronological boost from Discourse topic IDs (higher = newer). */
export function recencyScore(topicId: number): number {
  if (topicId >= 500000) return 12;
  if (topicId >= 400000) return 8;
  if (topicId >= 250000) return 4;
  if (topicId >= 150000) return 0;
  return -8;
}

export function looksHistorical(tokens: string[]): boolean {
  return tokens.some((token) => /^(19|20)\d{2}$/.test(token) && Number(token) < 2018);
}

export function scoreText(text: string, tokens: string[]): number {
  if (tokens.length === 0) return 1;
  const hay = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    const hits = countOccurrences(hay, token);
    if (hits > 0) score += Math.min(6, 2 + hits);
  }
  return score;
}

export function extractSnippet(markdown: string, tokens: string[], maxChars = 520): string {
  const compact = markdown.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (tokens.length === 0) {
    return compact.length <= maxChars ? compact : `${compact.slice(0, maxChars - 1).trimEnd()}…`;
  }

  const lower = compact.toLowerCase();
  let bestAt = 0;
  let bestScore = -1;
  for (const token of tokens) {
    const at = lower.indexOf(token.toLowerCase());
    if (at >= 0 && (bestScore < 0 || at < bestAt)) {
      bestAt = at;
      bestScore = at;
    }
  }
  if (bestScore < 0) {
    return compact.length <= maxChars ? compact : `${compact.slice(0, maxChars - 1).trimEnd()}…`;
  }

  const pad = Math.floor(maxChars / 3);
  const start = Math.max(0, bestAt - pad);
  const end = Math.min(compact.length, start + maxChars);
  let slice = compact.slice(start, end).trim();
  if (start > 0) slice = `…${slice}`;
  if (end < compact.length) slice = `${slice}…`;
  return highlight(slice, tokens);
}

function highlight(text: string, tokens: string[]): string {
  let out = text;
  const unique = [...new Set(tokens.map((t) => t.toLowerCase()).filter((t) => t.length > 2))];
  unique.sort((a, b) => b.length - a.length);
  for (const token of unique) {
    const re = new RegExp(`\\b(${escapeRegExp(token)})\\b`, "ig");
    out = out.replace(re, "**$1**");
  }
  return out;
}

function andGroups(groups: string[][]): string {
  const parts = groups
    .map((group) => {
      const terms = uniqueQuoted(group);
      if (terms.length === 0) return "";
      if (terms.length === 1) return terms[0];
      return `(${terms.join(" OR ")})`;
    })
    .filter(Boolean);
  return parts.join(" AND ");
}

function orTerms(terms: string[]): string {
  const quoted = uniqueQuoted(terms);
  if (quoted.length === 0) return "";
  if (quoted.length === 1) return quoted[0];
  return quoted.join(" OR ");
}

function uniqueQuoted(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const cleaned = term.replace(/["*()]/g, "").trim();
    if (cleaned.length < 2) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const quoted = cleaned.includes(" ") ? `"${cleaned}"` : `${cleaned}*`;
    out.push(quoted);
  }
  return out;
}

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  const n = needle.toLowerCase();
  while (true) {
    idx = hay.indexOf(n, idx);
    if (idx < 0) break;
    count += 1;
    idx += n.length;
  }
  return count;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

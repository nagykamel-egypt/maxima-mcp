export type SearchDocumentType = "symbol" | "section";

export interface SearchDocument {
  type: SearchDocumentType;
  /** Symbol name for symbol docs, file name for sections. */
  id: string;
  name?: string;
  title: string;
  section: string;
  text: string;
  uri: string;
}

export interface SearchHit {
  type: SearchDocumentType;
  name?: string;
  title: string;
  section: string;
  snippet: string;
  score: number;
  uri: string;
}

const TOKEN_PATTERN = /[a-z_$%][a-z0-9_$%]*|\d+(?:\.\d+)?|[+\-*/^=<>!]+/g;

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN_PATTERN) ?? [];
}

function stem(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

interface StoredDocument extends SearchDocument {
  length: number;
}

/**
 * Compact BM25 implementation. Postings are stored as flat [docIndex, termFrequency]
 * pairs per token; prefix expansion over a sorted vocabulary handles plurals and
 * simple morphological variants without an external search dependency.
 */
export class SearchIndex {
  private readonly documents: StoredDocument[] = [];
  private readonly postings = new Map<string, number[]>();
  private readonly vocabulary: string[] = [];
  private readonly documentFrequency = new Map<string, number>();
  private totalLength = 0;
  private dirty = true;
  private averageLength = 1;

  get size(): number {
    return this.documents.length;
  }

  add(document: SearchDocument): void {
    const tokens = tokenize(`${document.name ?? ""} ${document.title} ${document.text}`);
    const frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    const index = this.documents.length;
    this.documents.push({ ...document, length: tokens.length });
    this.totalLength += tokens.length;
    for (const [token, frequency] of frequencies) {
      const list = this.postings.get(token);
      if (list) list.push(index, frequency);
      else this.postings.set(token, [index, frequency]);
      this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
    }
    this.dirty = true;
  }

  private finalize(): void {
    if (!this.dirty) return;
    this.vocabulary.length = 0;
    this.vocabulary.push(...this.postings.keys());
    this.vocabulary.sort();
    this.averageLength = this.documents.length
      ? Math.max(1, this.totalLength / this.documents.length)
      : 1;
    this.dirty = false;
  }

  search(query: string, options: { limit?: number; type?: SearchDocumentType } = {}): SearchHit[] {
    this.finalize();
    const limit = options.limit ?? 20;
    const trimmed = query.trim();
    if (!trimmed) return [];
    const queryTokens = [...new Set(tokenize(trimmed))].filter(
      (token) => token.length > 1 || /[%_$]/.test(token),
    );
    if (queryTokens.length === 0) return [];

    const scores = new Map<number, number>();
    const k1 = 1.4;
    const b = 0.75;
    const N = this.documents.length;

    const applyToken = (token: string, weight: number): void => {
      const posting = this.postings.get(token);
      if (!posting) return;
      const df = this.documentFrequency.get(token) ?? 1;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (let i = 0; i < posting.length; i += 2) {
        const docIndex = posting[i]!;
        const tf = posting[i + 1]!;
        const doc = this.documents[docIndex]!;
        if (options.type && doc.type !== options.type) continue;
        const norm = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + (b * doc.length) / this.averageLength);
        const score = weight * idf * (norm / denominator);
        scores.set(docIndex, (scores.get(docIndex) ?? 0) + score);
      }
    };

    for (const token of queryTokens) {
      applyToken(token, 1);
      const stemmed = stem(token);
      if (stemmed !== token) applyToken(stemmed, 0.8);
      if (token.length >= 3) {
        for (const expansion of this.expandPrefix(token, 12)) {
          if (expansion !== token && expansion !== stemmed) applyToken(expansion, 0.45);
        }
      }
    }

    const lowerQuery = trimmed.toLowerCase();
    const results: SearchHit[] = [];
    for (const [index, baseScore] of scores) {
      const doc = this.documents[index]!;
      let score = baseScore;
      const name = (doc.name ?? "").toLowerCase();
      if (name) {
        if (name === lowerQuery) score += 60;
        else if (name.startsWith(lowerQuery)) score += 28;
        else if (name.includes(lowerQuery)) score += 10;
        if (queryTokens.every((token) => name.includes(token))) score += 8;
      }
      if (doc.title.toLowerCase().includes(lowerQuery)) score += 6;
      if (doc.text.toLowerCase().includes(lowerQuery)) score += 4;
      results.push({
        type: doc.type,
        ...(doc.name === undefined ? {} : { name: doc.name }),
        title: doc.title,
        section: doc.section,
        snippet: makeSnippet(doc.text, queryTokens),
        score: Number(score.toFixed(4)),
        uri: doc.uri,
      });
    }

    results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return results.slice(0, limit);
  }

  private expandPrefix(prefix: string, limit: number): string[] {
    let low = 0;
    let high = this.vocabulary.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.vocabulary[mid]! < prefix) low = mid + 1;
      else high = mid;
    }
    const matches: string[] = [];
    for (let i = low; i < this.vocabulary.length && matches.length < limit; i += 1) {
      const token = this.vocabulary[i]!;
      if (!token.startsWith(prefix)) break;
      matches.push(token);
    }
    return matches;
  }
}

export function makeSnippet(text: string, tokens: string[], maxLength = 280): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  const lower = compact.toLowerCase();
  let index = -1;
  for (const token of tokens) {
    index = lower.indexOf(token);
    if (index >= 0) break;
  }
  if (index < 0) return `${compact.slice(0, maxLength - 1)}…`;
  const start = Math.max(0, index - Math.floor(maxLength / 3));
  const end = Math.min(compact.length, start + maxLength);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < compact.length ? "…" : "";
  return `${prefix}${compact.slice(start, end).trim()}${suffix}`;
}

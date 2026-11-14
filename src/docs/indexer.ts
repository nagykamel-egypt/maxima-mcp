import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { DocsConfig } from "../config.js";
import { ToolError } from "../errors.js";
import type { Logger } from "../logger.js";
import { decodeTexinfo, extractExamples, htmlToText } from "./html.js";
import { SearchIndex, type SearchDocumentType, type SearchHit } from "./search.js";

export interface DocEntry {
  name: string;
  kind: string;
  signature: string;
  text: string;
  examples: string[];
  categories: string[];
  file: string;
  anchor: string;
  sectionTitle: string;
  uri: string;
}

export interface DocSection {
  file: string;
  title: string;
  text: string;
  uri: string;
}

export interface HelpResult {
  name: string;
  entries: DocEntry[];
  related: string[];
}

export interface DocsStatus {
  enabled: boolean;
  state: "disabled" | "idle" | "loading" | "ready" | "error";
  entries: number;
  sections: number;
  loadTimeMs?: number;
  error?: string;
  htmlDir: string;
}

interface RawIndexEntry {
  name: string;
  file: string;
  anchor: string;
  sectionTitle: string;
}

const EXCLUDED_SECTIONS = new Set([
  "index.html",
  "maxima_singlepage.html",
  "Function-and-Variable-Index.html",
  "Documentation-Categories.html",
]);

function titleFromHtml($: CheerioAPI): string {
  return (
    $("title")
      .first()
      .text()
      .replace(/\s*\(Maxima [^)]*Manual\)\s*$/i, "")
      .trim() || "Untitled"
  );
}

function bodyNode($: CheerioAPI): AnyNode | undefined {
  return $("body").get(0);
}

/**
 * In-memory index over the Maxima HTML manual. The index is built lazily (or
 * pre-warmed at startup) from the GNU Texinfo-generated HTML shipped by
 * maxima-doc.
 */
export class DocumentationIndex {
  private readonly config: DocsConfig;
  private readonly logger: Logger;
  private state: DocsStatus["state"];
  private loadPromise?: Promise<void>;
  private error?: string;
  private loadTimeMs?: number;
  private entries: DocEntry[] = [];
  private readonly byName = new Map<string, DocEntry[]>();
  private readonly canonicalNames = new Map<string, string>();
  private sections: DocSection[] = [];
  private readonly sectionsByFile = new Map<string, DocSection>();
  private readonly searchIndex = new SearchIndex();
  private categoryCounts = new Map<string, number>();

  constructor(config: DocsConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.state = config.enabled ? "idle" : "disabled";
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  get ready(): boolean {
    return this.state === "ready";
  }

  status(): DocsStatus {
    return {
      enabled: this.enabled,
      state: this.state,
      entries: this.entries.length,
      sections: this.sections.length,
      ...(this.loadTimeMs === undefined ? {} : { loadTimeMs: this.loadTimeMs }),
      ...(this.error === undefined ? {} : { error: this.error }),
      htmlDir: this.config.htmlDir,
    };
  }

  /** Start indexing in the background without blocking server startup. */
  prewarm(): void {
    if (!this.enabled || !this.config.prewarm) return;
    void this.ensureLoaded().catch((error: unknown) => {
      this.logger.warn({ err: error }, "Documentation index prewarm failed");
    });
  }

  async ensureLoaded(): Promise<void> {
    if (!this.enabled) {
      throw new ToolError({
        code: "DOCS_UNAVAILABLE",
        message: "Maxima documentation is not available.",
        hint: "Install maxima-doc (apt-get install maxima-doc) and set MAXIMA_MCP_DOC_DIR if necessary.",
      });
    }
    if (this.state === "ready") return;
    if (this.state === "error") {
      throw new ToolError({
        code: "DOCS_UNAVAILABLE",
        message: `Maxima documentation index failed to load: ${this.error ?? "unknown error"}`,
        hint: "Check MAXIMA_MCP_DOC_DIR and file permissions.",
      });
    }
    this.loadPromise ??= this.build();
    await this.loadPromise;
  }

  private async build(): Promise<void> {
    const start = Date.now();
    this.state = "loading";
    try {
      const files = (await readdir(this.config.htmlDir))
        .filter((file) => file.endsWith(".html"))
        .sort();
      const indexFile = join(this.config.htmlDir, "Function-and-Variable-Index.html");
      const rawEntries = this.parseIndex(await readFile(indexFile, "utf8"));

      const grouped = new Map<string, RawIndexEntry[]>();
      for (const entry of rawEntries) {
        if (!files.includes(entry.file) || entry.file === "index.html") continue;
        const list = grouped.get(entry.file) ?? [];
        list.push(entry);
        grouped.set(entry.file, list);
      }

      const seen = new Set<string>();
      for (const file of files) {
        const html = await readFile(join(this.config.htmlDir, file), "utf8");
        const $ = load(html);
        const title = titleFromHtml($);
        const idMap = new Map<string, AnyNode>();
        $("[id]").each((_, element) => {
          const id = $(element).attr("id");
          if (id && !idMap.has(id)) idMap.set(id, element);
        });

        for (const raw of grouped.get(file) ?? []) {
          const identity = `${raw.file}#${raw.anchor}`;
          if (seen.has(identity)) continue;
          const element = idMap.get(raw.anchor);
          if (!element) continue;
          const entry = this.extractEntry($, element, raw);
          if (!entry) continue;
          seen.add(identity);
          this.entries.push(entry);
          const key = entry.name.toLowerCase();
          const existing = this.byName.get(key);
          if (existing) existing.push(entry);
          else this.byName.set(key, [entry]);
          if (!this.canonicalNames.has(key)) this.canonicalNames.set(key, entry.name);
          for (const category of entry.categories) {
            this.categoryCounts.set(category, (this.categoryCounts.get(category) ?? 0) + 1);
          }
        }

        if (!EXCLUDED_SECTIONS.has(file)) {
          const body = bodyNode($);
          const text = body ? htmlToText($, body) : title;
          const section: DocSection = {
            file,
            title,
            text: text.slice(0, 30_000),
            uri: `maxima://docs/section/${encodeURIComponent(file)}`,
          };
          this.sections.push(section);
          this.sectionsByFile.set(file, section);
        }
      }

      this.buildSearchIndex();
      this.loadTimeMs = Date.now() - start;
      this.state = "ready";
      this.logger.info(
        {
          entries: this.entries.length,
          sections: this.sections.length,
          loadTimeMs: this.loadTimeMs,
        },
        "Documentation index ready",
      );
    } catch (error) {
      this.state = "error";
      this.error = error instanceof Error ? error.message : String(error);
      this.logger.error({ err: error }, "Failed to build documentation index");
      throw new ToolError({
        code: "DOCS_UNAVAILABLE",
        message: `Failed to index Maxima documentation: ${this.error}`,
        hint: `Verify that ${this.config.htmlDir} contains the Maxima HTML manual.`,
        cause: error,
      });
    }
  }

  private parseIndex(html: string): RawIndexEntry[] {
    const $ = load(html);
    const entries: RawIndexEntry[] = [];
    $("td.printindex-index-entry a").each((_, anchor) => {
      const href = $(anchor).attr("href");
      const name = $(anchor).text().replace(/\s+/g, " ").trim();
      if (!href || !name) return;
      const [filePart, anchorPart] = href.split("#");
      if (!anchorPart || !anchorPart.startsWith("index-")) return;
      const file = filePart || "Function-and-Variable-Index.html";
      const row = $(anchor).closest("tr");
      const sectionTitle =
        row.find("td.printindex-index-section a").first().text().replace(/\s+/g, " ").trim() ||
        decodeTexinfo(file.replace(/\.html$/, "").replace(/-/g, " "));
      entries.push({ name, file, anchor: anchorPart, sectionTitle });
    });
    return entries;
  }

  private extractEntry($: CheerioAPI, element: AnyNode, raw: RawIndexEntry): DocEntry | undefined {
    const anchor = $(element);
    const dt = anchor.closest("dt");
    const dl = anchor.closest("dl");
    const dd = dt.length > 0 ? dt.next("dd") : dl.find("dd").first();
    const kind = dt.find(".category-def").first().text().replace(/:\s*$/, "").trim() || "Symbol";
    let signature = dt.length
      ? htmlToText($, dt.get(0)!).replace(new RegExp(`^${escapeRegExp(kind)}:\\s*`), "")
      : raw.name;
    signature = signature.replace(/\s+/g, " ").trim();
    // Texinfo repeats the name in the definition line (e.g. "integrate integrate (expr, x)").
    if (signature.startsWith(`${raw.name} ${raw.name}`)) {
      signature = signature.slice(raw.name.length + 1).trim();
    }
    // Separate overloaded signatures for readability.
    signature = signature.replace(
      new RegExp(`\\s+(?=${escapeRegExp(raw.name)}\\s*\\()`, "g"),
      " | ",
    );

    let descriptionNode: AnyNode | undefined = dd.get(0);
    if (!descriptionNode) descriptionNode = dl.get(0);
    let description = "";
    if (descriptionNode) {
      const clone = $(descriptionNode).clone();
      clone.find(".example, pre, .categorybox").remove();
      description = htmlToText($, clone.get(0)!);
    }

    const examples = extractExamples($, dd.length ? dd.get(0)! : (dl.get(0) ?? element));
    const categoryLinks: string[] = [];
    const collectCategories = (selection: Cheerio<Element>): void => {
      selection.each((_, link) => {
        const text = $(link).text().trim();
        if (text) categoryLinks.push(text);
      });
    };
    collectCategories(dl.find(".categorybox a"));
    collectCategories(dl.next(".categorybox").find("a"));
    const categories = [...new Set(categoryLinks)];
    const text = description.trim() || signature.trim();

    return {
      name: raw.name,
      kind,
      signature: signature.trim(),
      text,
      examples,
      categories,
      file: raw.file,
      anchor: raw.anchor,
      sectionTitle: raw.sectionTitle,
      uri: `maxima://docs/symbol/${encodeURIComponent(raw.name)}`,
    };
  }

  private buildSearchIndex(): void {
    for (const entry of this.entries) {
      this.searchIndex.add({
        type: "symbol",
        id: entry.name,
        name: entry.name,
        title: entry.name,
        section: entry.sectionTitle,
        text: `${entry.signature}\n${entry.text}`.slice(0, 6_000),
        uri: entry.uri,
      });
    }
    for (const section of this.sections) {
      this.searchIndex.add({
        type: "section",
        id: section.file,
        title: section.title,
        section: section.title,
        text: section.text.slice(0, 20_000),
        uri: section.uri,
      });
    }
  }

  async help(name: string, limit = 4): Promise<HelpResult> {
    await this.ensureLoaded();
    const query = name.trim();
    if (!query) {
      throw new ToolError({
        code: "VALIDATION_ERROR",
        message: "A symbol name is required.",
        hint: "Example: integrate, solve, diff, plot2d.",
      });
    }

    let matches = this.byName.get(query.toLowerCase()) ?? [];
    if (matches.length === 0) {
      const lower = query.toLowerCase();
      const prefix: string[] = [];
      for (const [key, canonical] of this.canonicalNames) {
        if (key.startsWith(lower)) prefix.push(canonical);
        if (prefix.length >= 25) break;
      }
      if (prefix.length > 0) {
        throw new ToolError({
          code: "DOC_NOT_FOUND",
          message: `No exact documentation entry for '${query}'.`,
          hint: `Did you mean: ${prefix.slice(0, 12).join(", ")}?`,
        });
      }
      const contains: string[] = [];
      for (const [key, canonical] of this.canonicalNames) {
        if (key.includes(lower)) contains.push(canonical);
        if (contains.length >= 12) break;
      }
      throw new ToolError({
        code: "DOC_NOT_FOUND",
        message: `No documentation found for '${query}'.`,
        hint: contains.length
          ? `Related symbols: ${contains.join(", ")}.`
          : "Try maxima_search_docs to search the manual by concept.",
      });
    }

    matches = matches.slice(0, limit);
    const related = new Set<string>();
    for (const entry of matches) {
      for (const candidate of this.entries) {
        if (
          candidate.file === entry.file &&
          candidate.sectionTitle === entry.sectionTitle &&
          candidate.name !== entry.name
        ) {
          related.add(candidate.name);
          if (related.size >= 12) break;
        }
      }
      if (related.size >= 12) break;
    }

    return { name: query, entries: matches, related: [...related] };
  }

  async search(
    query: string,
    options: { limit?: number; type?: SearchDocumentType } = {},
  ): Promise<SearchHit[]> {
    await this.ensureLoaded();
    const trimmed = query.trim();
    if (!trimmed) {
      throw new ToolError({
        code: "VALIDATION_ERROR",
        message: "A search query is required.",
      });
    }
    return this.searchIndex.search(trimmed, {
      limit: Math.min(options.limit ?? 10, this.config.maxSearchResults),
      ...(options.type === undefined ? {} : { type: options.type }),
    });
  }

  async examples(name: string): Promise<HelpResult> {
    const result = await this.help(name, 6);
    if (!result.entries.some((entry) => entry.examples.length > 0)) {
      throw new ToolError({
        code: "DOC_NOT_FOUND",
        message: `No examples are available in the manual for '${name}'.`,
        hint: "Try maxima_search_docs or evaluate the symbol with a simple input.",
      });
    }
    return result;
  }

  async listSymbols(prefix = "", limit = 100): Promise<Array<{ name: string; kind: string }>> {
    await this.ensureLoaded();
    const lower = prefix.trim().toLowerCase();
    const result: Array<{ name: string; kind: string }> = [];
    const seen = new Set<string>();
    for (const [key, canonical] of this.canonicalNames) {
      if (lower && !key.startsWith(lower)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = this.byName.get(key)?.[0];
      result.push({ name: canonical, kind: entry?.kind ?? "Symbol" });
      if (result.length >= Math.max(1, Math.min(limit, 500))) break;
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listSections(): Promise<Array<{ file: string; title: string; uri: string }>> {
    await this.ensureLoaded();
    return this.sections.map((section) => ({
      file: section.file,
      title: section.title,
      uri: section.uri,
    }));
  }

  listCategories(): Array<{ name: string; count: number }> {
    return [...this.categoryCounts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  async readSection(file: string, maxChars = 200_000): Promise<DocSection> {
    await this.ensureLoaded();
    const safe = basename(file);
    if (safe !== file || !safe.endsWith(".html") || safe === "index.html") {
      throw new ToolError({
        code: "VALIDATION_ERROR",
        message: `Invalid documentation section '${file}'.`,
        hint: "Use a file name returned by maxima_doc_sections, for example Integration.html.",
      });
    }
    const known = this.sectionsByFile.get(safe);
    if (!known) {
      throw new ToolError({
        code: "DOC_NOT_FOUND",
        message: `Unknown documentation section '${safe}'.`,
        hint: "Use maxima_doc_sections to list available sections.",
      });
    }
    const html = await readFile(join(this.config.htmlDir, safe), "utf8");
    const $ = load(html);
    const body = bodyNode($);
    const text = body ? htmlToText($, body) : known.text;
    return {
      ...known,
      text: text.slice(0, maxChars),
    };
  }

  suggest(prefix: string, limit = 20): string[] {
    const lower = prefix.toLowerCase();
    const matches: string[] = [];
    for (const [key, canonical] of this.canonicalNames) {
      if (key.startsWith(lower)) matches.push(canonical);
      if (matches.length >= limit) break;
    }
    return matches;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

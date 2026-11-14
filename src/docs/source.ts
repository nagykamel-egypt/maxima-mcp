import { readFile, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { DocsConfig } from "../config.js";
import { ToolError } from "../errors.js";
import type { Logger } from "../logger.js";

export interface SourceRef {
  symbol: string;
  file: string;
  path: string;
  line: number;
  kind: string;
  language: "lisp" | "maxima" | "demo";
}

export interface SourceSearchHit {
  file: string;
  path: string;
  line: number;
  text: string;
  before: string[];
  after: string[];
}

export interface SourcePackage {
  name: string;
  path: string;
  files: string[];
}

export interface SourceStatus {
  state: "idle" | "loading" | "ready" | "error";
  files: number;
  symbols: number;
  packages: number;
  loadTimeMs?: number;
  error?: string;
}

const LISP_DEFINITION =
  /^[ \t]*\((defmfun|defun|defmspec|defmvar|mdefprop|defprop|def-simplifier|define-compiler-macro)\s+\$?([^\s()"']+)/gm;
const MAXIMA_DEFINITION =
  /^[ \t]*([A-Za-z_%][A-Za-z0-9_%]*)\s*(?:\[[^\]]*\])?\s*(?:\([^)]*\))?\s*:=/gm;
const MAXIMA_DEFINE_VARIABLE = /^[ \t]*define_variable\s*\(\s*([A-Za-z_%][A-Za-z0-9_%]*)/gm;
const SUPPORTED_EXTENSIONS = new Set([".lisp", ".mac", ".dem"]);
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function lineStarts(text: string): number[] {
  const starts = [0];
  let index = text.indexOf("\n");
  while (index >= 0) {
    starts.push(index + 1);
    index = text.indexOf("\n", index + 1);
  }
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (starts[mid]! <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return high + 1;
}

async function walkFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path, depth + 1)));
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    if (SUPPORTED_EXTENSIONS.has(extension)) files.push(path);
  }
  return files;
}

/**
 * Index of Maxima Lisp and Maxima-language sources installed by maxima-src and
 * maxima-share. Supports symbol lookup, definition snippets, full-text search
 * and discovery of loadable share packages.
 */
export class SourceIndex {
  private readonly config: DocsConfig;
  private readonly logger: Logger;
  private state: SourceStatus["state"] = "idle";
  private loadPromise?: Promise<void>;
  private loadTimeMs?: number;
  private error?: string;
  private readonly refs = new Map<string, SourceRef[]>();
  private files: Array<{ file: string; path: string; language: SourceRef["language"] }> = [];
  private packages: SourcePackage[] = [];
  private readonly roots: string[];
  /** LRU cache of file contents to avoid re-reading the source tree on every search. */
  private readonly contentCache = new Map<string, string>();
  private contentCacheBytes = 0;

  constructor(config: DocsConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.roots = [config.srcDir, config.shareDir].filter(Boolean).map((path) => resolve(path));
  }

  get enabled(): boolean {
    return this.roots.length > 0;
  }

  status(): SourceStatus {
    return {
      state: this.state,
      files: this.files.length,
      symbols: this.refs.size,
      packages: this.packages.length,
      ...(this.loadTimeMs === undefined ? {} : { loadTimeMs: this.loadTimeMs }),
      ...(this.error === undefined ? {} : { error: this.error }),
    };
  }

  async ensureLoaded(): Promise<void> {
    if (!this.enabled) {
      throw new ToolError({
        code: "SOURCE_UNAVAILABLE",
        message: "Maxima source is not available.",
        hint: "Install maxima-src and maxima-share (apt-get install maxima-src maxima-share) or set MAXIMA_MCP_SRC_DIR / MAXIMA_MCP_SHARE_DIR.",
      });
    }
    if (this.state === "ready") return;
    if (this.state === "error") {
      throw new ToolError({
        code: "SOURCE_UNAVAILABLE",
        message: `Maxima source index failed to load: ${this.error ?? "unknown error"}`,
      });
    }
    this.loadPromise ??= this.build();
    await this.loadPromise;
  }

  prewarm(): void {
    if (!this.enabled) return;
    void this.ensureLoaded().catch((error: unknown) => {
      this.logger.warn({ err: error }, "Source index prewarm failed");
    });
  }

  private async build(): Promise<void> {
    const start = Date.now();
    this.state = "loading";
    try {
      const paths: string[] = [];
      for (const root of this.roots) {
        paths.push(...(await walkFiles(root)));
      }
      const unique = [...new Set(paths)].sort();

      for (const path of unique) {
        const info = await stat(path).catch(() => undefined);
        if (!info || info.size > MAX_FILE_BYTES) continue;
        const extension = path.slice(path.lastIndexOf("."));
        const language: SourceRef["language"] =
          extension === ".lisp" ? "lisp" : extension === ".mac" ? "maxima" : "demo";
        const file = relativeToRoots(path, this.roots);
        this.files.push({ file, path, language });
        if (extension === ".dem") continue;
        const text = await readFile(path, "utf8").catch(() => undefined);
        if (text === undefined) continue;
        const starts = lineStarts(text);
        if (language === "lisp") {
          this.indexDefinitions(text, starts, path, file, "lisp", LISP_DEFINITION, 2);
        } else {
          this.indexDefinitions(text, starts, path, file, "maxima", MAXIMA_DEFINITION, 1);
          this.indexDefinitions(text, starts, path, file, "maxima", MAXIMA_DEFINE_VARIABLE, 1);
        }
      }

      this.packages = await this.discoverPackages();
      this.loadTimeMs = Date.now() - start;
      this.state = "ready";
      this.logger.info(
        {
          files: this.files.length,
          symbols: this.refs.size,
          packages: this.packages.length,
          loadTimeMs: this.loadTimeMs,
        },
        "Source index ready",
      );
    } catch (error) {
      this.state = "error";
      this.error = error instanceof Error ? error.message : String(error);
      this.logger.error({ err: error }, "Failed to build source index");
      throw new ToolError({
        code: "SOURCE_UNAVAILABLE",
        message: `Failed to index Maxima source: ${this.error}`,
        cause: error,
      });
    }
  }

  private indexDefinitions(
    text: string,
    starts: number[],
    path: string,
    file: string,
    language: SourceRef["language"],
    pattern: RegExp,
    nameGroup: number,
  ): void {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const symbol = match[nameGroup];
      const kind = match[1] ?? "definition";
      if (!symbol || symbol.length > 200) continue;
      const line = lineAt(starts, match.index);
      this.addRef({
        symbol,
        file,
        path,
        line,
        kind,
        language,
      });
    }
  }

  private addRef(ref: SourceRef): void {
    const key = ref.symbol.toLowerCase();
    const list = this.refs.get(key);
    if (list) {
      if (list.some((existing) => existing.path === ref.path && existing.line === ref.line)) return;
      if (list.length >= 50) return;
      list.push(ref);
    } else {
      this.refs.set(key, [ref]);
    }
  }

  /**
   * Read a file's contents, serving from (and populating) a bounded LRU cache.
   * Returns undefined when the file cannot be read so callers can degrade
   * gracefully rather than throwing on a transient I/O error.
   */
  private async readContent(path: string): Promise<string | undefined> {
    const cached = this.contentCache.get(path);
    if (cached !== undefined) {
      // Refresh recency so the cache behaves as LRU.
      this.contentCache.delete(path);
      this.contentCache.set(path, cached);
      return cached;
    }
    const content = await readFile(path, "utf8").catch(() => undefined);
    if (content === undefined) return undefined;
    this.storeContent(path, content);
    return content;
  }

  private storeContent(path: string, content: string): void {
    const cap = this.config.sourceCacheBytes;
    if (cap <= 0 || content.length > cap) return;
    if (this.contentCache.has(path)) return;
    while (this.contentCacheBytes + content.length > cap && this.contentCache.size > 0) {
      const oldest = this.contentCache.keys().next().value;
      if (oldest === undefined) break;
      const removed = this.contentCache.get(oldest) ?? "";
      this.contentCache.delete(oldest);
      this.contentCacheBytes -= removed.length;
    }
    this.contentCache.set(path, content);
    this.contentCacheBytes += content.length;
  }

  private async discoverPackages(): Promise<SourcePackage[]> {
    if (!this.config.shareDir) return [];
    const shareDir = resolve(this.config.shareDir);
    let entries;
    try {
      entries = await readdir(shareDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const packages = new Map<string, SourcePackage>();
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = resolve(shareDir, entry.name);
      if (entry.isDirectory()) {
        const files = await walkFiles(path, 3);
        const maximaFiles = files.filter((file) => file.endsWith(".mac"));
        if (maximaFiles.length === 0) continue;
        const name = entry.name;
        packages.set(name, {
          name,
          path,
          files: maximaFiles.map((file) => relative(shareDir, file)).sort(),
        });
      } else if (entry.isFile() && entry.name.endsWith(".mac")) {
        const name = entry.name.replace(/\.mac$/, "");
        packages.set(name, { name, path, files: [basename(path)] });
      }
    }
    return [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Find source definitions for a Maxima symbol. */
  async find(symbol: string): Promise<SourceRef[]> {
    await this.ensureLoaded();
    const name = symbol.trim().replace(/^%/, "").toLowerCase();
    if (!name) {
      throw new ToolError({ code: "VALIDATION_ERROR", message: "A symbol name is required." });
    }
    const direct = this.refs.get(name) ?? [];
    const withDollar = this.refs.get(`$${name}`) ?? [];
    const combined = [...direct, ...withDollar];
    if (combined.length > 0) return combined;
    const matches: SourceRef[] = [];
    for (const [key, refs] of this.refs) {
      if (key.includes(name)) matches.push(...refs);
      if (matches.length >= 25) break;
    }
    if (matches.length === 0) {
      throw new ToolError({
        code: "DOC_NOT_FOUND",
        message: `No source definition found for '${symbol}'.`,
        hint: "Try maxima_search_source to search the implementation by text, or maxima_help for documentation.",
      });
    }
    return matches.slice(0, 25);
  }

  /** Read a source location with context lines. */
  async read(
    ref: SourceRef,
    contextLines = 8,
  ): Promise<{
    file: string;
    line: number;
    startLine: number;
    endLine: number;
    text: string;
  }> {
    this.assertAllowed(ref.path);
    const content = await this.readContent(ref.path);
    if (content === undefined) {
      throw new ToolError({
        code: "SOURCE_UNAVAILABLE",
        message: `Failed to read source file '${ref.path}'.`,
      });
    }
    const lines = content.split(/\r?\n/);
    const start = Math.max(0, ref.line - 1 - contextLines);
    const end = Math.min(lines.length, ref.line + contextLines);
    return {
      file: ref.file,
      line: ref.line,
      startLine: start + 1,
      endLine: end,
      text: lines
        .slice(start, end)
        .map((line, index) => `${String(start + index + 1).padStart(6, " ")}  ${line}`)
        .join("\n"),
    };
  }

  async search(
    query: string,
    options: {
      regex?: boolean;
      caseSensitive?: boolean;
      limit?: number;
      contextLines?: number;
      fileFilter?: string;
    } = {},
  ): Promise<SourceSearchHit[]> {
    await this.ensureLoaded();
    const needle = query.trim();
    if (!needle) {
      throw new ToolError({ code: "VALIDATION_ERROR", message: "A search query is required." });
    }
    if (needle.length > 500) {
      throw new ToolError({
        code: "LIMIT_EXCEEDED",
        message: "Source search queries are limited to 500 characters.",
      });
    }

    let matcher: (line: string) => boolean;
    if (options.regex) {
      let pattern: RegExp;
      try {
        pattern = new RegExp(needle, options.caseSensitive ? "" : "i");
      } catch (error) {
        throw new ToolError({
          code: "VALIDATION_ERROR",
          message: `Invalid regular expression: ${(error as Error).message}`,
        });
      }
      matcher = (line) => pattern.test(line);
    } else if (options.caseSensitive) {
      matcher = (line) => line.includes(needle);
    } else {
      const lower = needle.toLowerCase();
      matcher = (line) => line.toLowerCase().includes(lower);
    }

    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const contextLines = Math.max(0, Math.min(options.contextLines ?? 2, 10));
    const filter = options.fileFilter?.trim().toLowerCase();
    const hits: SourceSearchHit[] = [];

    for (const file of this.files) {
      if (filter && !file.file.toLowerCase().includes(filter)) continue;
      const content = await this.readContent(file.path);
      if (content === undefined) continue;
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        if (!matcher(line)) continue;
        hits.push({
          file: file.file,
          path: file.path,
          line: index + 1,
          text: line.trim(),
          before: lines.slice(Math.max(0, index - contextLines), index),
          after: lines.slice(index + 1, index + 1 + contextLines),
        });
        if (hits.length >= limit) return hits;
      }
    }
    return hits;
  }

  async readFileByRelativePath(
    file: string,
    maxChars = 200_000,
  ): Promise<{ file: string; text: string }> {
    await this.ensureLoaded();
    const match = this.files.find((entry) => entry.file === file);
    if (!match) {
      throw new ToolError({
        code: "DOC_NOT_FOUND",
        message: `Unknown source file '${file}'.`,
        hint: "Use maxima_list_packages or maxima_search_source to discover files.",
      });
    }
    const content = await this.readContent(match.path);
    if (content === undefined) {
      throw new ToolError({
        code: "SOURCE_UNAVAILABLE",
        message: `Failed to read source file '${match.path}'.`,
      });
    }
    return { file: match.file, text: content.slice(0, maxChars) };
  }

  async listPackages(filter = "", limit = 200): Promise<SourcePackage[]> {
    await this.ensureLoaded();
    const lower = filter.trim().toLowerCase();
    return this.packages
      .filter((pkg) => !lower || pkg.name.toLowerCase().includes(lower))
      .slice(0, Math.max(1, Math.min(limit, 1_000)));
  }

  async resolvePackage(name: string): Promise<SourcePackage> {
    await this.ensureLoaded();
    const pkg = this.packages.find((candidate) => candidate.name === name);
    if (!pkg) {
      throw new ToolError({
        code: "PACKAGE_NOT_FOUND",
        message: `Maxima share package '${name}' was not found.`,
        hint: "Use maxima_list_packages to see installed packages.",
      });
    }
    return pkg;
  }

  async listFiles(filter = "", limit = 200): Promise<Array<{ file: string; language: string }>> {
    await this.ensureLoaded();
    const lower = filter.trim().toLowerCase();
    return this.files
      .filter((file) => !lower || file.file.toLowerCase().includes(lower))
      .slice(0, Math.max(1, Math.min(limit, 1_000)))
      .map((file) => ({ file: file.file, language: file.language }));
  }

  private assertAllowed(path: string): void {
    const resolved = resolve(path);
    const allowed = this.roots.some(
      (root) => resolved === root || resolved.startsWith(`${root}${sep}`),
    );
    if (!allowed) {
      throw new ToolError({
        code: "VALIDATION_ERROR",
        message: "Source path is outside the configured Maxima source directories.",
      });
    }
  }
}

function relativeToRoots(path: string, roots: string[]): string {
  for (const root of roots) {
    const rel = relative(root, path);
    if (!rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/");
  }
  return basename(path);
}

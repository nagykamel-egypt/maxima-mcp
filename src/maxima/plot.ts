import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../config.js";
import { ToolError } from "../errors.js";
import { assertSafe, maximaNumber, maximaString } from "./expressions.js";
import type { SessionManager } from "./sessions.js";

export type PlotFormat = "png" | "svg";

export interface PlotOptions {
  expressions: string[];
  xMin: number;
  xMax: number;
  yMin?: number;
  yMax?: number;
  format?: PlotFormat;
  kind?: "2d" | "3d";
  title?: string;
  xlabel?: string;
  ylabel?: string;
  width?: number;
  height?: number;
  logX?: boolean;
  logY?: boolean;
  grid?: boolean;
  legend?: boolean;
  sessionId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface PlotResult {
  data: Buffer;
  mimeType: string;
  format: PlotFormat;
  bytes: number;
  command: string;
  output: string;
  durationMs: number;
  sessionId: string;
}

function assertFinite(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isFinite(value)) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: `${name} must be a finite number.`,
    });
  }
}

function cleanExpression(expression: string, index: number, allowDangerous: boolean): string {
  let value = expression.trim();
  if (!value) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: `Expression ${index + 1} is empty.`,
    });
  }
  if (value.length > 20_000) {
    throw new ToolError({
      code: "LIMIT_EXCEEDED",
      message: `Expression ${index + 1} is too long for plotting.`,
    });
  }
  value = value.replace(/[;$]\s*$/, "").trim();
  if (/[;$]/.test(value)) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: `Expression ${index + 1} must not contain statement terminators (';' or '$').`,
    });
  }
  assertSafe(value, allowDangerous);
  return value;
}

/**
 * Render a 2D or 3D Maxima plot to PNG or SVG using Maxima's gnuplot backend.
 */
export async function renderPlot(
  config: AppConfig,
  sessions: SessionManager,
  options: PlotOptions,
): Promise<PlotResult> {
  const kind = options.kind ?? "2d";
  const format: PlotFormat = options.format ?? "png";
  if (format !== "png" && format !== "svg") {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: `Unsupported plot format '${String(format)}'.`,
      hint: "Use 'png' or 'svg'.",
    });
  }
  if (!Array.isArray(options.expressions) || options.expressions.length === 0) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: "At least one expression is required.",
    });
  }
  if (options.expressions.length > 12) {
    throw new ToolError({
      code: "LIMIT_EXCEEDED",
      message: "A single plot may contain at most 12 expressions.",
    });
  }

  assertFinite("x_min", options.xMin);
  assertFinite("x_max", options.xMax);
  assertFinite("y_min", options.yMin);
  assertFinite("y_max", options.yMax);
  if (options.xMax <= options.xMin) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: "x_max must be greater than x_min.",
    });
  }
  if (kind === "3d" && (options.yMin === undefined || options.yMax === undefined)) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: "3D plots require y_min and y_max.",
    });
  }
  if (options.yMin !== undefined && options.yMax !== undefined && options.yMax <= options.yMin) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: "y_max must be greater than y_min.",
    });
  }
  if (options.xMax - options.xMin > 1e9) {
    throw new ToolError({
      code: "LIMIT_EXCEEDED",
      message: "Plot range is too large.",
    });
  }

  const width = Math.round(options.width ?? 900);
  const height = Math.round(options.height ?? 600);
  if (width < 100 || width > 4000 || height < 100 || height > 4000) {
    throw new ToolError({
      code: "VALIDATION_ERROR",
      message: "Plot width and height must be between 100 and 4000 pixels.",
    });
  }

  const expressions = options.expressions.map((expression, index) =>
    cleanExpression(expression, index, config.maxima.allowDangerous),
  );
  const tempDir = mkdtempSync(join(tmpdir(), "maxima-plot-"));
  const outputPath = join(tempDir, `plot.${format}`);

  try {
    const terminal = `${format} size ${width},${height}`;
    const parts: string[] = [];
    const preamble: string[] = [];
    if (options.grid !== false) preamble.push("set grid");
    if (options.legend === false) preamble.push("set key off");
    if (preamble.length > 0) parts.push(`[gnuplot_preamble, ${maximaString(preamble.join("; "))}]`);
    parts.push(`[gnuplot_term, ${maximaString(terminal)}]`);
    parts.push(`[gnuplot_out_file, ${maximaString(outputPath)}]`);
    if (options.title) parts.push(`[title, ${maximaString(options.title)}]`);
    if (options.xlabel) parts.push(`[xlabel, ${maximaString(options.xlabel)}]`);
    if (options.ylabel) parts.push(`[ylabel, ${maximaString(options.ylabel)}]`);
    if (options.logX) parts.push("[logx, true]");
    if (options.logY) parts.push("[logy, true]");

    const functionList = expressions.length === 1 ? expressions[0]! : `[${expressions.join(", ")}]`;
    const yRange =
      options.yMin !== undefined && options.yMax !== undefined
        ? `, [y, ${maximaNumber(options.yMin)}, ${maximaNumber(options.yMax)}]`
        : "";
    const command =
      kind === "3d"
        ? `plot3d(${functionList}, [x, ${maximaNumber(options.xMin)}, ${maximaNumber(options.xMax)}], [y, ${maximaNumber(options.yMin!)}, ${maximaNumber(options.yMax!)}], ${parts.join(", ")})$`
        : `plot2d(${functionList}, [x, ${maximaNumber(options.xMin)}, ${maximaNumber(options.xMax)}]${yRange}, ${parts.join(", ")})$`;

    const timeoutMs = Math.min(
      options.timeoutMs ?? config.maxima.defaultTimeoutMs * 2,
      config.maxima.maxTimeoutMs,
    );
    const run = await sessions.run(options.sessionId, [command], {
      timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const output = run.outputs[0]?.output ?? "";

    let stat;
    try {
      stat = statSync(outputPath);
    } catch {
      throw new ToolError({
        code: "PLOT_FAILED",
        message: "Maxima did not produce a plot file.",
        hint: `Ensure gnuplot is installed and Maxima's plot2d works. Maxima output: ${output || "(none)"}`,
      });
    }
    if (stat.size === 0) {
      throw new ToolError({
        code: "PLOT_FAILED",
        message: "Maxima produced an empty plot file.",
        hint: output || undefined,
      });
    }
    if (stat.size > config.limits.maxPlotBytes) {
      throw new ToolError({
        code: "LIMIT_EXCEEDED",
        message: `Plot file is ${stat.size} bytes, exceeding the limit of ${config.limits.maxPlotBytes}.`,
        hint: "Reduce the plot dimensions or raise MAXIMA_MCP_MAX_PLOT_BYTES.",
      });
    }

    const data = readFileSync(outputPath);
    const mimeType = format === "svg" ? "image/svg+xml" : "image/png";
    if (format === "png" && !(data[0] === 0x89 && data.subarray(1, 4).toString() === "PNG")) {
      throw new ToolError({
        code: "PLOT_FAILED",
        message: "Generated file is not a valid PNG image.",
        hint: output || "Check the gnuplot installation.",
      });
    }
    if (format === "svg" && !data.toString("utf8", 0, 1000).includes("<svg")) {
      throw new ToolError({
        code: "PLOT_FAILED",
        message: "Generated file is not a valid SVG image.",
        hint: output || "Check the gnuplot installation.",
      });
    }

    return {
      data,
      mimeType,
      format,
      bytes: data.byteLength,
      command,
      output,
      durationMs: run.durationMs,
      sessionId: run.sessionId,
    };
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort.
    }
  }
}

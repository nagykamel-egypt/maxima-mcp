import { z } from "zod";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { renderPlot } from "../maxima/plot.js";
import type { Runtime } from "../runtime.js";
import { guarded, text } from "./helpers.js";

export function registerPlotTools(server: McpServer, runtime: Runtime): void {
  server.registerTool(
    "maxima_plot",
    {
      title: "Plot Maxima expressions",
      description:
        "Render one or more Maxima expressions as a PNG or SVG image using Maxima's gnuplot backend. Supports 2D curves, 3D surfaces, logarithmic axes, labels, titles and custom dimensions.",
      inputSchema: {
        expressions: z
          .array(z.string().min(1))
          .min(1)
          .max(12)
          .describe("Expressions to plot, in terms of x (2D) or x and y (3D)."),
        x_min: z.number().describe("Minimum x value."),
        x_max: z.number().describe("Maximum x value."),
        y_min: z.number().optional().describe("Minimum y value (required for 3D plots)."),
        y_max: z.number().optional().describe("Maximum y value (required for 3D plots)."),
        kind: z.enum(["2d", "3d"]).default("2d").describe("Plot type."),
        format: z.enum(["png", "svg"]).default("png").describe("Image format."),
        title: z.string().max(500).optional().describe("Plot title."),
        xlabel: z.string().max(200).optional().describe("X axis label."),
        ylabel: z.string().max(200).optional().describe("Y axis label."),
        width: z.number().int().min(100).max(4000).default(900).describe("Image width in pixels."),
        height: z
          .number()
          .int()
          .min(100)
          .max(4000)
          .default(600)
          .describe("Image height in pixels."),
        log_x: z.boolean().default(false).describe("Use a logarithmic x axis."),
        log_y: z.boolean().default(false).describe("Use a logarithmic y axis."),
        grid: z.boolean().default(true).describe("Draw a grid."),
        legend: z.boolean().default(true).describe("Show the legend."),
        session_id: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .describe(
            "Session whose definitions may be used by the plotted expressions; defaults to the default session.",
          ),
        timeout_ms: z
          .number()
          .int()
          .min(100)
          .max(runtime.config.maxima.maxTimeoutMs)
          .optional()
          .describe("Rendering timeout in milliseconds."),
      },
      annotations: {
        title: "Plot Maxima expressions",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      outputSchema: z.object({
        format: z.string(),
        mime_type: z.string(),
        bytes: z.number(),
        duration_ms: z.number(),
        session_id: z.string(),
        command: z.string(),
        output: z.string(),
      }),
    },
    async (args, ctx): Promise<CallToolResult> =>
      guarded(runtime, "maxima_plot", async () => {
        const result = await renderPlot(runtime.config, runtime.sessions, {
          expressions: args.expressions,
          xMin: args.x_min,
          xMax: args.x_max,
          ...(args.y_min === undefined ? {} : { yMin: args.y_min }),
          ...(args.y_max === undefined ? {} : { yMax: args.y_max }),
          kind: args.kind,
          format: args.format,
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.xlabel === undefined ? {} : { xlabel: args.xlabel }),
          ...(args.ylabel === undefined ? {} : { ylabel: args.ylabel }),
          width: args.width,
          height: args.height,
          logX: args.log_x,
          logY: args.log_y,
          grid: args.grid,
          legend: args.legend,
          ...(args.session_id === undefined ? {} : { sessionId: args.session_id }),
          ...(args.timeout_ms === undefined ? {} : { timeoutMs: args.timeout_ms }),
          ...(ctx.mcpReq.signal ? { signal: ctx.mcpReq.signal } : {}),
        });
        const summary = `Rendered ${args.kind.toUpperCase()} plot as ${result.format.toUpperCase()} (${args.width}×${args.height}), ${(result.bytes / 1024).toFixed(1)} KiB in ${result.durationMs} ms.`;
        const notes = result.output.trim() ? `\n\nMaxima output:\n${result.output.trim()}` : "";
        return {
          content: [
            text(`${summary}${notes}`),
            {
              type: "image",
              data: result.data.toString("base64"),
              mimeType: result.mimeType,
            },
          ],
          structuredContent: {
            format: result.format,
            mime_type: result.mimeType,
            bytes: result.bytes,
            duration_ms: result.durationMs,
            session_id: result.sessionId,
            command: result.command,
            output: result.output,
          },
        };
      }),
  );
}

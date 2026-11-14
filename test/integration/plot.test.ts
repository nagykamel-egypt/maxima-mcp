import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderPlot } from "../../src/maxima/plot.js";
import { hasGnuplot, hasMaxima, createTestRuntime, type TestRuntime } from "../helpers.js";

const available = hasMaxima() && hasGnuplot();

describe.skipIf(!available)("Plot integration", () => {
  let harness: TestRuntime;

  beforeAll(() => {
    harness = createTestRuntime();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("renders a PNG plot", async () => {
    const result = await renderPlot(harness.config, harness.runtime.sessions, {
      expressions: ["sin(x)"],
      xMin: -6,
      xMax: 6,
      format: "png",
      width: 400,
      height: 300,
    });
    expect(result.mimeType).toBe("image/png");
    expect(result.data.subarray(1, 4).toString()).toBe("PNG");
    expect(result.bytes).toBeGreaterThan(1000);
    expect(result.sessionId).toBe("default");
  });

  it("renders an SVG plot with labels", async () => {
    const result = await renderPlot(harness.config, harness.runtime.sessions, {
      expressions: ["x^2", "x^3"],
      xMin: -2,
      xMax: 2,
      format: "svg",
      title: "Powers",
      xlabel: "x",
      ylabel: "y",
      logY: false,
    });
    expect(result.mimeType).toBe("image/svg+xml");
    expect(result.data.toString("utf8", 0, 1000)).toContain("<svg");
  });

  it("passes an explicit y range to plot2d", async () => {
    const result = await renderPlot(harness.config, harness.runtime.sessions, {
      expressions: ["x^2/sin(x)"],
      xMin: -2 * Math.PI,
      xMax: 2 * Math.PI,
      yMin: -20,
      yMax: 20,
      format: "png",
    });
    expect(result.command).toContain("[y, -20, 20]");
    expect(result.bytes).toBeGreaterThan(1000);
  });

  it("renders a 3D surface", async () => {
    const result = await renderPlot(harness.config, harness.runtime.sessions, {
      expressions: ["x^2+y^2"],
      kind: "3d",
      xMin: -2,
      xMax: 2,
      yMin: -2,
      yMax: 2,
      width: 300,
      height: 300,
    });
    expect(result.bytes).toBeGreaterThan(1000);
  });

  it("validates ranges and formats", async () => {
    await expect(
      renderPlot(harness.config, harness.runtime.sessions, {
        expressions: ["x"],
        xMin: 1,
        xMax: 0,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      renderPlot(harness.config, harness.runtime.sessions, {
        expressions: ["x"],
        xMin: 0,
        xMax: 1,
        kind: "3d",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

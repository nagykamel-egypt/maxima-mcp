import { describe, expect, it } from "vitest";
import { Metrics } from "../../src/metrics.js";

describe("Metrics", () => {
  it("accumulates counters by label set", () => {
    const metrics = new Metrics();
    metrics.describe("foo_total", "Foo counter");
    metrics.inc("foo_total", { bar: "x" });
    metrics.inc("foo_total", { bar: "x" }, 2);
    metrics.inc("foo_total", { bar: "y" });
    const snap = metrics.snapshot();
    expect(snap.counters['foo_total{bar="x"}']).toBe(3);
    expect(snap.counters['foo_total{bar="y"}']).toBe(1);
  });

  it("accumulates duration observations into sum/count pairs", () => {
    const metrics = new Metrics();
    metrics.observeMs("foo_duration", 10, { bar: "x" });
    metrics.observeMs("foo_duration", 20, { bar: "x" });
    const snap = metrics.snapshot();
    expect(snap.counters['foo_duration_milliseconds_sum{bar="x"}']).toBe(30);
    expect(snap.counters['foo_duration_milliseconds_count{bar="x"}']).toBe(2);
  });

  it("tracks gauges by last value written", () => {
    const metrics = new Metrics();
    metrics.gauge("foo_gauge", 5);
    metrics.gauge("foo_gauge", 7);
    expect(metrics.snapshot().gauges["foo_gauge{}"]).toBe(7);
  });

  it("renders Prometheus text with HELP, TYPE and sample lines", () => {
    const metrics = new Metrics();
    metrics.describe("foo_total", "Foo counter");
    metrics.describe("foo_gauge", "Foo gauge");
    metrics.inc("foo_total", { bar: "x" });
    metrics.gauge("foo_gauge", 5, { bar: "y" });
    const text = metrics.render();
    expect(text).toContain("# HELP foo_total Foo counter");
    expect(text).toContain("# TYPE foo_total counter");
    expect(text).toMatch(/^foo_total\{bar="x"\} 1$/m);
    expect(text).toContain("# TYPE foo_gauge gauge");
    expect(text).toContain('foo_gauge{bar="y"} 5');
    expect(text).toContain("# HELP maxima_mcp_uptime_seconds");
  });

  it("escapes help text backslashes and newlines", () => {
    const metrics = new Metrics();
    metrics.describe("foo_total", "line1\nline2 \\ literal");
    metrics.inc("foo_total");
    expect(metrics.render()).toContain("# HELP foo_total line1\\nline2 \\\\ literal");
  });

  it("renders a counter without HELP when not described", () => {
    const metrics = new Metrics();
    metrics.inc("undescribed_total");
    const text = metrics.render();
    expect(text).toContain("# TYPE undescribed_total counter");
    expect(text).not.toContain("# HELP undescribed_total");
  });
});

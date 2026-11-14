import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasMaxima, createTestRuntime, type TestRuntime } from "../helpers.js";

const available = hasMaxima();

describe.skipIf(!available)("Maxima process integration", () => {
  let harness: TestRuntime;

  beforeAll(() => {
    harness = createTestRuntime({ MAXIMA_MCP_MAX_SESSIONS: "4" });
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("evaluates expressions and preserve state", async () => {
    const first = await harness.runtime.sessions.run(undefined, ["2+2;"]);
    expect(first.outputs[0]?.output).toBe("4");
    expect(first.outputs[0]?.isError).toBe(false);

    const state = await harness.runtime.sessions.run(undefined, ["a: 5$", "a^2;"]);
    expect(state.outputs[0]?.output).toBe("");
    expect(state.outputs[1]?.output).toBe("25");
  });

  it("segments batch output per command", async () => {
    const result = await harness.runtime.sessions.run(undefined, [
      "b: 7$",
      "b+1;",
      "expand((b+1)^2);",
    ]);
    expect(result.outputs.map((item) => item.output)).toEqual(["", "8", "64"]);
  });

  it("classifies Maxima errors and syntax errors", async () => {
    const division = await harness.runtime.sessions.run(undefined, ["1/0;"]);
    expect(division.outputs[0]?.isError).toBe(true);
    expect(division.outputs[0]?.output).toContain("an error");

    const syntax = await harness.runtime.sessions.run(undefined, ["1 +;"]);
    expect(syntax.outputs[0]?.isError).toBe(true);

    const valid = await harness.runtime.sessions.run(undefined, ["integrate(x^2, x);"]);
    expect(valid.outputs[0]?.isError).toBe(false);
    expect(valid.outputs[0]?.output).toBe("x^3/3");
  });

  it("isolates session state", async () => {
    await harness.runtime.sessions.run("one", ["x: 11$"], { timeoutMs: 10_000 });
    const other = await harness.runtime.sessions.run("two", ["x;"]);
    expect(other.outputs[0]?.output).toBe("x");

    const same = await harness.runtime.sessions.run("one", ["x;"]);
    expect(same.outputs[0]?.output).toBe("11");
  });

  it("resets a session and discards state", async () => {
    await harness.runtime.sessions.run("reset-me", ["y: 99$"]);
    const info = await harness.runtime.sessions.reset("reset-me");
    expect(info.id).toBe("reset-me");
    const after = await harness.runtime.sessions.run("reset-me", ["y;"]);
    expect(after.outputs[0]?.output).toBe("y");
  });

  it("recovers after a timeout by restarting the process", async () => {
    const started = Date.now();
    await expect(
      harness.runtime.sessions.run(undefined, ["for i:1 thru 100000000 do i$"], {
        timeoutMs: 300,
      }),
    ).rejects.toMatchObject({ code: "MAXIMA_TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(10_000);

    const after = await harness.runtime.sessions.run(undefined, ["1+1;"]);
    expect(after.outputs[0]?.output).toBe("2");
    expect(after.restarted).toBe(true);
  });

  it("supports cancellation through an AbortSignal", async () => {
    const controller = new AbortController();
    const pending = harness.runtime.sessions.run(undefined, ["for i:1 thru 100000000 do i$"], {
      timeoutMs: 30_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 200);
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });

    const after = await harness.runtime.sessions.run(undefined, ["2+2;"]);
    expect(after.outputs[0]?.output).toBe("4");
  });

  it("closes and recreates sessions", async () => {
    await harness.runtime.sessions.run("temporary", ["z: 1$"]);
    expect(await harness.runtime.sessions.close("temporary")).toBe(true);
    expect(harness.runtime.sessions.list().some((session) => session.id === "temporary")).toBe(
      false,
    );
    expect(await harness.runtime.sessions.close("temporary")).toBe(false);
  });
});

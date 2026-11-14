import { describe, expect, it } from "vitest";
import { parseVmRssBytes } from "../../src/maxima/process.js";

describe("parseVmRssBytes", () => {
  it("extracts RSS in bytes from /proc status text", () => {
    const status = [
      "Name:\tmaxima",
      "Umask:\t0022",
      "VmPeak:\t  100000 kB",
      "VmRSS:\t   20480 kB",
      "State:\tR (running)",
    ].join("\n");
    expect(parseVmRssBytes(status)).toBe(20480 * 1024);
  });

  it("returns undefined when VmRSS is absent", () => {
    expect(parseVmRssBytes("Name:\tmaxima\nState:\tR (running)\n")).toBeUndefined();
  });

  it("returns undefined for malformed values", () => {
    expect(parseVmRssBytes("VmRSS:\tnotanumber kB")).toBeUndefined();
  });

  it("returns undefined for non-finite numbers", () => {
    expect(parseVmRssBytes("VmRSS:\tInfinity kB")).toBeUndefined();
  });
});

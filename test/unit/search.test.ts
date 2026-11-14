import { describe, expect, it } from "vitest";
import { SearchIndex, makeSnippet, tokenize } from "../../src/docs/search.js";

function buildIndex(): SearchIndex {
  const index = new SearchIndex();
  index.add({
    type: "symbol",
    id: "integrate",
    name: "integrate",
    title: "integrate",
    section: "Functions and Variables for Integration",
    text: "Attempts to symbolically compute the integral of expr with respect to x.",
    uri: "maxima://docs/symbol/integrate",
  });
  index.add({
    type: "symbol",
    id: "defint",
    name: "defint",
    title: "defint",
    section: "Functions and Variables for Integration",
    text: "Definition of a definite integral by means of limit of a Riemann sum.",
    uri: "maxima://docs/symbol/defint",
  });
  index.add({
    type: "symbol",
    id: "eigenvalues",
    name: "eigenvalues",
    title: "eigenvalues",
    section: "Functions and Variables for Matrices and Linear Algebra",
    text: "Computes the eigenvalues of a matrix and their multiplicities.",
    uri: "maxima://docs/symbol/eigenvalues",
  });
  index.add({
    type: "section",
    id: "Integration.html",
    title: "Integration",
    section: "Integration",
    text: "Maxima has several routines for handling integration and definite integrals.",
    uri: "maxima://docs/section/Integration.html",
  });
  return index;
}

describe("tokenize", () => {
  it("normalises case and keeps Maxima symbols", () => {
    expect(tokenize("Definite %pi + x_1")).toEqual(["definite", "%pi", "+", "x_1"]);
  });
});

describe("SearchIndex", () => {
  it("ranks exact symbol names first", () => {
    const results = buildIndex().search("integrate");
    expect(results[0]?.name).toBe("integrate");
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it("supports prefix expansion", () => {
    const results = buildIndex().search("integr");
    expect(results.some((hit) => hit.name === "integrate")).toBe(true);
  });

  it("filters by document type", () => {
    const results = buildIndex().search("integration", { type: "section" });
    expect(results).toHaveLength(1);
    expect(results[0]?.type).toBe("section");
  });

  it("returns an empty list for empty or unknown queries", () => {
    expect(buildIndex().search("")).toEqual([]);
    expect(buildIndex().search("zzzzz")).toEqual([]);
  });

  it("provides snippets around matches", () => {
    const results = buildIndex().search("Riemann");
    expect(results[0]?.name).toBe("defint");
    expect(results[0]?.snippet).toContain("Riemann");
  });
});

describe("makeSnippet", () => {
  it("shortens long text around the earliest token", () => {
    const snippet = makeSnippet(`${"a ".repeat(100)}needle ${"b ".repeat(100)}`, ["needle"], 40);
    expect(snippet).toContain("needle");
    expect(snippet.length).toBeLessThan(60);
  });
});

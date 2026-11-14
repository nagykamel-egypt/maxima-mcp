import { describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { FixedWindowRateLimiter } from "../../src/utils/ratelimit.js";

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string | number>;
  setHeader(name: string, value: string | number): void;
  status(code: number): FakeResponse;
  json(body: unknown): void;
}

function makeRes(): FakeResponse {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json() {
      // no-op
    },
  };
}

function makeReq(ip: string): Request {
  return { ip } as unknown as Request;
}

const noopNext = (() => {}) as unknown as NextFunction;

describe("FixedWindowRateLimiter", () => {
  it("allows requests up to the limit, then rejects", () => {
    const now = 0;
    const limiter = new FixedWindowRateLimiter(2, 60_000, () => now);
    const req = makeReq("1.2.3.4");
    let nextCalls = 0;
    const next = (() => {
      nextCalls += 1;
    }) as unknown as NextFunction;

    const first = makeRes();
    limiter.middleware(req, first as unknown as Response, next);
    expect(first.statusCode).toBe(200);

    const second = makeRes();
    limiter.middleware(req, second as unknown as Response, next);
    expect(second.statusCode).toBe(200);
    expect(nextCalls).toBe(2);

    const third = makeRes();
    limiter.middleware(req, third as unknown as Response, next);
    expect(third.statusCode).toBe(429);
    expect(third.headers["Retry-After"]).toBeDefined();
    expect(nextCalls).toBe(2);

    limiter.dispose();
  });

  it("resets once the window elapses", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(1, 60_000, () => now);
    const req = makeReq("1.2.3.4");

    expect(makeRes().statusCode).toBe(200);
    const allowed = makeRes();
    limiter.middleware(req, allowed as unknown as Response, noopNext);
    expect(allowed.statusCode).toBe(200);

    const blocked = makeRes();
    limiter.middleware(req, blocked as unknown as Response, noopNext);
    expect(blocked.statusCode).toBe(429);

    now = 61_000;
    const allowedAgain = makeRes();
    limiter.middleware(req, allowedAgain as unknown as Response, noopNext);
    expect(allowedAgain.statusCode).toBe(200);

    limiter.dispose();
  });

  it("sweeps expired buckets", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(10, 60_000, () => now);
    limiter.middleware(makeReq("1.1.1.1"), makeRes() as unknown as Response, noopNext);
    limiter.middleware(makeReq("2.2.2.2"), makeRes() as unknown as Response, noopNext);
    now = 120_000;
    expect(limiter.sweep()).toBe(2);
    expect(limiter.sweep()).toBe(0);
    limiter.dispose();
  });

  it("disables enforcement when the limit is zero", () => {
    const limiter = new FixedWindowRateLimiter(0, 60_000, () => 0);
    let nextCalls = 0;
    const next = (() => {
      nextCalls += 1;
    }) as unknown as NextFunction;
    for (let i = 0; i < 100; i += 1) {
      limiter.middleware(makeReq("1.2.3.4"), makeRes() as unknown as Response, next);
    }
    expect(nextCalls).toBe(100);
    limiter.dispose();
  });
});

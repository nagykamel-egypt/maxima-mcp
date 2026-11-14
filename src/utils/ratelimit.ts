import type { NextFunction, Request, Response } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window rate limiter keyed by client IP. Expired buckets are removed by
 * a periodic sweep (bounded memory) with an inline threshold-triggered cleanup
 * retained as a secondary guard against a burst of distinct clients.
 */
export class FixedWindowRateLimiter {
  private readonly hits = new Map<string, Bucket>();
  private readonly sweeper?: NodeJS.Timeout;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (this.limit > 0) {
      const intervalMs = Math.max(1_000, Math.min(windowMs, 60_000));
      this.sweeper = setInterval(() => this.sweep(), intervalMs);
      this.sweeper.unref?.();
    }
  }

  /** Remove expired buckets; returns the number removed. */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, bucket] of this.hits) {
      if (bucket.resetAt <= now) {
        this.hits.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** Stop the background sweeper. Safe to call multiple times. */
  dispose(): void {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  middleware = (req: Request, res: Response, next: NextFunction): void => {
    if (this.limit <= 0) {
      next();
      return;
    }
    const now = this.now();
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    let bucket = this.hits.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > this.limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Rate limit exceeded. Retry later." },
        id: null,
      });
      return;
    }
    if (this.hits.size > 20_000) {
      for (const [entryKey, entry] of this.hits) {
        if (entry.resetAt <= now) this.hits.delete(entryKey);
      }
    }
    next();
  };
}

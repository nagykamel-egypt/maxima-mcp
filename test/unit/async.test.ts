import { describe, expect, it } from "vitest";
import {
  Deferred,
  Mutex,
  Semaphore,
  clamp,
  delay,
  writeChunked,
  type ChunkedWritable,
} from "../../src/utils/async.js";

describe("Deferred", () => {
  it("resolves", async () => {
    const deferred = new Deferred<number>();
    deferred.resolve(42);
    await expect(deferred.promise).resolves.toBe(42);
  });

  it("rejects", async () => {
    const deferred = new Deferred<number>();
    deferred.reject(new Error("boom"));
    await expect(deferred.promise).rejects.toThrow("boom");
  });
});

describe("Mutex", () => {
  it("serializes runExclusive calls in FIFO order", async () => {
    const mutex = new Mutex();
    const order: number[] = [];
    const results = await Promise.all([
      mutex.runExclusive(async () => {
        await delay(10);
        order.push(1);
        return "a";
      }),
      mutex.runExclusive(async () => {
        order.push(2);
        return "b";
      }),
      mutex.runExclusive(async () => {
        order.push(3);
        return "c";
      }),
    ]);
    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual(["a", "b", "c"]);
  });

  it("releases the lock when the body throws", async () => {
    const mutex = new Mutex();
    await expect(
      mutex.runExclusive(async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    // A subsequent acquisition must succeed, proving the lock was released.
    await expect(mutex.runExclusive(async () => "ok")).resolves.toBe("ok");
  });
});

describe("Semaphore", () => {
  it("rejects a zero limit", () => {
    expect(() => new Semaphore(0)).toThrow();
  });

  it("bounds concurrency to the configured limit", async () => {
    const semaphore = new Semaphore(2);
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 6 }, () =>
      semaphore.runExclusive(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(10);
        active -= 1;
      }),
    );
    await Promise.all(tasks);
    expect(maxActive).toBe(2);
    expect(active).toBe(0);
  });
});

describe("delay", () => {
  it("resolves after the given time", async () => {
    const started = Date.now();
    await delay(15);
    expect(Date.now() - started).toBeGreaterThanOrEqual(10);
  });
});

describe("clamp", () => {
  it("clamps values into the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("writeChunked", () => {
  it("writes the full payload in bounded chunks", async () => {
    const chunks: string[] = [];
    const writable: ChunkedWritable = {
      write(chunk, callback) {
        chunks.push(chunk);
        callback?.();
        return true;
      },
    };
    await writeChunked(writable, "abcdefgh", 3);
    expect(chunks).toEqual(["abc", "def", "gh"]);
  });

  it("handles an empty payload without writing", async () => {
    let calls = 0;
    const writable: ChunkedWritable = {
      write(_chunk, callback) {
        calls += 1;
        callback?.();
        return true;
      },
    };
    await writeChunked(writable, "", 3);
    expect(calls).toBe(0);
  });

  it("rejects on a write error", async () => {
    const writable: ChunkedWritable = {
      write(_chunk, callback) {
        callback?.(new Error("EPIPE"));
        return false;
      },
    };
    await expect(writeChunked(writable, "abc", 3)).rejects.toThrow("EPIPE");
  });
});

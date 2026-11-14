export class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason?: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

/** A promise-based FIFO mutex. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(
      () => next,
      () => next,
    );
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Counting semaphore used to bound expensive operations. */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    if (limit < 1) throw new Error("Semaphore limit must be at least 1");
    this.available = limit;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return this.makeRelease();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    return this.makeRelease();
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.available += 1;
    };
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Minimal structural interface for a writable stream, so the chunked writer can
 * be unit-tested without a real child process.
 */
export interface ChunkedWritable {
  write(chunk: string, callback?: (error?: Error | null) => void): unknown;
}

/**
 * Write a string to a writable stream in bounded chunks, awaiting each chunk's
 * flush so that backpressure is respected and a single large payload is never
 * buffered wholesale. Rejects on the first write error.
 */
export async function writeChunked(
  writable: ChunkedWritable,
  data: string,
  chunkSize = 256 * 1024,
): Promise<void> {
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.slice(offset, offset + chunkSize);
    await new Promise<void>((resolve, reject) => {
      writable.write(chunk, (error) => (error ? reject(error) : resolve()));
    });
  }
}

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolError, asError } from "../errors.js";
import type { Logger } from "../logger.js";
import { Mutex, writeChunked } from "../utils/async.js";
import { cleanOutput } from "./output.js";

export interface MaximaProcessOptions {
  bin: string;
  extraArgs?: string[];
  initCommands?: string[];
  logger: Logger;
  defaultTimeoutMs?: number;
  maxOutputBytes?: number;
  /** Maximum characters retained per command in the returned result. */
  maxOutputChars?: number;
  /** Persistent Maxima userdir for compiled package caches. */
  userDir?: string;
  /** Optional label used in log messages (e.g. session id). */
  label?: string;
  /** Per-process RSS ceiling in bytes; 0 disables the memory watchdog. */
  maxMemoryBytes?: number;
}

export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
}

export interface CommandOutput {
  command: string;
  output: string;
  isError: boolean;
  warnings: string[];
  durationMs: number;
}

export interface MaximaRunResult {
  outputs: CommandOutput[];
  stdout: string;
  stderr: string;
  durationMs: number;
  restarted: boolean;
}

interface PendingRequest {
  endMarker: string;
  resolve: (raw: string) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
  maxOutputBytes: number;
  removeAbort?: () => void;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

/**
 * Extract the resident set size in bytes from Linux `/proc/<pid>/status` text.
 * Returns undefined when the field is absent or unparseable.
 */
export function parseVmRssBytes(statusText: string): number | undefined {
  const match = statusText.match(/^VmRSS:\s+(\d+)\s+kB/m);
  if (!match) return undefined;
  const kib = Number(match[1]);
  return Number.isFinite(kib) ? kib * 1024 : undefined;
}

/** Read the current RSS of a process, or undefined when unavailable (non-Linux). */
function readVmRssBytes(pid: number): number | undefined {
  if (process.platform !== "linux" || !Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    return parseVmRssBytes(readFileSync(`/proc/${pid}/status`, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Build a minimal environment for the Maxima child process. Secrets from the
 * MCP server process (bearer tokens, cloud credentials) must never be readable
 * by Maxima expressions.
 */
export function childEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "LC_CTYPE",
    "DISPLAY",
  ];
  const env: NodeJS.ProcessEnv = {
    TERM: "dumb",
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
  };
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * A persistent, crash-resilient Maxima REPL process.
 *
 * Commands are framed with random sentinels written by Maxima's `print`, which
 * allows reliable extraction of results even when expressions emit warnings or
 * errors. Requests are serialized with a mutex; timeouts and cancellation
 * terminate the process so a hung evaluation cannot poison later calls.
 */
export class MaximaProcess {
  private readonly options: Required<
    Pick<
      MaximaProcessOptions,
      "bin" | "defaultTimeoutMs" | "maxOutputBytes" | "maxOutputChars" | "maxMemoryBytes"
    >
  > &
    MaximaProcessOptions;
  private readonly mutex = new Mutex();
  private child?: ChildProcessWithoutNullStreams;
  private buffer = "";
  private stderrBuffer = "";
  private pending?: PendingRequest;
  private memoryWatchdog?: NodeJS.Timeout;
  private disposed = false;
  private startTime = 0;
  private restartCount = 0;
  private workDir?: string;
  private userDir?: string;
  private ownsUserDir = false;

  constructor(options: MaximaProcessOptions) {
    this.options = {
      defaultTimeoutMs: 30_000,
      maxOutputBytes: 1_000_000,
      maxOutputChars: 200_000,
      maxMemoryBytes: 0,
      ...options,
    };
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get alive(): boolean {
    return Boolean(this.child && this.child.exitCode === null && this.child.signalCode === null);
  }

  get uptimeMs(): number {
    return this.startTime === 0 ? 0 : Date.now() - this.startTime;
  }

  get restarts(): number {
    return this.restartCount;
  }

  private get label(): string {
    return this.options.label ?? "maxima";
  }

  /** Execute commands serially, starting or restarting the process if needed. */
  async run(commands: string[], options: RunOptions = {}): Promise<MaximaRunResult> {
    return this.mutex.runExclusive(async () => {
      if (this.disposed) {
        throw new ToolError({
          code: "SESSION_CLOSED",
          message: "This Maxima session has been closed.",
          hint: "Open a new session with maxima_session_open.",
        });
      }
      const startedAt = Date.now();
      let restarted = false;
      if (!this.alive) {
        await this.startLocked();
        restarted = true;
      }

      try {
        const result = await this.executeLocked(commands, options);
        return {
          ...result,
          durationMs: Date.now() - startedAt,
          restarted,
        };
      } catch (error) {
        if (
          error instanceof ToolError &&
          ["MAXIMA_TIMEOUT", "ABORTED", "LIMIT_EXCEEDED"].includes(error.code)
        ) {
          this.restartCount += 1;
          this.terminate();
        }
        throw error;
      }
    });
  }

  /** Stop the process and remove temporary directories. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.terminate();
    this.cleanupDirs();
  }

  /** Interrupt the process; the next call will start a fresh one. */
  interrupt(): void {
    this.restartCount += 1;
    this.terminate();
  }

  private async startLocked(): Promise<void> {
    if (this.disposed) {
      throw new ToolError({ code: "SESSION_CLOSED", message: "Session is closed." });
    }
    this.cleanupDirs();
    this.workDir = mkdtempSync(join(tmpdir(), "maxima-mcp-"));
    if (this.options.userDir) {
      try {
        mkdirSync(this.options.userDir, { recursive: true });
        this.userDir = this.options.userDir;
        this.ownsUserDir = false;
      } catch (error) {
        this.options.logger.warn(
          { err: error, userDir: this.options.userDir },
          "Configured Maxima userdir is not writable; falling back to a temporary directory",
        );
        this.userDir = mkdtempSync(join(tmpdir(), "maxima-mcp-user-"));
        this.ownsUserDir = true;
      }
    } else {
      this.userDir = mkdtempSync(join(tmpdir(), "maxima-mcp-user-"));
      this.ownsUserDir = true;
    }

    const args = [
      "--very-quiet",
      "--disable-readline",
      `--userdir=${this.userDir}`,
      ...(this.options.extraArgs ?? []),
    ];

    this.options.logger.debug(
      { label: this.label, bin: this.options.bin, args },
      "starting Maxima process",
    );

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.options.bin, args, {
        cwd: this.workDir,
        env: childEnvironment(),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      this.cleanupDirs();
      throw new ToolError({
        code: "MAXIMA_NOT_FOUND",
        message: `Failed to start Maxima executable '${this.options.bin}'.`,
        hint: "Install Maxima and ensure it is on PATH, or set MAXIMA_BIN.",
        cause: error,
      });
    }

    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        const code = errorCode(error);
        reject(
          new ToolError({
            code: code === "ENOENT" ? "MAXIMA_NOT_FOUND" : "MAXIMA_CRASHED",
            message:
              code === "ENOENT"
                ? `Maxima executable not found: ${this.options.bin}`
                : `Failed to launch Maxima: ${error.message}`,
            hint:
              code === "ENOENT"
                ? "Install Maxima (apt-get install maxima) or set MAXIMA_BIN to its absolute path."
                : undefined,
            cause: error,
          }),
        );
      };
      const cleanup = (): void => {
        child.off("spawn", onSpawn);
        child.off("error", onError);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });

    this.child = child;
    this.startTime = Date.now();
    this.buffer = "";
    this.stderrBuffer = "";

    child.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    child.stderr.on("data", (chunk: Buffer) => this.handleStderr(chunk));
    child.on("error", (error) => {
      this.options.logger.warn({ err: error, label: this.label }, "Maxima process error");
      this.failPending(
        new ToolError({
          code: "MAXIMA_CRASHED",
          message: `Maxima process error: ${error.message}`,
          retryable: true,
          cause: error,
        }),
      );
    });
    child.on("exit", (code, signal) => {
      const wasCurrent = this.child === child;
      if (wasCurrent) this.child = undefined;
      this.options.logger.debug(
        { label: this.label, code, signal, wasCurrent },
        "Maxima process exited",
      );
      if (wasCurrent) {
        this.failPending(
          new ToolError({
            code: "MAXIMA_CRASHED",
            message: `Maxima process exited unexpectedly (code=${String(code)}, signal=${String(signal)}).`,
            hint: "The session will be restarted automatically on the next call; previous definitions were lost.",
            retryable: true,
          }),
        );
      }
    });

    const initCommands = this.options.initCommands ?? [];
    const init = [
      // Route Maxima/Lisp error output through stdout so errors stay ordered with results.
      ":lisp (setf *error-output* *standard-output*)",
      "display2d:false$",
      "ratprint:false$",
      "linel:10000$",
      ...initCommands,
    ];
    try {
      const result = await this.executeLocked(init, {
        timeoutMs: Math.min(this.options.defaultTimeoutMs, 30_000),
      });
      for (const output of result.outputs) {
        if (output.isError) {
          throw new ToolError({
            code: "MAXIMA_ERROR",
            message: `Maxima initialization command failed: ${output.output}`,
            hint: "Check MAXIMA_MCP_INIT and Maxima configuration.",
          });
        }
      }
    } catch (error) {
      this.terminate();
      this.cleanupDirs();
      if (error instanceof ToolError) throw error;
      throw new ToolError({
        code: "MAXIMA_CRASHED",
        message: `Failed to initialize Maxima: ${asError(error).message}`,
        cause: error,
      });
    }
  }

  private async executeLocked(
    commands: string[],
    options: RunOptions,
  ): Promise<Omit<MaximaRunResult, "durationMs" | "restarted">> {
    const child = this.child;
    if (!child || !this.alive) {
      throw new ToolError({
        code: "MAXIMA_CRASHED",
        message: "Maxima process is not running.",
        retryable: true,
      });
    }
    if (commands.length === 0) {
      return { outputs: [], stdout: "", stderr: "" };
    }

    const timeoutMs = options.timeoutMs ?? this.options.defaultTimeoutMs;
    const maxOutputBytes = options.maxOutputBytes ?? this.options.maxOutputBytes;
    if (options.signal?.aborted) {
      throw new ToolError({
        code: "ABORTED",
        message: "The request was cancelled before it started.",
        retryable: true,
      });
    }
    const nonce = randomUUID().replace(/-/g, "");
    const endMarker = `<<<MAXIMA_MCP_END:${nonce}:${commands.length - 1}>>>`;

    let script = "";
    commands.forEach((command, index) => {
      script += `print("<<<MAXIMA_MCP_BEGIN:${nonce}:${index}>>>")$\n`;
      script += command.endsWith("\n") ? command : `${command}\n`;
      script += `print("<<<MAXIMA_MCP_END:${nonce}:${index}>>>")$\n`;
    });

    this.buffer = "";
    this.stderrBuffer = "";

    const raw = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failPending(
          new ToolError({
            code: "MAXIMA_TIMEOUT",
            message: `Maxima did not finish within ${timeoutMs} ms.`,
            hint: "Increase timeout_ms, simplify the expression, or split the computation. The session was restarted and previous definitions were lost.",
            retryable: true,
          }),
        );
      }, timeoutMs);
      timer.unref?.();

      const pending: PendingRequest = {
        endMarker,
        resolve,
        reject,
        timer,
        maxOutputBytes,
      };

      if (options.signal) {
        const onAbort = (): void => {
          this.failPending(
            new ToolError({
              code: "ABORTED",
              message: "The request was cancelled.",
              retryable: true,
            }),
          );
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
        pending.removeAbort = () => options.signal?.removeEventListener("abort", onAbort);
      }

      this.pending = pending;
      this.startMemoryWatchdog(child.pid);
      void writeChunked(child.stdin, script).catch((error: unknown) => {
        this.failPending(
          new ToolError({
            code: "MAXIMA_CRASHED",
            message: `Failed to write to Maxima: ${asError(error).message}`,
            retryable: true,
            cause: error,
          }),
        );
      });
    });

    const stderr = this.stderrBuffer.trim();
    this.stderrBuffer = "";
    this.options.logger.trace({ raw, stderr }, "raw Maxima output");

    const outputs = this.parseOutputs(raw, commands, nonce);
    return {
      outputs,
      stdout: outputs.map((output) => output.output).join("\n"),
      stderr,
    };
  }

  private parseOutputs(raw: string, commands: string[], nonce: string): CommandOutput[] {
    const outputs: CommandOutput[] = [];
    let cursor = 0;
    for (let index = 0; index < commands.length; index += 1) {
      const begin = `<<<MAXIMA_MCP_BEGIN:${nonce}:${index}>>>`;
      const end = `<<<MAXIMA_MCP_END:${nonce}:${index}>>>`;
      const beginIndex = raw.indexOf(begin, cursor);
      const endIndex = beginIndex >= 0 ? raw.indexOf(end, beginIndex + begin.length) : -1;
      let segment = "";
      if (beginIndex >= 0 && endIndex >= 0) {
        segment = raw.slice(beginIndex + begin.length, endIndex);
        cursor = endIndex + end.length;
      } else {
        segment = index === 0 ? raw : "";
      }
      const cleaned = cleanOutput(segment, this.options.maxOutputChars);
      outputs.push({
        command: commands[index] ?? "",
        output: cleaned.text,
        isError: cleaned.isError,
        warnings: cleaned.warnings,
        durationMs: 0,
      });
    }
    return outputs;
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    const pending = this.pending;
    if (!pending) {
      if (this.buffer.length > this.options.maxOutputBytes) {
        this.buffer = this.buffer.slice(-this.options.maxOutputBytes);
      }
      return;
    }
    if (this.buffer.length > pending.maxOutputBytes + 65_536) {
      this.failPending(
        new ToolError({
          code: "LIMIT_EXCEEDED",
          message: `Maxima output exceeded the configured limit of ${pending.maxOutputBytes} bytes.`,
          hint: "Reduce output (e.g. use $ to suppress large results), or raise MAXIMA_MCP_MAX_OUTPUT_BYTES.",
        }),
      );
      return;
    }
    const endIndex = this.buffer.indexOf(pending.endMarker);
    if (endIndex >= 0) {
      const end = endIndex + pending.endMarker.length;
      const raw = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      this.pending = undefined;
      this.stopMemoryWatchdog();
      clearTimeout(pending.timer);
      pending.removeAbort?.();
      pending.resolve(raw);
    }
  }

  private handleStderr(chunk: Buffer): void {
    this.stderrBuffer += chunk.toString("utf8");
    if (this.stderrBuffer.length > this.options.maxOutputBytes) {
      this.stderrBuffer = this.stderrBuffer.slice(-this.options.maxOutputBytes);
    }
  }

  private failPending(error: unknown): void {
    const pending = this.pending;
    this.pending = undefined;
    this.buffer = "";
    this.stopMemoryWatchdog();
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.removeAbort?.();
    pending.reject(error);
  }

  /**
   * Poll the child's resident set size while a request is in flight and kill it
   * when it exceeds the configured ceiling. Linux-only; a no-op elsewhere.
   */
  private startMemoryWatchdog(pid: number | undefined): void {
    const limit = this.options.maxMemoryBytes;
    if (limit <= 0 || pid === undefined) return;
    const intervalMs = 200;
    this.memoryWatchdog = setInterval(() => {
      const rss = readVmRssBytes(pid);
      if (rss === undefined) return;
      if (rss > limit) {
        this.options.logger.warn(
          { label: this.label, pid, rssBytes: rss, limitBytes: limit },
          "Maxima process exceeded memory limit; terminating",
        );
        this.failPending(
          new ToolError({
            code: "LIMIT_EXCEEDED",
            message: `Maxima process exceeded the memory limit of ${Math.round(limit / 1024 / 1024)} MiB.`,
            hint: "Simplify the computation or raise MAXIMA_MCP_MAX_MEMORY_MB (0 disables the limit). The session was restarted and previous definitions were lost.",
            retryable: true,
          }),
        );
        this.terminate();
      }
    }, intervalMs);
    this.memoryWatchdog.unref?.();
  }

  private stopMemoryWatchdog(): void {
    if (this.memoryWatchdog) {
      clearInterval(this.memoryWatchdog);
      this.memoryWatchdog = undefined;
    }
  }

  private terminate(): void {
    const child = this.child;
    this.child = undefined;
    this.startTime = 0;
    this.failPending(
      new ToolError({
        code: "MAXIMA_CRASHED",
        message: "Maxima session was terminated.",
        retryable: true,
      }),
    );
    if (!child) return;
    try {
      child.kill("SIGTERM");
    } catch {
      // Ignore: the process may already be gone.
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Ignore.
      }
    }, 1_000);
    timer.unref?.();
  }

  private cleanupDirs(): void {
    for (const dir of [this.workDir, this.ownsUserDir ? this.userDir : undefined]) {
      if (!dir) continue;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup.
      }
    }
    this.workDir = undefined;
    this.userDir = undefined;
    this.ownsUserDir = false;
  }
}

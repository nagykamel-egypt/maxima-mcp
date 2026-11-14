import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { AppConfig } from "../config.js";
import { ToolError } from "../errors.js";
import type { Logger } from "../logger.js";
import type { Metrics } from "../metrics.js";
import {
  MaximaProcess,
  childEnvironment,
  type MaximaRunResult,
  type RunOptions,
} from "./process.js";

export interface SessionInfo {
  id: string;
  name?: string;
  createdAt: string;
  lastUsedAt: string;
  evaluationCount: number;
  alive: boolean;
  pid?: number;
  uptimeMs: number;
  restarts: number;
  busy: boolean;
  isDefault: boolean;
}

export interface SessionEntry {
  id: string;
  name?: string;
  process: MaximaProcess;
  createdAt: number;
  lastUsedAt: number;
  evaluationCount: number;
  busy: number;
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

export class SessionManager {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly metrics: Metrics;
  private readonly reaper: NodeJS.Timeout;
  private shuttingDown = false;

  constructor(config: AppConfig, logger: Logger, metrics: Metrics) {
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
    this.reaper = setInterval(
      () => {
        void this.reapIdle();
      },
      Math.min(60_000, Math.max(10_000, Math.floor(config.maxima.sessionIdleMs / 4))),
    );
    this.reaper.unref?.();
    this.updateGauges();
  }

  get defaultSessionId(): string {
    return this.config.maxima.defaultSession;
  }

  /** Resolve a session, creating it on demand when requested. */
  async resolve(sessionId?: string, meta?: { createIfMissing?: boolean }): Promise<SessionEntry> {
    const id = sessionId?.trim() || this.defaultSessionId;
    if (meta?.createIfMissing) {
      return this.ensure(id);
    }
    return this.get(id);
  }

  get(id: string): SessionEntry {
    const entry = this.sessions.get(id);
    if (!entry) {
      const known = [...this.sessions.keys()].slice(0, 20);
      throw new ToolError({
        code: "SESSION_NOT_FOUND",
        message: `Unknown Maxima session '${id}'.`,
        hint: known.length
          ? `Available sessions: ${known.join(", ")}. Use maxima_session_open to create one.`
          : "Use maxima_session_open to create a session.",
      });
    }
    entry.lastUsedAt = Date.now();
    return entry;
  }

  async ensure(id?: string, name?: string): Promise<SessionEntry> {
    const sessionId = id?.trim() || this.defaultSessionId;
    this.validateId(sessionId);
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }
    if (this.shuttingDown) {
      throw new ToolError({ code: "SESSION_CLOSED", message: "Server is shutting down." });
    }
    if (this.sessions.size >= this.config.maxima.maxSessions) {
      await this.evictOne();
    }
    const process = this.createProcess(sessionId);
    const entry: SessionEntry = {
      id: sessionId,
      ...(name === undefined ? {} : { name }),
      process,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      evaluationCount: 0,
      busy: 0,
    };
    this.sessions.set(sessionId, entry);
    this.logger.info({ session: sessionId, name }, "Maxima session opened");
    this.updateGauges();
    return entry;
  }

  validateId(id: string): void {
    if (!SESSION_ID_PATTERN.test(id)) {
      throw new ToolError({
        code: "VALIDATION_ERROR",
        message: `Invalid session id '${id}'.`,
        hint: "Session ids may contain letters, digits, '_', '.', ':' and '-' (maximum 64 characters).",
      });
    }
  }

  /** Run commands in a session, updating usage metadata and metrics. */
  async run(
    sessionId: string | undefined,
    commands: string[],
    options: RunOptions = {},
  ): Promise<MaximaRunResult & { sessionId: string }> {
    const entry = await this.resolve(sessionId, { createIfMissing: true });
    entry.busy += 1;
    entry.lastUsedAt = Date.now();
    entry.evaluationCount += commands.length;
    const startedAt = Date.now();
    try {
      const result = await entry.process.run(commands, options);
      this.metrics.inc("maxima_mcp_evaluations_total", { status: "ok" });
      this.metrics.observeMs("maxima_mcp_evaluation_duration", Date.now() - startedAt);
      entry.lastUsedAt = Date.now();
      return { ...result, sessionId: entry.id };
    } catch (error) {
      const status =
        error instanceof ToolError
          ? error.code === "MAXIMA_TIMEOUT"
            ? "timeout"
            : error.code === "ABORTED"
              ? "aborted"
              : "error"
          : "error";
      this.metrics.inc("maxima_mcp_evaluations_total", { status });
      this.metrics.observeMs("maxima_mcp_evaluation_duration", Date.now() - startedAt);
      throw error;
    } finally {
      entry.busy = Math.max(0, entry.busy - 1);
      entry.lastUsedAt = Date.now();
      this.updateGauges();
    }
  }

  async close(id: string): Promise<boolean> {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    this.sessions.delete(id);
    await entry.process.dispose();
    this.logger.info({ session: id }, "Maxima session closed");
    this.updateGauges();
    return true;
  }

  async reset(id: string): Promise<SessionInfo> {
    const entry = this.get(id);
    if (entry.busy > 0) {
      throw new ToolError({
        code: "SESSION_BUSY",
        message: `Session '${id}' is currently evaluating a command.`,
        hint: "Wait for the current call to finish or cancel it before resetting.",
        retryable: true,
      });
    }
    entry.process.interrupt();
    await entry.process.dispose();
    entry.process = this.createProcess(id);
    entry.lastUsedAt = Date.now();
    this.logger.info({ session: id }, "Maxima session reset");
    this.updateGauges();
    return this.toInfo(entry);
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((entry) => this.toInfo(entry));
  }

  get size(): number {
    return this.sessions.size;
  }

  toInfo(entry: SessionEntry): SessionInfo {
    return {
      id: entry.id,
      name: entry.name,
      createdAt: new Date(entry.createdAt).toISOString(),
      lastUsedAt: new Date(entry.lastUsedAt).toISOString(),
      evaluationCount: entry.evaluationCount,
      alive: entry.process.alive,
      pid: entry.process.pid,
      uptimeMs: entry.process.uptimeMs,
      restarts: entry.process.restarts,
      busy: entry.busy > 0,
      isDefault: entry.id === this.defaultSessionId,
    };
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    clearInterval(this.reaper);
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(entries.map((entry) => entry.process.dispose()));
    this.updateGauges();
  }

  async reapIdle(): Promise<void> {
    if (this.shuttingDown) return;
    const now = Date.now();
    for (const entry of [...this.sessions.values()]) {
      if (entry.busy > 0) continue;
      if (now - entry.lastUsedAt < this.config.maxima.sessionIdleMs) continue;
      this.sessions.delete(entry.id);
      await entry.process.dispose();
      this.logger.info({ session: entry.id }, "Idle Maxima session expired");
    }
    this.updateGauges();
  }

  private async evictOne(): Promise<void> {
    const candidates = [...this.sessions.values()]
      .filter((entry) => entry.busy === 0)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const victim = candidates[0];
    if (!victim) {
      throw new ToolError({
        code: "SESSION_LIMIT",
        message: `Maximum number of sessions (${this.config.maxima.maxSessions}) reached and all are busy.`,
        hint: "Close a session with maxima_session_close or raise MAXIMA_MCP_MAX_SESSIONS.",
        retryable: true,
      });
    }
    this.sessions.delete(victim.id);
    this.logger.info({ session: victim.id }, "Evicting least-recently-used Maxima session");
    await victim.process.dispose();
    this.updateGauges();
  }

  private createProcess(id: string): MaximaProcess {
    return new MaximaProcess({
      bin: this.config.maxima.bin,
      extraArgs: this.config.maxima.extraArgs,
      initCommands: this.config.maxima.initCommands,
      logger: this.logger.child({ session: id }),
      defaultTimeoutMs: this.config.maxima.defaultTimeoutMs,
      maxOutputBytes: this.config.maxima.maxOutputBytes,
      maxOutputChars: this.config.limits.maxOutputChars,
      maxMemoryBytes: this.config.maxima.maxMemoryMb * 1024 * 1024,
      userDir: this.config.maxima.userDir,
      label: id,
    });
  }

  private updateGauges(): void {
    this.metrics.gauge("maxima_mcp_sessions", this.sessions.size);
    this.metrics.gauge(
      "maxima_mcp_sessions_busy",
      [...this.sessions.values()].filter((entry) => entry.busy > 0).length,
    );
  }
}

export interface MaximaVersionInfo {
  raw: string;
  version?: string;
  available: boolean;
}

let cachedVersion: { bin: string; info: MaximaVersionInfo } | undefined;

/** Query `maxima --version` with a short timeout and cache the result. */
export function getMaximaVersion(bin: string): MaximaVersionInfo {
  if (cachedVersion?.bin === bin) return cachedVersion.info;
  const result = spawnSync(bin, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    env: childEnvironment(),
  });
  const raw = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const match =
    raw.match(/Maxima\s+([0-9][0-9A-Za-z.\-+]*)/i) ?? raw.match(/^([0-9][0-9A-Za-z.\-+]*)$/m);
  const info: MaximaVersionInfo = {
    raw: raw || "unavailable",
    version: match?.[1],
    available: result.status === 0 || Boolean(match),
  };
  cachedVersion = { bin, info };
  return info;
}

export function newSessionId(): string {
  return `ms_${randomBytes(6).toString("hex")}`;
}

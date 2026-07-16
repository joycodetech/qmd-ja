import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CollectionConfig } from "./collections.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type ConfiguredLogLevel = LogLevel | "off";

const DEFAULT_LOG_LEVEL: ConfiguredLogLevel = "info";
const LEVEL_PRIORITY: Record<ConfiguredLogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const LOG_PATH = process.env.XDG_CACHE_HOME
  ? join(process.env.XDG_CACHE_HOME, "qmd", "logs", "query.log")
  : join(homedir(), ".cache", "qmd", "logs", "query.log");

let configuredLevel: ConfiguredLogLevel = DEFAULT_LOG_LEVEL;
let stream: WriteStream | undefined;
let streamFailed = false;

try {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  stream = createWriteStream(LOG_PATH, { flags: "a" });
  stream.on("error", (error) => {
    streamFailed = true;
    console.error(`QMD query logger failed: ${error instanceof Error ? error.message : String(error)}`);
  });
} catch {
  streamFailed = true;
  // Initialization failures must not affect CLI/MCP output or query processing.
}

export function initLogger(config?: CollectionConfig): void {
  const level = config?.logLevel ?? process.env.QMD_LOG_LEVEL ?? DEFAULT_LOG_LEVEL;
  configuredLevel = Object.hasOwn(LEVEL_PRIORITY, level)
    ? level as ConfiguredLogLevel
    : DEFAULT_LOG_LEVEL;
}

export function newCallId(): string {
  return randomUUID().slice(0, 8);
}

export function logQueryEvent(
  callId: string,
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (LEVEL_PRIORITY[level] > LEVEL_PRIORITY[configuredLevel]) return;
  if (configuredLevel === "off" || !stream || streamFailed) return;

  try {
    stream.write(`${JSON.stringify({
      ...fields,
      ts: new Date().toISOString(),
      pid: process.pid,
      callId,
      level,
      event,
    })}\n`);
  } catch {
    // Logging must never affect query processing.
  }
}

export const QUERY_LOG_PATH = LOG_PATH;

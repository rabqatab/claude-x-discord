/**
 * Lightweight tagged logger for distinguishing logs across
 * multiple bot instances and concurrent topic processing.
 *
 * Format: [tag|instance:project] message
 * Example: [claude|spark:my-app] spawn bridge: prompt="..." cwd=...
 *
 * File logging: call initFileLogging() once at startup.
 * Intercepts ALL console.log/error/warn so even direct console.log
 * calls (e.g. from ClaudeProcess) get written to log files.
 * Logs are written to logs/{instance}-{YYYY-MM-DD}.log with daily rotation.
 */

import { mkdirSync, createWriteStream, type WriteStream } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOGS_DIR = resolve(__dirname, "../logs");

let logStream: WriteStream | null = null;
let currentDate = "";
let _instance = "";

function getDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function getTimestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function ensureStream(): void {
  const today = getDateString();
  if (today !== currentDate) {
    logStream?.end();
    currentDate = today;
    const logFile = resolve(LOGS_DIR, `${_instance}-${today}.log`);
    logStream = createWriteStream(logFile, { flags: "a" });
    logStream.on("error", () => { /* ignore write errors */ });
  }
}

function writeToFile(line: string): void {
  if (!logStream) return;
  ensureStream();
  logStream!.write(`${getTimestamp()} ${line}\n`);
}

// Store originals before patching
const _origLog = console.log.bind(console);
const _origError = console.error.bind(console);
const _origWarn = console.warn.bind(console);

/**
 * Initialize file logging. Call once at startup.
 * Patches console.log/error/warn to also write to log files.
 */
export function initFileLogging(instance: string): void {
  _instance = instance;
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
  } catch { /* already exists */ }
  ensureStream();

  // Patch console methods to tee into log file
  console.log = (...args: unknown[]) => {
    _origLog(...args);
    writeToFile(format(...args));
  };
  console.error = (...args: unknown[]) => {
    _origError(...args);
    writeToFile(`ERROR ${format(...args)}`);
  };
  console.warn = (...args: unknown[]) => {
    _origWarn(...args);
    writeToFile(`WARN ${format(...args)}`);
  };

  _origLog(`[logger] file logging → ${LOGS_DIR}/${instance}-${getDateString()}.log`);
}

export interface Logger {
  log(tag: string, msg: string): void;
  error(tag: string, msg: string): void;
  warn(tag: string, msg: string): void;
}

export function createLogger(instance: string, project?: string): Logger {
  const prefix = project ? `${instance}:${project}` : instance;

  return {
    log(tag: string, msg: string) {
      console.log(`[${tag}|${prefix}] ${msg}`);
    },
    error(tag: string, msg: string) {
      console.error(`[${tag}|${prefix}] ${msg}`);
    },
    warn(tag: string, msg: string) {
      console.warn(`[${tag}|${prefix}] ${msg}`);
    },
  };
}

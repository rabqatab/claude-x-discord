import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { parseStreamChunk, parseJsonStreamChunk, type StreamChunk } from "./parser.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BRIDGE_SCRIPT = resolve(__dirname, "../scripts/claude-bridge.py");

export interface ClaudeProcessOptions {
  cwd: string;
  sessionId?: string;
  verbose?: boolean;
  env?: Record<string, string>;
  /** Log prefix for identifying instance + project, e.g. "spark:my-app" */
  label?: string;
}

export class ClaudeProcess extends EventEmitter {
  private proc: ChildProcess | null = null;
  private buffer = "";
  public pid: number | null = null;
  public sessionId: string | null;
  private options: ClaudeProcessOptions;

  constructor(options: ClaudeProcessOptions) {
    super();
    this.options = options;
    this.sessionId = options.sessionId ?? null;
  }

  /**
   * Run a single prompt via Python bridge.
   * The bridge spawns Claude CLI and relays stdout (which Node.js can't pipe directly).
   */
  run(prompt: string): void {
    const claudeBin = process.env.CLAUDE_BIN || "claude";
    const tag = this.options.label ? `claude|${this.options.label}` : "claude";

    const args = [
      BRIDGE_SCRIPT,
      "--cli", "claude",
      "--prompt", prompt,
      "--cwd", this.options.cwd,
    ];
    if (claudeBin !== "claude") {
      args.push("--bin", claudeBin);
    }
    if (this.sessionId) {
      args.push("--session", this.sessionId);
    }

    console.log(`[${tag}] spawn bridge: prompt="${prompt.slice(0, 80)}..." cwd=${this.options.cwd}`);

    const env = { ...process.env, ...this.options.env };
    // Clean env vars that cause nested session errors
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    this.proc = spawn("python3", ["-u", ...args], {
      cwd: this.options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.pid = this.proc.pid ?? null;

    this.proc.stdout!.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      const lines = this.buffer.split("\n");
      // Keep last incomplete line in buffer
      this.buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        this.processLine(line);
      }
    });

    this.proc.stderr!.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        console.log(`[${tag}:stderr] ${text.slice(0, 300)}`);
      }
    });

    this.proc.on("exit", (code) => {
      console.log(`[${tag}] process exited code=${code}`);
      this.pid = null;
      // Process remaining buffer
      if (this.buffer.trim()) {
        this.processLine(this.buffer.trim());
        this.buffer = "";
      }
      this.emit("exit", code);
    });

    this.proc.on("error", (err: Error) => {
      console.error(`[${tag}] process error: ${err.message}`);
      this.emit("error", err.message);
    });
  }

  private processLine(line: string): void {
    try {
      const chunk = parseJsonStreamChunk(line);
      if (chunk.sessionId && !this.sessionId) {
        this.sessionId = chunk.sessionId;
        this.emit("session", chunk.sessionId);
      }
      if (chunk.isApproval) {
        this.emit("approval", chunk);
      }
      if (chunk.text) {
        this.emit("data", chunk);
      }
    } catch {
      // Not valid JSON, try plain text
      const chunk = parseStreamChunk(line);
      if (chunk.text) {
        this.emit("data", chunk);
      }
    }
  }

  /** Send y to stdin for approval */
  approve(): void {
    if (this.proc?.stdin?.writable) {
      this.proc.stdin.write("y\n");
      const tag = this.options.label ? `claude|${this.options.label}` : "claude";
      console.log(`[${tag}] sent approval: y`);
    }
  }

  /** Send n to stdin for denial */
  deny(): void {
    if (this.proc?.stdin?.writable) {
      this.proc.stdin.write("n\n");
      const tag = this.options.label ? `claude|${this.options.label}` : "claude";
      console.log(`[${tag}] sent denial: n`);
    }
  }

  stop(): void {
    if (this.proc && this.proc.exitCode === null) {
      this.proc.kill("SIGTERM");
    }
  }

  get isAlive(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }
}

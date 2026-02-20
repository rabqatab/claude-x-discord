import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { parseStreamChunk, type StreamChunk } from "./parser.js";

export interface ClaudeProcessOptions {
  cwd: string;
  sessionId?: string;
  verbose?: boolean;
  env?: Record<string, string>;
}

export class ClaudeProcess extends EventEmitter {
  private proc: ChildProcess | null = null;
  private buffer = "";
  public pid: number | null = null;
  public sessionId: string | null;

  constructor(private options: ClaudeProcessOptions) {
    super();
    this.sessionId = options.sessionId ?? null;
  }

  start(): void {
    const args = ["--cwd", this.options.cwd];
    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }
    if (this.options.verbose !== false) {
      args.push("--verbose");
    }

    this.proc = spawn("claude", args, {
      cwd: this.options.cwd,
      env: {
        ...process.env,
        ...this.options.env,
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.pid = this.proc.pid ?? null;

    this.proc.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) {
          const chunk = parseStreamChunk(line);
          if (chunk.sessionId && !this.sessionId) {
            this.sessionId = chunk.sessionId;
            this.emit("session", chunk.sessionId);
          }
          if (chunk.isApproval) {
            this.emit("approval", chunk);
          }
          this.emit("data", chunk);
        }
      }
    });

    this.proc.stderr?.on("data", (data: Buffer) => {
      this.emit("error", data.toString());
    });

    this.proc.on("exit", (code) => {
      this.pid = null;
      this.emit("exit", code);
    });
  }

  send(message: string): void {
    if (!this.proc?.stdin?.writable) {
      throw new Error("Process stdin not writable");
    }
    this.proc.stdin.write(message + "\n");
  }

  approve(): void {
    this.send("y");
  }

  deny(): void {
    this.send("n");
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

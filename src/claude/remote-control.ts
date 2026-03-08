import { spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BRIDGE_SCRIPT = resolve(__dirname, "../scripts/rc-bridge.py");

export interface RemoteControlResult {
  process: ChildProcess;
  url: string;
}

/**
 * Spawn `claude remote-control` via a PTY bridge and parse the session URL from stdout.
 * The TUI requires a TTY to produce output, so we use a Python PTY wrapper
 * (same pattern as the main claude-bridge.py).
 * Returns the child process and URL once it appears (or rejects after 30s timeout).
 */
export function spawnRemoteControl(cwd: string, projectName: string): Promise<RemoteControlResult> {
  return new Promise((resolve, reject) => {
    const claudeBin = process.env.CLAUDE_BIN || "claude";

    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    // If CLAUDE_BIN is a full path, prepend its directory to PATH
    if (process.env.CLAUDE_BIN && process.env.CLAUDE_BIN.includes("/")) {
      const binDir = dirname(process.env.CLAUDE_BIN);
      env.PATH = `${binDir}:${env.PATH || ""}`;
    }

    const args = ["-u", BRIDGE_SCRIPT, "--cwd", cwd, "--name", projectName];
    if (claudeBin !== "claude") {
      args.push("--bin", claudeBin);
    }

    const proc = spawn("python3", args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error("Timed out waiting for Remote Control URL (30s)"));
      }
    }, 30_000);

    proc.stdout!.on("data", (data: Buffer) => {
      if (settled) return;
      stdout += data.toString();
      // Strip ANSI escape codes before matching — remote-control uses a TUI
      const clean = stdout.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
      const match = clean.match(/https:\/\/\S+/);
      if (match) {
        settled = true;
        clearTimeout(timeout);
        resolve({ process: proc, url: match[0] });
      }
    });

    proc.stderr!.on("data", (data: Buffer) => {
      console.log(`[rc:stderr] ${data.toString().trim().slice(0, 300)}`);
    });

    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    proc.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`rc-bridge exited with code ${code} before producing a URL.\nOutput: ${stdout.slice(0, 500)}`));
      }
    });
  });
}

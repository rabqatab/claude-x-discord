import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BRIDGE_SCRIPT = resolve(__dirname, "../scripts/claude-bridge.py");

export interface OneShotResult {
  text: string;
  error: string | null;
}

/**
 * Run a one-shot Claude CLI call (no session, no resume, stdin=ignore).
 * Reuses the Python bridge pattern from debate/runner.ts.
 */
export function runOneShotClaude(
  prompt: string,
  cwd: string,
  timeoutMs: number = 120_000
): Promise<OneShotResult> {
  return new Promise((resolvePromise) => {
    const claudeBin = process.env.CLAUDE_BIN || "claude";

    const args = [
      "-u",
      BRIDGE_SCRIPT,
      "--cli", "claude",
      "--prompt", prompt,
      "--cwd", cwd,
    ];
    if (claudeBin !== "claude") {
      args.push("--bin", claudeBin);
    }

    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    let output = "";
    let stderr = "";

    const proc = spawn("python3", args, {
      cwd,
      env,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (d: Buffer) => {
      output += d.toString();
    });

    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      console.log(`[oneshot] exited code=${code} stdout=${output.length}chars`);
      const text = extractClaudeResult(output);
      const error = code !== 0 ? `exit code ${code}: ${stderr.slice(0, 300)}` : null;
      resolvePromise({ text: text || "", error });
    });

    proc.on("error", (err) => {
      resolvePromise({ text: "", error: err.message });
    });
  });
}

/** Extract result text from Claude stream-json output.
 *  Single-pass collection — returns the most complete content available.
 */
function extractClaudeResult(output: string): string {
  const lines = output.split("\n").filter((l) => l.trim());

  let resultText = "";
  let deltaText = "";
  let assistantText = "";

  for (const line of lines) {
    try {
      const json = JSON.parse(line);

      if (json.type === "result" && json.result) {
        resultText = json.result;
      }

      if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
        deltaText += json.delta.text;
      }

      if (json.type === "assistant" && json.message?.content) {
        for (const part of json.message.content) {
          if (part.type === "text") assistantText += part.text;
        }
      }
    } catch { /* skip non-JSON lines */ }
  }

  if (deltaText && deltaText.length > resultText.length) return deltaText;
  if (resultText) return resultText;
  return assistantText;
}

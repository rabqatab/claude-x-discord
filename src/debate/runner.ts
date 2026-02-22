import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type Config, type Env } from "../config/schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BRIDGE_SCRIPT = resolve(__dirname, "../scripts/claude-bridge.py");

export interface DebateResponse {
  ai: string;
  response: string;
  error: string | null;
}

export interface DebateOptions {
  question: string;
  projectPath: string;
}

export async function runDebate(options: DebateOptions, config: Config, env: Env): Promise<DebateResponse[]> {
  const timeoutMs = (config.debate.timeout || 300) * 1000;
  const promises: Promise<DebateResponse>[] = [];

  // Claude CLI — tell it to explore the project
  const claudePrompt = `You have full access to the project files in the current directory. Read and explore relevant files, then answer this question:\n\n${options.question}`;
  promises.push(
    runBridge("claude", claudePrompt, options.projectPath, {
      bin: process.env.CLAUDE_BIN,
      timeoutMs,
    })
  );

  // Gemini CLI
  if (config.debate.gemini_enabled && env.GEMINI_API_KEY) {
    promises.push(
      runBridge("gemini", options.question, options.projectPath, {
        bin: process.env.GEMINI_BIN,
        extraEnv: { GEMINI_API_KEY: env.GEMINI_API_KEY },
        timeoutMs,
      })
    );
  }

  // Codex CLI
  if (config.debate.codex_enabled && env.CODEX_API_KEY) {
    promises.push(
      runBridge("codex", options.question, options.projectPath, {
        bin: process.env.CODEX_BIN,
        extraEnv: { CODEX_API_KEY: env.CODEX_API_KEY },
        timeoutMs,
      })
    );
  }

  const results = await Promise.allSettled(promises);

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const names = ["Claude", "Gemini", "Codex"];
    return { ai: names[i] || "Unknown", response: "", error: String(r.reason) };
  });
}

interface BridgeOptions {
  bin?: string;
  extraEnv?: Record<string, string>;
  timeoutMs?: number;
}

function runBridge(
  cli: string,
  prompt: string,
  projectPath: string,
  opts: BridgeOptions = {}
): Promise<DebateResponse> {
  const displayName = cli.charAt(0).toUpperCase() + cli.slice(1);

  return new Promise((resolvePromise) => {
    const args = ["-u", BRIDGE_SCRIPT, "--cli", cli, "--prompt", prompt, "--cwd", projectPath];
    if (opts.bin) {
      args.push("--bin", opts.bin);
    }

    const env = { ...process.env, ...opts.extraEnv };

    let output = "";
    let stderr = "";
    const proc = spawn("python3", args, {
      cwd: projectPath,
      env,
      timeout: opts.timeoutMs || 300000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (d: Buffer) => {
      output += d.toString();
    });

    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      console.log(`[debate:${cli}] exited code=${code} stdout=${output.length}chars stderr=${stderr.length}chars`);
      console.log(`[debate:${cli}] raw output (first 800): ${output.slice(0, 800)}`);
      if (stderr) console.log(`[debate:${cli}] stderr: ${stderr.slice(0, 500)}`);

      let text: string;
      if (cli === "claude") {
        text = extractClaudeResult(output);
      } else if (cli === "codex") {
        text = extractCodexResult(output);
      } else {
        text = extractGeminiResult(output);
      }

      console.log(`[debate:${cli}] extracted text length: ${text.length}`);
      const error = code !== 0 ? `exit code ${code}: ${stderr.slice(0, 300)}` : null;
      resolvePromise({ ai: displayName, response: text || "(no response)", error });
    });

    proc.on("error", (err) => {
      resolvePromise({ ai: displayName, response: "", error: err.message });
    });
  });
}

/** Extract result text from Claude stream-json output */
function extractClaudeResult(output: string): string {
  const lines = output.split("\n").filter(l => l.trim());

  // 1) Look for result line (final summary)
  for (const line of lines) {
    try {
      const json = JSON.parse(line);
      if (json.type === "result" && json.result) return json.result;
    } catch { /* skip */ }
  }

  // 2) Collect from content_block_delta (streaming text deltas)
  let deltaText = "";
  for (const line of lines) {
    try {
      const json = JSON.parse(line);
      if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
        deltaText += json.delta.text;
      }
    } catch { /* skip */ }
  }
  if (deltaText) return deltaText;

  // 3) Fallback: collect assistant message text
  let text = "";
  for (const line of lines) {
    try {
      const json = JSON.parse(line);
      if (json.type === "assistant" && json.message?.content) {
        for (const part of json.message.content) {
          if (part.type === "text") text += part.text;
        }
      }
    } catch { /* skip */ }
  }
  return text;
}

/** Extract result from Gemini JSON output */
function extractGeminiResult(output: string): string {
  // Try parsing full output as JSON
  try {
    const json = JSON.parse(output);
    if (typeof json === "string") return json;
    if (json.response) return json.response;
    if (json.text) return json.text;
    if (json.content) return json.content;
  } catch { /* not valid JSON as-is */ }

  // Try to find JSON object in the output (skip non-JSON prefix/suffix)
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const json = JSON.parse(jsonMatch[0]);
      if (json.response) return json.response;
      if (json.text) return json.text;
      if (json.content) return json.content;
    } catch { /* still not valid */ }
  }

  // Try line-by-line (JSONL format)
  const lines = output.split("\n").filter(l => l.trim());
  for (const line of lines) {
    try {
      const json = JSON.parse(line);
      if (json.response) return json.response;
      if (json.text) return json.text;
    } catch { /* skip */ }
  }

  // Fallback: return raw text
  return output.trim();
}

/** Extract result from Codex JSONL output (one JSON object per line) */
function extractCodexResult(output: string): string {
  const lines = output.split("\n").filter(l => l.trim());
  let text = "";

  for (const line of lines) {
    try {
      const json = JSON.parse(line);
      // Codex outputs agent_message items with text
      if (json.type === "item.completed" && json.item?.type === "agent_message" && json.item?.text) {
        text += json.item.text;
      }
      // Also check for direct result/output fields
      if (json.result) return json.result;
      if (json.output && typeof json.output === "string") return json.output;
    } catch { /* skip non-JSON lines */ }
  }

  return text || output.trim();
}

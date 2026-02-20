import { spawn } from "node:child_process";
import { type Config, type Env } from "../config/schema.js";

export interface DebateResponse {
  ai: string;
  response: string;
  error: string | null;
}

export async function runDebate(context: string, config: Config, env: Env): Promise<DebateResponse[]> {
  const promises: Promise<DebateResponse>[] = [];

  promises.push(runCli("Claude", "claude", ["-p", context, "--output-format", "json"], {}));

  if (config.debate.gemini_enabled && env.GEMINI_API_KEY) {
    promises.push(
      runCli("Gemini", "gemini", ["-p", context, "--output-format", "json"], {
        GEMINI_API_KEY: env.GEMINI_API_KEY,
      })
    );
  }

  if (config.debate.codex_enabled && env.CODEX_API_KEY) {
    promises.push(
      runCli("Codex", "codex", ["exec", "--json", context], {
        CODEX_API_KEY: env.CODEX_API_KEY,
      })
    );
  }

  const results = await Promise.allSettled(promises);

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { ai: ["Claude", "Gemini", "Codex"][i], response: "", error: String(r.reason) };
  });
}

function runCli(
  name: string,
  command: string,
  args: string[],
  envVars: Record<string, string>
): Promise<DebateResponse> {
  return new Promise((resolve) => {
    let output = "";
    let error = "";
    const proc = spawn(command, args, {
      env: { ...process.env, ...envVars },
      timeout: 60000,
    });
    proc.stdout?.on("data", (d: Buffer) => {
      output += d.toString();
    });
    proc.stderr?.on("data", (d: Buffer) => {
      error += d.toString();
    });
    proc.on("close", (code) => {
      resolve({ ai: name, response: output || "(no response)", error: code !== 0 ? error : null });
    });
    proc.on("error", (err) => {
      resolve({ ai: name, response: "", error: err.message });
    });
  });
}

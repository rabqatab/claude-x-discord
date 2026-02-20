import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const PERSONA_DIR = resolve(
  process.env.CLAUDE_X_DISCORD_HOME || `${process.env.HOME}/.claude-x-discord`,
  "persona"
);

function ensurePersonaDir(): void {
  if (!existsSync(PERSONA_DIR)) {
    mkdirSync(PERSONA_DIR, { recursive: true });
  }
}

function readPersonaFile(filename: string): string {
  const filePath = resolve(PERSONA_DIR, filename);
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf-8");
}

function writePersonaFile(filename: string, content: string): void {
  ensurePersonaDir();
  const filePath = resolve(PERSONA_DIR, filename);
  writeFileSync(filePath, content, "utf-8");
}

export function getUser(): string {
  return readPersonaFile("USER.md");
}

export function setUser(content: string): void {
  writePersonaFile("USER.md", content);
}

export function getPatterns(): string {
  return readPersonaFile("PATTERNS.md");
}

export function setPatterns(content: string): void {
  writePersonaFile("PATTERNS.md", content);
}

export function getLessons(): string {
  return readPersonaFile("LESSONS.md");
}

export function setLessons(content: string): void {
  writePersonaFile("LESSONS.md", content);
}

export function appendLessons(content: string): void {
  const existing = getLessons();
  const updated = existing ? `${existing}\n${content}` : content;
  setLessons(updated);
}

export function getSystemPromptContext(): string {
  const parts: string[] = [];
  const user = getUser();
  if (user) parts.push(`## User Profile\n${user}`);
  const patterns = getPatterns();
  if (patterns) parts.push(`## Behavioral Patterns\n${patterns}`);
  const lessons = getLessons();
  if (lessons) parts.push(`## Lessons Learned\n${lessons}`);
  return parts.join("\n\n");
}

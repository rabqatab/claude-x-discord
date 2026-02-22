import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { resolve } from "node:path";
import { appendFileSync } from "node:fs";
import { type MemoryDB } from "../db/memory.js";
import { runOneShotClaude } from "../claude/oneshot.js";
import { setUser, getLessons, setLessons, getPatterns, setPatterns } from "./persona.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Facet {
  topic_id: string;
  project_name: string;
  project_path: string;
  timestamp: number;
  project_lessons: string[];
  global_lessons: string[];
  friction: string[];
  patterns: string[];
}

export interface Aggregation {
  timestamp: number;
  recurring_friction: string[];
  workflow_suggestions: string[];
  claude_md_recommendations: string[];
  pattern_changes: string[];
  user_profile: string[];
}

// ─── Paths ──────────────────────────────────────────────────────────────────

const BASE_DIR = process.env.CLAUDE_X_DISCORD_HOME || process.cwd();
const FACETS_DIR = resolve(BASE_DIR, "data", "facets");

function ensureFacetsDir(): void {
  if (!existsSync(FACETS_DIR)) {
    mkdirSync(FACETS_DIR, { recursive: true });
  }
}

// ─── Trigger ────────────────────────────────────────────────────────────────

export function shouldAutoLearn(
  sessionCount: number,
  interval: number
): boolean {
  return sessionCount > 0 && sessionCount % interval === 0;
}

// ─── JSON Parsing (3-stage fallback) ────────────────────────────────────────

export function parseAnalysisJson<T>(text: string): T | null {
  // 1) Direct parse
  try {
    return JSON.parse(text) as T;
  } catch { /* continue */ }

  // 2) Strip markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]) as T;
    } catch { /* continue */ }
  }

  // 3) Extract first { ... } block
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(text.slice(braceStart, braceEnd + 1)) as T;
    } catch { /* continue */ }
  }

  return null;
}

// ─── Prompt Builders ────────────────────────────────────────────────────────

const MAX_CONVERSATION_CHARS = 30_000;

export function buildFacetExtractionPrompt(
  conversations: { role: string; content: string }[]
): string {
  // Truncate conversations to fit within prompt limits
  let total = 0;
  const truncated: { role: string; content: string }[] = [];
  for (const c of conversations) {
    const entry = `[${c.role}]: ${c.content}`;
    if (total + entry.length > MAX_CONVERSATION_CHARS) break;
    truncated.push(c);
    total += entry.length;
  }

  const conversationText = truncated
    .map((c) => `[${c.role}]: ${c.content}`)
    .join("\n\n");

  return `You are analyzing a conversation between a user and an AI coding assistant.
Extract structured insights from the following conversation.

<conversation>
${conversationText}
</conversation>

Respond with ONLY a JSON object (no markdown, no explanation) with these fields:
{
  "project_lessons": ["lessons specific to the project being worked on"],
  "global_lessons": ["general lessons about the user's preferences and workflow"],
  "friction": ["pain points, errors, or frustrations observed"],
  "patterns": ["recurring behavioral patterns, tool preferences, coding style"]
}

Each array should contain 0-5 concise bullet-point strings. If nothing relevant, use empty arrays.`;
}

export function buildAggregationPrompt(facets: Facet[]): string {
  const facetSummaries = facets
    .map(
      (f, i) =>
        `--- Facet ${i + 1} (${f.project_name}, ${new Date(f.timestamp * 1000).toISOString().slice(0, 10)}) ---
Lessons: ${[...f.project_lessons, ...f.global_lessons].join("; ") || "none"}
Friction: ${f.friction.join("; ") || "none"}
Patterns: ${f.patterns.join("; ") || "none"}`
    )
    .join("\n\n");

  return `You are analyzing accumulated insights from multiple coding sessions with a user.
Synthesize the following facets into a high-level analysis.

<facets>
${facetSummaries}
</facets>

Respond with ONLY a JSON object (no markdown, no explanation) with these fields:
{
  "recurring_friction": ["friction points that appear across multiple sessions"],
  "workflow_suggestions": ["actionable suggestions to improve the user's workflow"],
  "claude_md_recommendations": ["specific lines to add to CLAUDE.md project files"],
  "pattern_changes": ["notable changes or evolution in the user's patterns over time"],
  "user_profile": ["summary of user's work style, preferred languages, communication style, expertise areas"]
}

Each array should contain 0-5 concise strings. If nothing relevant, use empty arrays.`;
}

// ─── Facet File I/O ─────────────────────────────────────────────────────────

export function saveFacet(facet: Facet): void {
  ensureFacetsDir();
  const filename = `${facet.topic_id}_${facet.timestamp}.json`;
  const filePath = resolve(FACETS_DIR, filename);
  writeFileSync(filePath, JSON.stringify(facet, null, 2), "utf-8");
}

export function loadFacetsSince(sinceTimestamp: number): Facet[] {
  ensureFacetsDir();
  const files = readdirSync(FACETS_DIR).filter((f) => f.endsWith(".json"));
  const facets: Facet[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(resolve(FACETS_DIR, file), "utf-8");
      const facet = JSON.parse(content) as Facet;
      if (facet.timestamp >= sinceTimestamp) {
        facets.push(facet);
      }
    } catch {
      console.warn(`[facet] failed to read ${file}`);
    }
  }

  return facets.sort((a, b) => a.timestamp - b.timestamp);
}

export function countFacetsSince(sinceTimestamp: number): number {
  return loadFacetsSince(sinceTimestamp).length;
}

// ─── Stage 1: Facet Extraction ──────────────────────────────────────────────

export async function extractFacets(
  topicId: string,
  projectName: string,
  projectPath: string,
  memory: MemoryDB,
  timeoutMs: number = 120_000
): Promise<Facet | null> {
  console.log(`[facet] extracting for topic=${topicId} project=${projectName}`);

  // Get conversations since last facet extraction for this topic
  const lastExtractedTs = memory.getAnalysisState(`facet_last_${topicId}`);
  const since = lastExtractedTs ? parseInt(lastExtractedTs, 10) : 0;
  const conversations = memory.getConversationsSince(topicId, since);

  if (conversations.length === 0) {
    console.log(`[facet] no new conversations for topic=${topicId}`);
    return null;
  }

  const prompt = buildFacetExtractionPrompt(
    conversations.map((c) => ({ role: c.role, content: c.content }))
  );

  const result = await runOneShotClaude(prompt, projectPath, timeoutMs);

  if (result.error) {
    console.error(`[facet] Claude error: ${result.error}`);
    return null;
  }

  const parsed = parseAnalysisJson<{
    project_lessons?: string[];
    global_lessons?: string[];
    friction?: string[];
    patterns?: string[];
  }>(result.text);

  if (!parsed) {
    console.error(`[facet] failed to parse JSON from Claude response`);
    console.error(`[facet] raw response (first 500): ${result.text.slice(0, 500)}`);
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const facet: Facet = {
    topic_id: topicId,
    project_name: projectName,
    project_path: projectPath,
    timestamp: now,
    project_lessons: parsed.project_lessons ?? [],
    global_lessons: parsed.global_lessons ?? [],
    friction: parsed.friction ?? [],
    patterns: parsed.patterns ?? [],
  };

  // Save facet to disk
  saveFacet(facet);

  // Append project lessons to {project}/CLAUDE.md
  if (facet.project_lessons.length > 0) {
    const claudeMdPath = resolve(projectPath, "CLAUDE.md");
    const timestamp = new Date().toISOString().slice(0, 10);
    const section = `\n\n## Auto-learned (${timestamp})\n${facet.project_lessons.map((l) => `- ${l}`).join("\n")}\n`;
    try {
      appendFileSync(claudeMdPath, section, "utf-8");
      console.log(`[facet] appended ${facet.project_lessons.length} lessons to ${claudeMdPath}`);
    } catch (err) {
      console.warn(`[facet] failed to append to CLAUDE.md: ${err}`);
    }
  }

  // Append global lessons to persona/LESSONS.md
  const globalItems = [...facet.global_lessons, ...facet.patterns];
  if (globalItems.length > 0) {
    const timestamp = new Date().toISOString().slice(0, 10);
    const existing = getLessons();
    const section = `\n### ${timestamp} (auto-learned)\n${globalItems.map((l) => `- ${l}`).join("\n")}`;
    setLessons(existing ? `${existing}\n${section}` : section);
    console.log(`[facet] appended ${globalItems.length} items to LESSONS.md`);
  }

  // Update analysis state
  memory.setAnalysisState(`facet_last_${topicId}`, String(now));

  console.log(`[facet] extracted for topic=${topicId}: ${facet.project_lessons.length} project, ${facet.global_lessons.length} global, ${facet.friction.length} friction, ${facet.patterns.length} patterns`);
  return facet;
}

// ─── Stage 2: Aggregation ───────────────────────────────────────────────────

export async function runAggregation(
  memory: MemoryDB,
  threshold: number,
  timeoutMs: number = 120_000
): Promise<Aggregation | null> {
  // Get last aggregation timestamp
  const lastAggTs = memory.getAnalysisState("aggregation_last");
  const since = lastAggTs ? parseInt(lastAggTs, 10) : 0;

  const facets = loadFacetsSince(since);
  if (facets.length < threshold) {
    console.log(`[aggregation] only ${facets.length}/${threshold} facets, skipping`);
    return null;
  }

  console.log(`[aggregation] running with ${facets.length} facets`);

  // Use first facet's project path as cwd (arbitrary but needed)
  const cwd = facets[0].project_path;
  const prompt = buildAggregationPrompt(facets);
  const result = await runOneShotClaude(prompt, cwd, timeoutMs);

  if (result.error) {
    console.error(`[aggregation] Claude error: ${result.error}`);
    return null;
  }

  const parsed = parseAnalysisJson<{
    recurring_friction?: string[];
    workflow_suggestions?: string[];
    claude_md_recommendations?: string[];
    pattern_changes?: string[];
    user_profile?: string[];
  }>(result.text);

  if (!parsed) {
    console.error(`[aggregation] failed to parse JSON`);
    console.error(`[aggregation] raw (first 500): ${result.text.slice(0, 500)}`);
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const aggregation: Aggregation = {
    timestamp: now,
    recurring_friction: parsed.recurring_friction ?? [],
    workflow_suggestions: parsed.workflow_suggestions ?? [],
    claude_md_recommendations: parsed.claude_md_recommendations ?? [],
    pattern_changes: parsed.pattern_changes ?? [],
    user_profile: parsed.user_profile ?? [],
  };

  // USER.md — full replace
  if (aggregation.user_profile.length > 0) {
    const profileContent = aggregation.user_profile.map((l) => `- ${l}`).join("\n");
    setUser(`# User Profile\n\n${profileContent}\n\n_Last updated: ${new Date().toISOString().slice(0, 10)}_\n`);
    console.log(`[aggregation] updated USER.md with ${aggregation.user_profile.length} items`);
  }

  // PATTERNS.md — append
  if (aggregation.pattern_changes.length > 0) {
    const timestamp = new Date().toISOString().slice(0, 10);
    const existing = getPatterns();
    const section = `\n### ${timestamp} (aggregated)\n${aggregation.pattern_changes.map((l) => `- ${l}`).join("\n")}`;
    setPatterns(existing ? `${existing}\n${section}` : section);
    console.log(`[aggregation] appended ${aggregation.pattern_changes.length} patterns to PATTERNS.md`);
  }

  // Update aggregation timestamp
  memory.setAnalysisState("aggregation_last", String(now));

  console.log(`[aggregation] complete: ${aggregation.workflow_suggestions.length} suggestions, ${aggregation.claude_md_recommendations.length} recommendations`);
  return aggregation;
}

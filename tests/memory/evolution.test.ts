import { describe, it, expect } from "vitest";
import {
  shouldAutoLearn,
  parseAnalysisJson,
  buildFacetExtractionPrompt,
  buildAggregationPrompt,
  type Facet,
} from "../../src/memory/evolution.js";

describe("shouldAutoLearn", () => {
  it("detects session count threshold", () => {
    expect(shouldAutoLearn(9, 10)).toBe(false);
    expect(shouldAutoLearn(10, 10)).toBe(true);
    expect(shouldAutoLearn(20, 10)).toBe(true);
    expect(shouldAutoLearn(0, 10)).toBe(false);
  });
});

describe("parseAnalysisJson", () => {
  it("parses clean JSON", () => {
    const input = '{"project_lessons": ["lesson1"], "friction": []}';
    const result = parseAnalysisJson<{ project_lessons: string[] }>(input);
    expect(result).toEqual({ project_lessons: ["lesson1"], friction: [] });
  });

  it("strips markdown fences", () => {
    const input = '```json\n{"key": "value"}\n```';
    const result = parseAnalysisJson<{ key: string }>(input);
    expect(result).toEqual({ key: "value" });
  });

  it("strips markdown fences without language tag", () => {
    const input = '```\n{"key": "value"}\n```';
    const result = parseAnalysisJson<{ key: string }>(input);
    expect(result).toEqual({ key: "value" });
  });

  it("extracts JSON from surrounding text", () => {
    const input =
      'Here is the analysis:\n{"project_lessons": ["a"], "global_lessons": []}\nHope this helps!';
    const result = parseAnalysisJson<{ project_lessons: string[] }>(input);
    expect(result).toEqual({
      project_lessons: ["a"],
      global_lessons: [],
    });
  });

  it("returns null for unparseable text", () => {
    const result = parseAnalysisJson("this is not json at all");
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = parseAnalysisJson("");
    expect(result).toBeNull();
  });
});

describe("buildFacetExtractionPrompt", () => {
  it("includes conversation content", () => {
    const conversations = [
      { role: "user", content: "How do I use Docker?" },
      { role: "assistant", content: "You can use docker compose..." },
    ];
    const prompt = buildFacetExtractionPrompt(conversations);
    expect(prompt).toContain("How do I use Docker?");
    expect(prompt).toContain("docker compose");
    expect(prompt).toContain("[user]");
    expect(prompt).toContain("[assistant]");
  });

  it("truncates long conversations", () => {
    const conversations = Array.from({ length: 100 }, (_, i) => ({
      role: "user",
      content: "x".repeat(1000) + ` message ${i}`,
    }));
    const prompt = buildFacetExtractionPrompt(conversations);
    // Should not contain all 100 messages (30k char limit)
    expect(prompt.length).toBeLessThan(40_000);
  });

  it("requests JSON output format", () => {
    const prompt = buildFacetExtractionPrompt([
      { role: "user", content: "test" },
    ]);
    expect(prompt).toContain("project_lessons");
    expect(prompt).toContain("global_lessons");
    expect(prompt).toContain("friction");
    expect(prompt).toContain("patterns");
    expect(prompt).toContain("JSON");
  });
});

describe("buildAggregationPrompt", () => {
  const makeFacet = (overrides: Partial<Facet> = {}): Facet => ({
    topic_id: "t1",
    project_name: "test-project",
    project_path: "/tmp/test",
    timestamp: 1700000000,
    project_lessons: ["lesson1"],
    global_lessons: ["global1"],
    friction: ["friction1"],
    patterns: ["pattern1"],
    ...overrides,
  });

  it("includes facet summaries", () => {
    const facets = [makeFacet(), makeFacet({ topic_id: "t2" })];
    const prompt = buildAggregationPrompt(facets);
    expect(prompt).toContain("lesson1");
    expect(prompt).toContain("global1");
    expect(prompt).toContain("friction1");
    expect(prompt).toContain("pattern1");
    expect(prompt).toContain("test-project");
  });

  it("includes user_profile field in expected output", () => {
    const prompt = buildAggregationPrompt([makeFacet()]);
    expect(prompt).toContain("user_profile");
    expect(prompt).toContain("workflow_suggestions");
    expect(prompt).toContain("claude_md_recommendations");
    expect(prompt).toContain("pattern_changes");
    expect(prompt).toContain("recurring_friction");
  });
});

import { describe, it, expect } from "vitest";
import { ClaudePool } from "../../src/claude/pool.js";

describe("ClaudePool", () => {
  it("starts with no active processes", () => {
    const pool = new ClaudePool(2, 1800);
    expect(pool.listActive()).toHaveLength(0);
    pool.stopAll();
  });

  it("get returns undefined for unknown topicId", () => {
    const pool = new ClaudePool(2, 1800);
    expect(pool.get("nonexistent")).toBeUndefined();
    pool.stopAll();
  });
});

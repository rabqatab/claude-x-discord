import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDB } from "../../src/db/memory.js";

describe("MemoryDB", () => {
  let db: MemoryDB;
  beforeEach(() => { db = new MemoryDB(":memory:"); });
  afterEach(() => { db.close(); });

  it("stores and searches memories with FTS5", () => {
    db.addMemory({ key: "docker-lesson", value: "Always mount volumes before docker rm to prevent data loss", source: "session", confidence: 0.9 });
    const results = db.search("docker volume data loss");
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("docker-lesson");
  });

  it("stores conversation entries", () => {
    db.addConversation({ topicId: "t1", role: "user", content: "Fix the bug in auth module" });
    db.addConversation({ topicId: "t1", role: "assistant", content: "I found the issue in token validation" });
    const history = db.getConversationHistory("t1", 10);
    expect(history).toHaveLength(2);
  });

  it("explicit remember has confidence 1.0", () => {
    db.remember("API key rotation happens every 90 days");
    const results = db.search("API key rotation");
    expect(results[0].confidence).toBe(1.0);
  });

  it("decays confidence", () => {
    db.addMemory({ key: "old", value: "old memory content here", source: "session", confidence: 0.8 });
    db.decayConfidence(0.95);
    const results = db.search("old memory content");
    expect(results[0].confidence).toBeCloseTo(0.76);
  });
});

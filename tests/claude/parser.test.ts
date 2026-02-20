import { describe, it, expect } from "vitest";
import {
  parseStreamChunk,
  isApprovalRequest,
  isSessionId,
} from "../../src/claude/parser.js";

describe("parser", () => {
  it("detects approval request patterns", () => {
    expect(isApprovalRequest("Do you want to proceed? (y/n)")).toBe(true);
    expect(isApprovalRequest("Allow claude to run `rm -rf`? (y/n)")).toBe(true);
    expect(isApprovalRequest("Here is some normal output")).toBe(false);
  });

  it("detects session ID from verbose output", () => {
    const id = isSessionId("Session: abc-123-def");
    expect(id).toBe("abc-123-def");
  });

  it("returns null for non-session text", () => {
    expect(isSessionId("just some text")).toBeNull();
  });

  it("parses stream chunks into structured output", () => {
    const result = parseStreamChunk("## Analysis\nThe code looks good.");
    expect(result.text).toContain("Analysis");
    expect(result.isComplete).toBe(false);
    expect(result.isApproval).toBe(false);
  });

  it("detects tool usage", () => {
    const result = parseStreamChunk("[tool: Edit file: app.py]");
    expect(result.toolUse).toBe("Edit");
  });
});

import { describe, it, expect } from "vitest";
import { formatForDiscord, splitMessage } from "../../src/formatter/index.js";

describe("Formatter", () => {
  it("passes short markdown through", () => {
    const result = formatForDiscord("## Hello\nWorld");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toContain("Hello");
    expect(result.attachment).toBeNull();
  });

  it("creates attachment for very long output (>5 parts)", () => {
    const longText = ("line of text here\n").repeat(1000);
    const result = formatForDiscord(longText);
    expect(result.messages[0].length).toBeLessThanOrEqual(2000);
    expect(result.attachment).not.toBeNull();
    expect(result.attachment!.content).toBe(longText);
  });

  it("formats tool usage as compact summary", () => {
    const result = formatForDiscord("[tool: Edit file: app.py lines 42-45]");
    expect(result.messages[0]).toContain("Edit");
    expect(result.messages[0]).toContain("app.py");
  });

  it("splits messages respecting code block boundaries", () => {
    const text = "before\n```python\n" + "x = 1\n".repeat(300) + "```\nafter";
    const parts = splitMessage(text, 2000);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(2100); // allow small overflow for closing ```
    }
  });

  it("returns single element for short text", () => {
    const parts = splitMessage("short", 2000);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe("short");
  });
});

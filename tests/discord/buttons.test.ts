import { describe, it, expect } from "vitest";
import { parseButtonAction } from "../../src/discord/buttons.js";

describe("parseButtonAction", () => {
  it("parses approve action", () => {
    const result = parseButtonAction("approve:req-123");
    expect(result).toEqual({ action: "approve", requestId: "req-123" });
  });

  it("parses deny action", () => {
    const result = parseButtonAction("deny:req-456");
    expect(result).toEqual({ action: "deny", requestId: "req-456" });
  });

  it("returns null for invalid format", () => {
    expect(parseButtonAction("invalid")).toBeNull();
    expect(parseButtonAction("")).toBeNull();
  });
});

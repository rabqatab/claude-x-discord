import { describe, it, expect } from "vitest";
import { shouldAutoLearn } from "../../src/memory/evolution.js";

describe("evolution", () => {
  it("detects session count threshold", () => {
    expect(shouldAutoLearn(9, 10)).toBe(false);
    expect(shouldAutoLearn(10, 10)).toBe(true);
    expect(shouldAutoLearn(20, 10)).toBe(true);
    expect(shouldAutoLearn(0, 10)).toBe(false);
  });
});

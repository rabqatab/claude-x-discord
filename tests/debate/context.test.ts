import { describe, it, expect } from "vitest";
import { assembleApiContext } from "../../src/debate/context.js";

describe("assembleApiContext", () => {
  it("combines facts and summary into context document", () => {
    const result = assembleApiContext({
      projectFacts: { tree: "src/\n  index.ts", dependencies: '{ "discord.js": "^14" }', readme: "# My Project", sourceFiles: "" },
      claudeSummary: "This is a Discord bot",
      question: "Redis vs SQLite?",
    });
    expect(result).toContain("## Project Facts");
    expect(result).toContain("## Context Summary");
    expect(result).toContain("## Question");
    expect(result).toContain("Redis vs SQLite");
  });
});

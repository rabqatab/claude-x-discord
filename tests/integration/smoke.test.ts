import { describe, it, expect } from "vitest";
import { configSchema } from "../../src/config/schema.js";
import { SessionsDB } from "../../src/db/sessions.js";
import { MemoryDB } from "../../src/db/memory.js";
import { ClaudePool } from "../../src/claude/pool.js";
import { formatForDiscord } from "../../src/formatter/index.js";
import { assembleApiContext } from "../../src/debate/context.js";
import { shouldAutoLearn } from "../../src/memory/evolution.js";
import { parseButtonAction } from "../../src/discord/buttons.js";

describe("Integration smoke test", () => {
  it("config + db + pool + formatter + debate + memory work together", () => {
    // Config
    const config = configSchema.parse({
      discord: { guild_id: "1", forum_channel_id: "2", allowed_user_ids: ["3"] },
      claude: {},
      models: {},
      debate: {},
      memory: {},
    });
    expect(config.claude.max_processes).toBe(7);
    expect(config.models.claude).toBe("claude-opus-4-6");
    expect(config.web.port).toBe(3848);

    // Sessions DB
    const sessions = new SessionsDB(":memory:");
    sessions.registerProject({ forumTopicId: "topic1", projectName: "test", projectPath: "/tmp/test" });
    expect(sessions.getProjectByTopicId("topic1")).toBeDefined();
    expect(sessions.getProjectByTopicId("topic1")!.project_name).toBe("test");

    // Memory DB
    const memory = new MemoryDB(":memory:");
    memory.remember("test memory content here");
    const results = memory.search("test memory");
    expect(results.length).toBeGreaterThan(0);

    // Pool
    const pool = new ClaudePool(config.claude.max_processes, config.claude.idle_timeout);
    expect(pool.listActive()).toHaveLength(0);

    // Formatter
    const output = formatForDiscord("Hello from Claude");
    expect(output.messages[0]).toBe("Hello from Claude");
    expect(output.attachment).toBeNull();

    const longOutput = formatForDiscord(("line of text here\n").repeat(1000));
    expect(longOutput.attachment).not.toBeNull();

    // Debate context
    const ctx = assembleApiContext({
      projectFacts: { tree: "src/", dependencies: "{}", readme: "# Test", sourceFiles: "" },
      claudeSummary: "A test project",
      question: "Redis vs SQLite?",
    });
    expect(ctx).toContain("## Question");

    // Memory evolution
    expect(shouldAutoLearn(10, 10)).toBe(true);
    expect(shouldAutoLearn(5, 10)).toBe(false);

    // Buttons
    expect(parseButtonAction("approve:req-1")).toEqual({ action: "approve", requestId: "req-1" });

    // Cleanup
    sessions.close();
    memory.close();
    pool.stopAll();
  });
});

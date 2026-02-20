import { describe, it, expect } from "vitest";
import { configSchema, envSchema } from "../../src/config/schema.js";

describe("configSchema", () => {
  it("parses valid config with defaults", () => {
    const result = configSchema.parse({
      discord: {
        guild_id: "123",
        forum_channel_id: "456",
        allowed_user_ids: ["789"],
      },
      claude: {},
      models: {},
      debate: {},
      memory: {},
    });
    expect(result.claude.idle_timeout).toBe(1800);
    expect(result.claude.max_processes).toBe(7);
    expect(result.models.claude).toBe("claude-opus-4-6");
  });

  it("rejects missing discord config", () => {
    expect(() => configSchema.parse({})).toThrow();
  });
});

describe("envSchema", () => {
  it("parses valid env", () => {
    const result = envSchema.parse({ DISCORD_TOKEN: "test-token" });
    expect(result.DISCORD_TOKEN).toBe("test-token");
  });

  it("rejects missing DISCORD_TOKEN", () => {
    expect(() => envSchema.parse({})).toThrow();
  });
});

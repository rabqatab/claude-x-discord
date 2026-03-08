import { z } from "zod";

export const configSchema = z.object({
  machine_name: z.string().default("local"),
  discord: z.object({
    guild_id: z.string(),
    forum_channel_id: z.string(),
    allowed_user_ids: z.array(z.string()),
  }),
  claude: z.object({
    idle_timeout: z.number().default(1800),
    max_processes: z.number().default(7),
    streaming_debounce: z.number().default(1000),
  }),
  models: z.object({
    claude: z.string().default("claude-opus-4-6"),
    gemini: z.string().default("gemini-3.1-pro"),
    codex: z.string().default("gpt-5.2-codex"),
  }),
  debate: z.object({
    timeout: z.number().default(60),
    gemini_enabled: z.boolean().default(true),
    codex_enabled: z.boolean().default(true),
  }),
  web: z.object({
    port: z.number().default(3848),
    enabled: z.boolean().default(true),
    token_ttl: z.number().default(3600),
  }).default({ port: 3848, enabled: true, token_ttl: 3600 }),
  memory: z.object({
    auto_learn_interval: z.number().default(10),
    confidence_decay: z.number().default(0.95),
    facet_interval: z.number().default(10),
    aggregation_threshold: z.number().default(5),
    analysis_timeout: z.number().default(120),
  }),
});

export type Config = z.infer<typeof configSchema>;

export const envSchema = z.object({
  DISCORD_TOKEN: z.string(),
  GEMINI_API_KEY: z.string().optional(),
  CODEX_API_KEY: z.string().optional(),
  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

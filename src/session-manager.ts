import { type Message, type ButtonInteraction, type ChatInputCommandInteraction, type ThreadChannel, AttachmentBuilder } from "discord.js";
import { DiscordGateway } from "./discord/client.js";
import { ForumManager } from "./discord/forum.js";
import { parseButtonAction, sendApprovalRequest } from "./discord/buttons.js";
import { ClaudePool } from "./claude/pool.js";
import { type StreamChunk } from "./claude/parser.js";
import { SessionsDB } from "./db/sessions.js";
import { MemoryDB } from "./db/memory.js";
import { formatForDiscord } from "./formatter/index.js";
import { type Config, type Env } from "./config/schema.js";
import { createCommandRegistry, type CommandRegistry } from "./commands/index.js";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export class SessionManager {
  private gateway: DiscordGateway;
  private forum: ForumManager;
  private pool: ClaudePool;
  private sessions: SessionsDB;
  private memory: MemoryDB;
  private commands!: CommandRegistry;
  private pendingApprovals = new Map<string, string>();

  constructor(
    private config: Config,
    private env: Env
  ) {
    const dataDir = resolve(
      process.env.CLAUDE_X_DISCORD_HOME || `${process.env.HOME}/.claude-x-discord`,
      "data"
    );
    mkdirSync(dataDir, { recursive: true });

    this.gateway = new DiscordGateway(env.DISCORD_TOKEN, config.discord.allowed_user_ids);
    this.forum = new ForumManager(
      this.gateway.client,
      config.discord.guild_id,
      config.discord.forum_channel_id
    );
    this.pool = new ClaudePool(config.claude.max_processes, config.claude.idle_timeout);
    this.sessions = new SessionsDB(resolve(dataDir, "sessions.db"));
    this.memory = new MemoryDB(resolve(dataDir, "memory.db"));
  }

  get sessionsDB(): SessionsDB { return this.sessions; }
  get memoryDB(): MemoryDB { return this.memory; }
  get claudePool(): ClaudePool { return this.pool; }
  get forumManager(): ForumManager { return this.forum; }

  async start(): Promise<void> {
    this.commands = await createCommandRegistry();

    this.gateway.on("ready", async () => {
      console.log("Discord connected");
      await this.forum.init().catch(console.error);

      const clientId = this.gateway.client.user?.id;
      if (clientId) {
        await this.commands.deployToGuild(
          this.env.DISCORD_TOKEN,
          clientId,
          this.config.discord.guild_id
        );
        console.log("Slash commands deployed");
      }
    });

    this.gateway.on("message", (msg: Message) => this.handleMessage(msg));
    this.gateway.on("button", (btn: ButtonInteraction) => this.handleButton(btn));
    this.gateway.on("command", (interaction: ChatInputCommandInteraction) =>
      this.handleCommand(interaction)
    );

    await this.gateway.start();
  }

  private async handleMessage(msg: Message): Promise<void> {
    const topicId = msg.channelId;
    const project = this.sessions.getProjectByTopicId(topicId);
    if (!project) return;

    this.memory.addConversation({
      topicId,
      role: "user",
      content: msg.content,
    });

    const proc = this.pool.spawn(topicId, {
      cwd: project.project_path,
      sessionId: project.session_id ?? undefined,
    });

    if (proc.pid) {
      this.sessions.updateSession(topicId, proc.sessionId ?? "", proc.pid);
    }

    const channel = msg.channel as ThreadChannel;
    await channel.sendTyping();

    const streamState = {
      buffer: "",
      messageId: null as string | null,
      lastEdit: 0,
    };

    const onData = async (chunk: StreamChunk) => {
      streamState.buffer += chunk.text + "\n";
      const now = Date.now();
      if (now - streamState.lastEdit < this.config.claude.streaming_debounce) return;
      streamState.lastEdit = now;
      try {
        const preview = streamState.buffer.slice(0, 1900);
        if (!streamState.messageId) {
          const sent = await channel.send(preview);
          streamState.messageId = sent.id;
        } else {
          const existing = await channel.messages.fetch(streamState.messageId);
          await existing.edit(preview);
        }
      } catch { /* rate limited, skip */ }
    };

    const onApproval = async (chunk: StreamChunk) => {
      const requestId = randomUUID();
      this.pendingApprovals.set(requestId, topicId);
      await sendApprovalRequest(channel, chunk.text, requestId);
      setTimeout(() => {
        if (this.pendingApprovals.has(requestId)) {
          this.pendingApprovals.delete(requestId);
          proc.deny();
          channel.send("\u23f0 Approval timed out, auto-denied.").catch(() => {});
        }
      }, 5 * 60 * 1000);
    };

    const onSession = (sessionId: string) => {
      this.sessions.updateSession(topicId, sessionId, proc.pid ?? 0);
    };

    const onExit = async () => {
      proc.removeListener("data", onData);
      proc.removeListener("approval", onApproval);
      proc.removeListener("session", onSession);
      if (streamState.buffer) {
        const formatted = formatForDiscord(streamState.buffer);
        try {
          if (formatted.attachment) {
            const attachment = new AttachmentBuilder(
              Buffer.from(formatted.attachment.content),
              { name: formatted.attachment.name }
            );
            await channel.send({ content: formatted.messages[0], files: [attachment] });
          } else if (streamState.messageId) {
            const existing = await channel.messages.fetch(streamState.messageId);
            await existing.edit(formatted.messages[0]);
          }
        } catch { /* channel may be gone */ }
        this.memory.addConversation({
          topicId,
          role: "assistant",
          content: streamState.buffer,
        });
      }
      this.sessions.setStatus(topicId, "idle");
    };

    proc.on("data", onData);
    proc.on("approval", onApproval);
    proc.on("session", onSession);
    proc.once("exit", onExit);

    proc.send(msg.content);
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseButtonAction(interaction.customId);
    if (!parsed) return;
    const topicId = this.pendingApprovals.get(parsed.requestId);
    if (!topicId) {
      await interaction.reply({ content: "Request expired", ephemeral: true });
      return;
    }
    this.pendingApprovals.delete(parsed.requestId);
    const proc = this.pool.get(topicId);
    if (proc) {
      if (parsed.action === "approve") {
        proc.approve();
        await interaction.update({ content: "\u2705 Approved", components: [] });
      } else {
        proc.deny();
        await interaction.update({ content: "\u274c Denied", components: [] });
      }
    }
  }

  private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: "Unknown command", ephemeral: true });
      return;
    }
    try {
      await command.execute(interaction, {
        sessions: this.sessions,
        memory: this.memory,
        pool: this.pool,
        forum: this.forum,
        config: this.config,
      });
    } catch (err) {
      console.error(`Command error [${interaction.commandName}]:`, err);
      const content = "An error occurred while executing that command.";
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content, ephemeral: true }).catch(() => {});
      }
    }
  }

  async stop(): Promise<void> {
    this.pool.stopAll();
    this.sessions.close();
    this.memory.close();
    await this.gateway.stop();
  }
}

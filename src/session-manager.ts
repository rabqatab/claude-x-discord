import { type Message, type ButtonInteraction, type ChatInputCommandInteraction, type AutocompleteInteraction, type ThreadChannel, AttachmentBuilder } from "discord.js";
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
import { shouldAutoLearn, extractFacets, runAggregation } from "./memory/evolution.js";
import { getSystemPromptContext } from "./memory/persona.js";
import { createLogger, type Logger } from "./utils/logger.js";
import { randomUUID } from "node:crypto";
import { mkdirSync, statSync, readFileSync } from "node:fs";
import { resolve, normalize } from "node:path";

export class SessionManager {
  private gateway: DiscordGateway;
  private forum: ForumManager;
  private pool: ClaudePool;
  private sessions: SessionsDB;
  private memory: MemoryDB;
  private commands!: CommandRegistry;
  private pendingApprovals = new Map<string, string>();
  private debateContext = new Map<string, string>();
  // Per-topic message queue: if Claude is running, queue follow-ups instead of killing
  private messageQueue = new Map<string, Message[]>();
  private _webServer?: import("./web/server.js").WebChatServer;
  private rcProcesses = new Map<string, import("node:child_process").ChildProcess>();

  constructor(
    private config: Config,
    private env: Env
  ) {
    const dataDir = resolve(
      process.env.CLAUDE_X_DISCORD_HOME || process.cwd(),
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
  set webServer(ws: import("./web/server.js").WebChatServer) { this._webServer = ws; }

  async start(): Promise<void> {
    this.commands = await createCommandRegistry();

    this.gateway.on("ready", async () => {
      console.log("Discord connected");
      await this.forum.init().catch(console.error);

      // Set presence to show machine name
      this.gateway.client.user?.setPresence({
        activities: [{ name: `[${this.config.machine_name}]`, type: 4 }],
        status: "online",
      });

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
    this.gateway.on("autocomplete", (interaction: AutocompleteInteraction) =>
      this.handleAutocomplete(interaction)
    );

    await this.gateway.start();
  }

  private async handleMessage(msg: Message): Promise<void> {
    const topicId = msg.channelId;
    console.log(`[msg] channelId=${topicId} content="${msg.content.slice(0, 80)}"`);

    const project = this.sessions.getProjectByTopicId(topicId);
    if (!project) {
      console.log(`[msg] no project found for topicId=${topicId}`);
      return;
    }
    const label = `${this.config.machine_name}:${project.project_name}`;
    const log: Logger = createLogger(this.config.machine_name, project.project_name);
    log.log("msg", `topicId=${topicId} path=${project.project_path}`);

    this.memory.addConversation({
      topicId,
      role: "user",
      content: msg.content,
    });

    // If Claude is already running for this topic, queue instead of killing
    const existingProc = this.pool.get(topicId);
    if (existingProc?.isAlive) {
      const queue = this.messageQueue.get(topicId) || [];
      queue.push(msg);
      this.messageQueue.set(topicId, queue);
      const channel = msg.channel as ThreadChannel;
      await channel.send(`⏳ Processing previous request... your message has been queued (#${queue.length}).`).catch(() => {});
      log.log("msg", `queued (${queue.length} pending) — Claude is still running`);
      return;
    }

    // Inject debate context if available
    let prompt = msg.content;
    const debateCtx = this.debateContext.get(topicId);
    if (debateCtx) {
      prompt = `[Previous debate results for context]\n${debateCtx}\n\n[User's follow-up question]\n${msg.content}`;
      this.debateContext.delete(topicId);
      log.log("msg", `injected debate context (${debateCtx.length} chars)`);
    }

    // Inject long-term memory (persona context)
    const personaContext = getSystemPromptContext();
    if (personaContext) {
      prompt = `[Long-term memory]\n${personaContext}\n\n${prompt}`;
      log.log("msg", `injected persona context (${personaContext.length} chars)`);
    }

    // Inject Discord remote context — Claude must know it's communicating via Discord
    prompt = `[System context]\nYou are communicating with the user via Discord. The user is on a remote device and CANNOT see your terminal, editor, or local filesystem output. ALL content (file contents, code, results) MUST be included directly in your text response. NEVER suggest commands like cat, pbcopy, open, or refer to "terminal output" — the user cannot access it. If content is long, send it in parts.\n\nWhen the user asks you to SEND a file (e.g. "send me X", "attach X", "give me the file X"), output the marker <<<ATTACH:/absolute/path/to/file>>> on its own line. The system will read the file from disk and deliver it as a Discord attachment. You may include multiple markers for multiple files. Only use absolute paths within the project directory.\n\nYou are running non-interactively via -p flag, so Claude Code slash commands like /rc (Remote Control) are unavailable. The following Discord slash commands exist but can ONLY be typed by the user directly in the Discord channel — you cannot execute them: /register, /unregister, /projects, /status, /stop, /reset, /debate, /rc (web chat URL), /remember, /recall, /health, /help. If the user asks about these, tell them to type the command directly.\n\n${prompt}`;

    let proc;
    try {
      proc = this.pool.run(topicId, prompt, {
        cwd: project.project_path,
        sessionId: project.session_id ?? undefined,
        label,
      });
      log.log("claude", `running pid=${proc.pid} sessionId=${proc.sessionId}`);
    } catch (err) {
      log.error("claude", `run failed: ${err}`);
      await (msg.channel as ThreadChannel).send("Failed to start Claude process.").catch(() => {});
      return;
    }

    proc.on("error", (err: string) => {
      log.error("claude", `stderr: ${err}`);
    });

    if (proc.pid) {
      this.sessions.updateSession(topicId, proc.sessionId ?? "", proc.pid);
      this.sessions.setStatus(topicId, "running");
    }

    const channel = msg.channel as ThreadChannel;
    await channel.sendTyping();

    const streamState = {
      buffer: "",
      messageId: null as string | null,
      lastEdit: 0,
    };

    const onData = async (chunk: StreamChunk) => {
      log.log("stream", `chunk: "${chunk.text.slice(0, 100)}" complete=${chunk.isComplete} approval=${chunk.isApproval}`);
      if (chunk.isComplete && chunk.text) {
        // Result message — replace buffer with authoritative final text
        streamState.buffer = chunk.text;
      } else {
        streamState.buffer += chunk.text;
      }
      const now = Date.now();
      if (now - streamState.lastEdit < this.config.claude.streaming_debounce) return;
      streamState.lastEdit = now;
      try {
        let preview = streamState.buffer.replace(/<<<ATTACH:\/[^>]+>>>/g, "").slice(0, 1900);
        if (streamState.buffer.length > 1900) {
          preview += `\n\n_... generating (${streamState.buffer.length.toLocaleString()} chars so far)_`;
        }
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

    const onExit = async (code: number | null) => {
      log.log("claude", `exited code=${code} buffer=${streamState.buffer.length} chars`);
      proc.removeListener("data", onData);
      proc.removeListener("approval", onApproval);
      proc.removeListener("session", onSession);

      // Extract file attachment markers
      const attachMarkerRe = /<<<ATTACH:(\/[^>]+)>>>/g;
      const fileAttachments: AttachmentBuilder[] = [];
      const projectRoot = normalize(project.project_path);
      let match: RegExpExecArray | null;
      while ((match = attachMarkerRe.exec(streamState.buffer)) !== null) {
        if (fileAttachments.length >= 10) break;
        const filePath = normalize(match[1]);
        if (!filePath.startsWith(projectRoot)) {
          log.log("attach", `rejected (outside project): ${filePath}`);
          continue;
        }
        try {
          const stat = statSync(filePath);
          if (!stat.isFile() || stat.size > 25 * 1024 * 1024) {
            log.log("attach", `rejected (not file or >25MB): ${filePath}`);
            continue;
          }
          fileAttachments.push(new AttachmentBuilder(readFileSync(filePath), {
            name: filePath.split("/").pop() || "file",
          }));
          log.log("attach", `queued: ${filePath} (${stat.size} bytes)`);
        } catch {
          log.log("attach", `rejected (read error): ${filePath}`);
        }
      }
      // Strip markers from buffer
      streamState.buffer = streamState.buffer.replace(/<<<ATTACH:\/[^>]+>>>/g, "").trim();

      if (streamState.buffer) {
        const formatted = formatForDiscord(streamState.buffer);
        try {
          // Send the first part: edit existing streaming message or send new
          let startIdx = 0;
          if (formatted.messages.length > 0) {
            if (streamState.messageId) {
              const existing = await channel.messages.fetch(streamState.messageId);
              await existing.edit(formatted.messages[0]);
            } else {
              await channel.send(formatted.messages[0]);
            }
            startIdx = 1;
          }
          // Send additional parts as new messages
          for (let i = startIdx; i < formatted.messages.length; i++) {
            await channel.send(formatted.messages[i]);
          }
          // Send attachment if present
          if (formatted.attachment) {
            const attachment = new AttachmentBuilder(
              Buffer.from(formatted.attachment.content),
              { name: formatted.attachment.name }
            );
            await channel.send({ files: [attachment] });
          }
          // Send file attachments from <<<ATTACH:...>>> markers
          if (fileAttachments.length > 0) {
            await channel.send({ files: fileAttachments });
          }
        } catch { /* channel may be gone */ }
        this.memory.addConversation({
          topicId,
          role: "assistant",
          content: streamState.buffer,
        });

        // Auto-learn: 2-stage facet extraction + aggregation
        const convCount = this.memory.getConversationCount(topicId);
        if (shouldAutoLearn(convCount, this.config.memory.facet_interval)) {
          this.runAutoLearn(topicId, project).catch((err) =>
            log.error("auto-learn", `${err}`)
          );
        }
      }
      this.sessions.setStatus(topicId, "idle");

      // Process queued messages (take the LAST one — most recent intent)
      const queue = this.messageQueue.get(topicId);
      if (queue && queue.length > 0) {
        const nextMsg = queue[queue.length - 1];  // Latest message = latest intent
        this.messageQueue.delete(topicId);
        log.log("msg", `dequeuing message (dropped ${queue.length - 1} older queued)`);
        // Process asynchronously — don't block exit handler
        this.handleMessage(nextMsg).catch((err) =>
          log.error("msg", `failed to process queued message: ${err}`)
        );
      }
    };

    proc.on("data", onData);
    proc.on("approval", onApproval);
    proc.on("session", onSession);
    proc.once("exit", onExit);
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
        debateContext: this.debateContext,
        webServer: this._webServer,
        rcProcesses: this.rcProcesses,
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

  private async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);
    if (!command?.autocomplete) return;
    try {
      await command.autocomplete(interaction, {
        sessions: this.sessions,
        memory: this.memory,
        pool: this.pool,
        forum: this.forum,
        config: this.config,
        debateContext: this.debateContext,
        webServer: this._webServer,
        rcProcesses: this.rcProcesses,
      });
    } catch (err) {
      console.error(`Autocomplete error [${interaction.commandName}]:`, err);
    }
  }

  private async runAutoLearn(
    topicId: string,
    project: { project_name: string; project_path: string }
  ): Promise<void> {
    const timeoutMs = this.config.memory.analysis_timeout * 1000;

    // Stage 1: Extract facets
    const autoLearnLabel = `${this.config.machine_name}:${project.project_name}`;
    const facet = await extractFacets(
      topicId,
      project.project_name,
      project.project_path,
      this.memory,
      timeoutMs,
      autoLearnLabel
    );

    if (!facet) return;

    // Stage 2: Run aggregation if enough facets accumulated
    const aggregation = await runAggregation(
      this.memory,
      this.config.memory.aggregation_threshold,
      timeoutMs,
      autoLearnLabel
    );

    if (!aggregation) return;

    // Send Discord notification with workflow suggestions
    const notifications: string[] = [];
    if (aggregation.recurring_friction.length > 0) {
      notifications.push(
        `**Recurring friction:**\n${aggregation.recurring_friction.map((f) => `- ${f}`).join("\n")}`
      );
    }
    if (aggregation.workflow_suggestions.length > 0) {
      notifications.push(
        `**Workflow suggestions:**\n${aggregation.workflow_suggestions.map((s) => `- ${s}`).join("\n")}`
      );
    }
    if (aggregation.claude_md_recommendations.length > 0) {
      notifications.push(
        `**CLAUDE.md recommendations:**\n${aggregation.claude_md_recommendations.map((r) => `- ${r}`).join("\n")}`
      );
    }

    if (notifications.length > 0) {
      try {
        const channel = this.gateway.client.channels.cache.get(topicId);
        if (channel && "send" in channel) {
          await (channel as ThreadChannel).send(
            `\u{1f9e0} **Auto-learning aggregation complete**\n\n${notifications.join("\n\n")}`
          );
        }
      } catch (err) {
        console.error(`[auto-learn|${this.config.machine_name}:${project.project_name}] failed to send Discord notification:`, err);
      }
    }
  }

  async stop(): Promise<void> {
    for (const [id, proc] of this.rcProcesses) {
      proc.kill("SIGTERM");
      this.rcProcesses.delete(id);
    }
    this.pool.stopAll();
    this.sessions.close();
    this.memory.close();
    await this.gateway.stop();
  }
}

import { SlashCommandBuilder, type ChatInputCommandInteraction, AttachmentBuilder } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";
import { runDebate } from "../debate/index.js";
import { loadEnv } from "../config/index.js";
import { splitMessage } from "../formatter/index.js";

const DISCORD_MAX = 2000;

const AI_HEADERS: Record<string, string> = {
  Claude: "**Claude**",
  Gemini: "**Gemini**",
  Codex: "**Codex**",
};

const data = new SlashCommandBuilder()
  .setName("debate")
  .setDescription("Run a multi-AI debate on a question about the current project")
  .addStringOption((opt) =>
    opt.setName("question").setDescription("The question to debate").setRequired(true)
  ) as SlashCommandBuilder;

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  // Defer immediately — Discord gives only 3 seconds
  await interaction.deferReply();

  const topicId = interaction.channelId;
  const project = ctx.sessions.getProjectByTopicId(topicId);

  if (!project) {
    await interaction.editReply("This channel is not a registered project topic.");
    return;
  }

  const question = interaction.options.getString("question", true);

  try {
    const env = loadEnv();
    const label = `${ctx.config.machine_name}:${project.project_name}`;
    const responses = await runDebate(
      { question, projectPath: project.project_path, label },
      ctx.config,
      env
    );

    // Store debate results as context for follow-up messages
    const debateSummary = responses
      .map(r => `=== ${r.ai} ===\n${r.error ? `Error: ${r.error}` : r.response}`)
      .join("\n\n");
    ctx.debateContext.set(topicId, `Question: ${question}\n\n${debateSummary}`);
    setTimeout(() => { ctx.debateContext.delete(topicId); }, 10 * 60 * 1000);

    // First message: the question as header
    const header = `**Debate:** ${question}`;
    await interaction.editReply(header);
    const channel = interaction.channel;
    if (!channel || !("send" in channel)) return;

    // Send each AI's response as regular messages (no embed boxes)
    for (const r of responses) {
      const aiHeader = AI_HEADERS[r.ai] || `**${r.ai}**`;

      if (r.error) {
        await channel.send(`${aiHeader}\nError: ${r.error.slice(0, 1900)}`);
        continue;
      }

      const fullText = `${aiHeader}\n${r.response}`;
      const parts = splitMessage(fullText, DISCORD_MAX);

      // If too many parts (>8), send first 3 + attachment
      if (parts.length > 8) {
        for (const part of parts.slice(0, 3)) {
          await channel.send(part);
        }
        const attachment = new AttachmentBuilder(
          Buffer.from(r.response),
          { name: `${r.ai.toLowerCase()}-response.md` }
        );
        await channel.send({ content: `_... ${r.ai} full response attached_`, files: [attachment] });
      } else {
        for (const part of parts) {
          await channel.send(part);
        }
      }
    }
  } catch (err) {
    console.error("[debate] error:", err);
    await interaction.editReply("Debate failed. Check logs for details.").catch(() => {});
  }
}

export const debateCommand: Command = { data, execute };

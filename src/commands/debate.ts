import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";
import { assembleContext, gatherProjectFacts, runDebate } from "../debate/index.js";
import { loadEnv } from "../config/index.js";

const data = new SlashCommandBuilder()
  .setName("debate")
  .setDescription("Run a multi-AI debate on a question about the current project")
  .addStringOption((opt) =>
    opt.setName("question").setDescription("The question to debate").setRequired(true)
  ) as SlashCommandBuilder;

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const topicId = interaction.channelId;
  const project = ctx.sessions.getProjectByTopicId(topicId);

  if (!project) {
    await interaction.reply({ content: "This channel is not a registered project topic.", ephemeral: true });
    return;
  }

  const question = interaction.options.getString("question", true);

  await interaction.deferReply();

  const facts = gatherProjectFacts(project.project_path);
  const context = assembleContext({
    projectFacts: facts,
    claudeSummary: `Project: ${project.project_name} at ${project.project_path}`,
    question,
  });

  const env = loadEnv();
  const responses = await runDebate(context, ctx.config, env);

  const embed = new EmbedBuilder()
    .setTitle(`Debate: ${question.slice(0, 200)}`)
    .setColor(0x5865f2)
    .setTimestamp();

  for (const r of responses) {
    const value = r.error
      ? `Error: ${r.error.slice(0, 500)}`
      : r.response.slice(0, 1000);
    embed.addFields({ name: r.ai, value: value || "(empty response)" });
  }

  await interaction.editReply({ embeds: [embed] });
}

export const debateCommand: Command = { data, execute };

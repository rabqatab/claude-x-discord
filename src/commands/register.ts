import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";
import { existsSync } from "node:fs";

const data = new SlashCommandBuilder()
  .setName("register")
  .setDescription("Register a project and create a Forum Topic")
  .addStringOption((opt) =>
    opt.setName("name").setDescription("Project name").setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName("path").setDescription("Absolute path to project directory").setRequired(true)
  ) as SlashCommandBuilder;

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const name = interaction.options.getString("name", true);
  const projectPath = interaction.options.getString("path", true);

  if (!existsSync(projectPath)) {
    await interaction.reply({ content: `Path \`${projectPath}\` does not exist.`, ephemeral: true });
    return;
  }

  const existing = ctx.sessions.getProjectByName(name);
  if (existing) {
    await interaction.reply({ content: `Project \`${name}\` is already registered.`, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const thread = await ctx.forum.createTopic(
    name,
    `Project registered: **${name}**\nPath: \`${projectPath}\``
  );

  ctx.sessions.registerProject({
    forumTopicId: thread.id,
    projectName: name,
    projectPath,
  });

  await interaction.editReply(`Registered project **${name}** in <#${thread.id}>`);
}

export const registerCommand: Command = { data, execute };

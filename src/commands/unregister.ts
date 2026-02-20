import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";

const data = new SlashCommandBuilder()
  .setName("unregister")
  .setDescription("Unregister a project, kill its process, and archive its topic")
  .addStringOption((opt) =>
    opt.setName("name").setDescription("Project name").setRequired(true)
  ) as SlashCommandBuilder;

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const name = interaction.options.getString("name", true);
  const project = ctx.sessions.getProjectByName(name);

  if (!project) {
    await interaction.reply({ content: `Project \`${name}\` not found.`, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  ctx.pool.kill(project.forum_topic_id);
  await ctx.forum.archiveTopic(project.forum_topic_id);
  ctx.sessions.unregisterProject(name);

  await interaction.editReply(`Unregistered project **${name}** and archived its topic.`);
}

export const unregisterCommand: Command = { data, execute };

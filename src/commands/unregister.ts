import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";

const data = new SlashCommandBuilder()
  .setName("unregister")
  .setDescription("Unregister a project, kill its process, and archive its topic")
  .addStringOption((opt) =>
    opt.setName("name").setDescription("Project name").setRequired(true)
  ) as SlashCommandBuilder;

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const name = interaction.options.getString("name", true).trim();

  // Case-insensitive lookup
  const allProjects = ctx.sessions.listProjects();
  const project = allProjects.find(p => p.project_name.toLowerCase() === name.toLowerCase());

  if (!project) {
    // Suggest similar names
    const suggestions = allProjects
      .filter(p => p.project_name.toLowerCase().includes(name.toLowerCase()) ||
                   name.toLowerCase().includes(p.project_name.toLowerCase()))
      .map(p => `\`${p.project_name}\``);
    let msg = `Project \`${name}\` not found.`;
    if (suggestions.length > 0) {
      msg += `\nDid you mean? ${suggestions.join(", ")}`;
    }
    await interaction.reply({ content: msg, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  ctx.pool.kill(project.forum_topic_id);
  await ctx.forum.archiveTopic(project.forum_topic_id);
  ctx.sessions.unregisterProject(project.project_name); // Use actual stored name

  await interaction.editReply(`Unregistered project **${project.project_name}** and archived its topic.`);
}

export const unregisterCommand: Command = { data, execute };

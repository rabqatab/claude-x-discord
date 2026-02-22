import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";

const statusIcons: Record<string, string> = {
  idle: "  idle",
  running: "  running",
  error: "  error",
};

const data = new SlashCommandBuilder()
  .setName("projects")
  .setDescription("List all registered projects with status");

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const projects = ctx.sessions.listProjects();

  if (projects.length === 0) {
    await interaction.reply({ content: "No projects registered yet. Use `/register` to add one.", ephemeral: true });
    return;
  }

  const machine = ctx.config.machine_name;
  const embed = new EmbedBuilder()
    .setTitle(`Registered Projects [${machine}]`)
    .setColor(0x5865f2)
    .setDescription(
      projects
        .map((p) => {
          const icon = statusIcons[p.status] ?? p.status;
          return `${icon} **${p.project_name}**\n  \`${p.project_path}\`\n  Topic: <#${p.forum_topic_id}>`;
        })
        .join("\n\n")
    )
    .setFooter({ text: `${projects.length} project(s)` });

  await interaction.reply({ embeds: [embed] });
}

export const projectsCommand: Command = { data, execute };

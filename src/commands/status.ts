import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";

const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Show system status with active process count");

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const projects = ctx.sessions.listProjects();
  const active = ctx.pool.listActive();

  const embed = new EmbedBuilder()
    .setTitle("System Status")
    .setColor(active.length > 0 ? 0x57f287 : 0x99aab5)
    .addFields(
      { name: "Registered Projects", value: String(projects.length), inline: true },
      { name: "Active Processes", value: String(active.length), inline: true },
      { name: "Max Processes", value: String(ctx.config.claude.max_processes), inline: true },
      { name: "Idle Timeout", value: `${ctx.config.claude.idle_timeout}s`, inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

export const statusCommand: Command = { data, execute };

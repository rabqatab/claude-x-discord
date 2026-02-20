import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";

const categories: Record<string, string[]> = {
  "Project Management": ["register", "unregister", "projects"],
  "Session Control": ["stop", "reset", "status"],
  "AI Features": ["debate", "remember", "recall"],
  "System": ["health", "help"],
};

const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show all commands or details for a specific command")
  .addStringOption((opt) =>
    opt.setName("command").setDescription("Command name to get details for").setRequired(false)
  ) as SlashCommandBuilder;

async function execute(interaction: ChatInputCommandInteraction, _ctx: CommandContext): Promise<void> {
  const commandName = interaction.options.getString("command");

  if (commandName) {
    const embed = new EmbedBuilder()
      .setTitle(`/${commandName}`)
      .setColor(0x5865f2)
      .setDescription(`Use \`/${commandName}\` in Discord. Run \`/help\` to see all commands.`);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("claude-x-discord Commands")
    .setColor(0x5865f2);

  for (const [category, commands] of Object.entries(categories)) {
    embed.addFields({
      name: category,
      value: commands.map((c) => `\`/${c}\``).join(", "),
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export const helpCommand: Command = { data, execute };

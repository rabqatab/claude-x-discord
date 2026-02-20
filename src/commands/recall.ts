import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";

const data = new SlashCommandBuilder()
  .setName("recall")
  .setDescription("Search memory using full-text search")
  .addStringOption((opt) =>
    opt.setName("query").setDescription("Search query").setRequired(true)
  ) as SlashCommandBuilder;

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const query = interaction.options.getString("query", true);
  const results = ctx.memory.search(query, 10);

  if (results.length === 0) {
    await interaction.reply({ content: `No memories found for "${query}".`, ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`Recall: "${query}"`)
    .setColor(0x5865f2)
    .setDescription(
      results
        .map((r, i) => `**${i + 1}.** ${r.value}\n  _confidence: ${r.confidence.toFixed(2)} | source: ${r.source}_`)
        .join("\n\n")
    )
    .setFooter({ text: `${results.length} result(s)` });

  await interaction.reply({ embeds: [embed] });
}

export const recallCommand: Command = { data, execute };

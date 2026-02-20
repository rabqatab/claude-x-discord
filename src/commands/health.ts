import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { execSync } from "node:child_process";
import { type Command, type CommandContext } from "./registry.js";

interface CliStatus {
  name: string;
  available: boolean;
  version: string;
}

function checkCli(name: string, command: string): CliStatus {
  try {
    const version = execSync(`${command} --version`, { encoding: "utf-8", timeout: 5000 }).trim();
    return { name, available: true, version };
  } catch {
    return { name, available: false, version: "not found" };
  }
}

const data = new SlashCommandBuilder()
  .setName("health")
  .setDescription("Check CLI availability for Claude, Gemini, and Codex");

async function execute(interaction: ChatInputCommandInteraction, _ctx: CommandContext): Promise<void> {
  const checks = [
    checkCli("Claude", "claude"),
    checkCli("Gemini", "gemini"),
    checkCli("Codex", "codex"),
  ];

  const allGood = checks.every((c) => c.available);

  const embed = new EmbedBuilder()
    .setTitle("Health Check")
    .setColor(allGood ? 0x57f287 : 0xed4245)
    .setDescription(
      checks
        .map((c) => `${c.available ? "OK" : "FAIL"} **${c.name}**: ${c.version}`)
        .join("\n")
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

export const healthCommand: Command = { data, execute };

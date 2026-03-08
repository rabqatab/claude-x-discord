import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";

const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Stop the Claude process and/or Remote Control for the current topic");

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const topicId = interaction.channelId;
  const project = ctx.sessions.getProjectByTopicId(topicId);

  if (!project) {
    await interaction.reply({ content: "This channel is not a registered project topic.", ephemeral: true });
    return;
  }

  const proc = ctx.pool.get(topicId);
  const hasPool = proc?.isAlive ?? false;
  const hasRc = ctx.rcProcesses.has(topicId);

  if (!hasPool && !hasRc) {
    await interaction.reply({ content: "No active process or Remote Control for this topic.", ephemeral: true });
    return;
  }

  const stopped: string[] = [];

  if (hasPool) {
    ctx.pool.kill(topicId);
    ctx.sessions.setStatus(topicId, "idle");
    stopped.push("Claude process");
  }

  if (hasRc) {
    const rcProc = ctx.rcProcesses.get(topicId)!;
    rcProc.kill("SIGTERM");
    ctx.rcProcesses.delete(topicId);
    stopped.push("Remote Control session");
  }

  await interaction.reply(`Stopped ${stopped.join(" and ")} for this topic.`);
}

export const stopCommand: Command = { data, execute };

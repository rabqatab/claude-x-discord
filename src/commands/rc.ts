import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";
import { spawnRemoteControl } from "../claude/remote-control.js";

const data = new SlashCommandBuilder()
  .setName("rc")
  .setDescription("Start a Claude Code Remote Control session for this project");

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const topicId = interaction.channelId;
  const project = ctx.sessions.getProjectByTopicId(topicId);
  if (!project) {
    await interaction.reply({ content: "No project registered in this topic.", ephemeral: true });
    return;
  }

  if (ctx.rcProcesses.has(topicId)) {
    await interaction.reply({ content: "Remote Control is already active for this topic. Use `/stop` to end it first.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const { process: proc, url } = await spawnRemoteControl(project.project_path, project.project_name);
    ctx.rcProcesses.set(topicId, proc);

    proc.on("exit", () => {
      ctx.rcProcesses.delete(topicId);
    });

    await interaction.editReply(
      `**Remote Control** for **${project.project_name}**\n${url}\n\n_Open this URL on your phone or any browser for full Claude Code UI.\nUse \`/stop\` to end the session._`
    );
  } catch (err) {
    await interaction.editReply(`Failed to start Remote Control: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export const rcCommand: Command = { data, execute };

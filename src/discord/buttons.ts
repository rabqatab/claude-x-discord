import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";

export function createApprovalButtons(requestId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve:${requestId}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success)
      .setEmoji("\u2705"),
    new ButtonBuilder()
      .setCustomId(`deny:${requestId}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("\u274c")
  );
}

export function parseButtonAction(
  customId: string
): { action: "approve" | "deny"; requestId: string } | null {
  const match = customId.match(/^(approve|deny):(.+)$/);
  if (!match) return null;
  return { action: match[1] as "approve" | "deny", requestId: match[2] };
}

export async function sendApprovalRequest(
  channel: TextChannel | ThreadChannel,
  description: string,
  requestId: string
): Promise<void> {
  const row = createApprovalButtons(requestId);
  await channel.send({
    content: `\u26a0\ufe0f **Approval Required**\n\`\`\`\n${description}\n\`\`\``,
    components: [row],
  });
}

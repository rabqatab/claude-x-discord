const DISCORD_MAX = 2000;
const PREVIEW_LENGTH = 1500;

const TOOL_ICONS: Record<string, string> = {
  Edit: "\u270f\ufe0f",
  Write: "\ud83d\udcdd",
  Read: "\ud83d\udcd6",
  Bash: "\ud83d\udcbb",
  Grep: "\ud83d\udd0d",
  Glob: "\ud83d\udcc2",
  Task: "\ud83d\udce6",
};

export interface FormattedOutput {
  messages: string[];
  attachment: { name: string; content: string } | null;
}

export function formatForDiscord(text: string): FormattedOutput {
  const formatted = formatToolUsage(text);

  if (formatted.length <= DISCORD_MAX) {
    return { messages: [formatted], attachment: null };
  }

  const preview = formatted.slice(0, PREVIEW_LENGTH) + "\n\n_... full output attached_";
  return {
    messages: [preview],
    attachment: {
      name: `output-${Date.now()}.md`,
      content: formatted,
    },
  };
}

export function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const parts: string[] = [];
  let remaining = text;
  let inCodeBlock = false;
  let codeLang = "";

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      parts.push(remaining);
      break;
    }

    let splitAt = maxLen;
    const chunk = remaining.slice(0, maxLen);

    const lastNewline = chunk.lastIndexOf("\n");
    if (lastNewline > maxLen * 0.5) {
      splitAt = lastNewline + 1;
    }

    let part = remaining.slice(0, splitAt);

    const codeBlocks = part.match(/```/g);
    if (codeBlocks && codeBlocks.length % 2 !== 0) {
      part += "\n```";
      inCodeBlock = true;
      const langMatch = part.match(/```(\w+)/);
      codeLang = langMatch ? langMatch[1] : "";
    }

    parts.push(part);
    remaining = remaining.slice(splitAt);

    if (inCodeBlock) {
      remaining = "```" + codeLang + "\n" + remaining;
      inCodeBlock = false;
    }
  }

  return parts;
}

function formatToolUsage(text: string): string {
  return text.replace(/\[tool:\s*(\w+)\s*(?:file:\s*(\S+))?\s*(?:lines?\s*(\S+))?\]/g,
    (_match, tool: string, file?: string, lines?: string) => {
      const icon = TOOL_ICONS[tool] || "\ud83d\udd27";
      let result = `${icon} **${tool}**`;
      if (file) result += ` \`${file}\``;
      if (lines) result += ` ${lines}`;
      return result;
    }
  );
}

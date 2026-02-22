const DISCORD_MAX = 2000;

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
  let formatted = formatToolUsage(text);
  formatted = convertTablesForDiscord(formatted);
  formatted = cleanForDiscord(formatted);

  // Split into multiple messages
  const parts = splitMessage(formatted, DISCORD_MAX);

  // If too many parts (>5), send first 2 + attachment
  if (parts.length > 5) {
    const preview = parts.slice(0, 2);
    preview[preview.length - 1] += "\n\n_... full output attached_";
    return {
      messages: preview,
      attachment: {
        name: `output-${Date.now()}.md`,
        content: text,  // Original markdown for the file
      },
    };
  }

  return { messages: parts, attachment: null };
}

/**
 * Convert markdown tables to monospace code blocks for Discord.
 * Discord doesn't render markdown tables at all.
 */
function convertTablesForDiscord(text: string): string {
  return text.replace(
    /(?:^|\n)((?:\|[^\n]+\|\n)+)/g,
    (_match, tableBlock: string) => {
      const rows = tableBlock.trim().split("\n");
      // Skip separator rows (|---|---|)
      const dataRows = rows.filter(r => !r.match(/^\|[\s\-:]+\|$/));
      if (dataRows.length === 0) return _match;
      return "\n```\n" + dataRows.join("\n") + "\n```\n";
    }
  );
}

/**
 * Clean up markdown for better Discord rendering.
 */
function cleanForDiscord(text: string): string {
  // Remove horizontal rules (Discord doesn't render them well)
  text = text.replace(/^---+$/gm, "");
  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
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

    // Try to split at a paragraph break first
    const lastDoubleNewline = chunk.lastIndexOf("\n\n");
    if (lastDoubleNewline > maxLen * 0.3) {
      splitAt = lastDoubleNewline + 1;
    } else {
      // Fall back to single newline
      const lastNewline = chunk.lastIndexOf("\n");
      if (lastNewline > maxLen * 0.5) {
        splitAt = lastNewline + 1;
      }
    }

    let part = remaining.slice(0, splitAt);

    // Handle unclosed code blocks
    const codeBlocks = part.match(/```/g);
    if (codeBlocks && codeBlocks.length % 2 !== 0) {
      part += "\n```";
      inCodeBlock = true;
      const langMatch = part.match(/```(\w+)/);
      codeLang = langMatch ? langMatch[1] : "";
    }

    parts.push(part.trim());
    remaining = remaining.slice(splitAt);

    if (inCodeBlock) {
      remaining = "```" + codeLang + "\n" + remaining;
      inCodeBlock = false;
    }
  }

  return parts.filter(p => p.length > 0);
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

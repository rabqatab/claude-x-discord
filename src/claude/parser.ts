const APPROVAL_PATTERNS = [
  /\(y\/n\)\s*$/i,
  /proceed\?/i,
  /allow .+ to run/i,
  /do you want to/i,
  /approve this/i,
];

const SESSION_PATTERN = /Session:\s+([a-f0-9-]+)/i;

export interface StreamChunk {
  text: string;
  isComplete: boolean;
  isApproval: boolean;
  sessionId: string | null;
  toolUse: string | null;
}

export function isApprovalRequest(text: string): boolean {
  return APPROVAL_PATTERNS.some((p) => p.test(text));
}

export function isSessionId(text: string): string | null {
  const match = text.match(SESSION_PATTERN);
  return match ? match[1] : null;
}

export function parseStreamChunk(text: string): StreamChunk {
  return {
    text,
    isComplete: false,
    isApproval: isApprovalRequest(text),
    sessionId: isSessionId(text),
    toolUse: extractToolUse(text),
  };
}

/** Parse a JSON stream line from `claude --output-format stream-json` */
export function parseJsonStreamChunk(line: string): StreamChunk {
  const json = JSON.parse(line);

  // stream-json emits objects like:
  // {"type":"system","subtype":"init","session_id":"..."}
  // {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
  // {"type":"result","subtype":"success","session_id":"...","result":"..."}

  let text = "";
  let sessionId: string | null = null;
  let isComplete = false;
  let isApproval = false;
  let toolUse: string | null = null;

  if (json.type === "system" && json.session_id) {
    sessionId = json.session_id;
  }

  if (json.type === "result") {
    isComplete = true;
    sessionId = json.session_id ?? null;
    text = typeof json.result === "string" ? json.result : "";
  }

  if (json.type === "assistant" && json.message?.content) {
    // Don't emit text here — it duplicates content_block_delta events.
    // Only extract tool_use info.
    const parts = json.message.content;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part.type === "tool_use") {
          toolUse = part.name ?? null;
        }
      }
    }
  }

  // Content block delta (streaming text)
  if (json.type === "content_block_delta" && json.delta?.text) {
    text = json.delta.text;
  }

  // Content block start with text
  if (json.type === "content_block_start" && json.content_block?.text) {
    text = json.content_block.text;
  }

  if (text) {
    isApproval = isApprovalRequest(text);
  }

  return { text, isComplete, isApproval, sessionId, toolUse };
}

function extractToolUse(text: string): string | null {
  const match = text.match(/\[tool:\s*(\w+)/);
  return match ? match[1] : null;
}

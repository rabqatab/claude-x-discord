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

function extractToolUse(text: string): string | null {
  const match = text.match(/\[tool:\s*(\w+)/);
  return match ? match[1] : null;
}

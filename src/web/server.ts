import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { randomUUID } from "node:crypto";
import { ClaudePool } from "../claude/pool.js";
import { SessionsDB } from "../db/sessions.js";
import { type StreamChunk } from "../claude/parser.js";
import { type Config } from "../config/schema.js";
import { getSystemPromptContext } from "../memory/persona.js";

interface TokenEntry {
  topicId: string;
  userId: string;
  expiresAt: number;
}

interface SSEClient {
  res: ServerResponse;
  topicId: string;
}

export class WebChatServer {
  private server: ReturnType<typeof createServer> | null = null;
  private tokens = new Map<string, TokenEntry>();
  private sseClients = new Map<string, SSEClient[]>(); // topicId -> clients

  constructor(
    private pool: ClaudePool,
    private sessions: SessionsDB,
    private config: Config,
  ) {}

  createToken(topicId: string, userId: string): string {
    const token = randomUUID();
    this.tokens.set(token, {
      topicId,
      userId,
      expiresAt: Date.now() + this.config.web.token_ttl * 1000,
    });
    return token;
  }

  private validateToken(token: string): TokenEntry | null {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.tokens.delete(token);
      return null;
    }
    return entry;
  }

  getUrl(): string {
    const ip = this.getMachineIp();
    return `http://${ip}:${this.config.web.port}/rc`;
  }

  private getMachineIp(): string {
    const nets = networkInterfaces();
    for (const addrs of Object.values(nets)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === "IPv4" && !addr.internal) {
          return addr.address;
        }
      }
    }
    return "localhost";
  }

  async start(): Promise<void> {
    if (!this.config.web.enabled) return;

    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(this.config.web.port, () => {
      console.log(`Web chat server listening on port ${this.config.web.port}`);
    });
  }

  async stop(): Promise<void> {
    // Close all SSE connections
    for (const clients of this.sseClients.values()) {
      for (const client of clients) {
        client.res.end();
      }
    }
    this.sseClients.clear();

    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const token = url.searchParams.get("token");

    // CORS for same-origin
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!token) {
      this.sendJson(res, 400, { error: "Missing token" });
      return;
    }

    const entry = this.validateToken(token);
    if (!entry) {
      this.sendJson(res, 401, { error: "Invalid or expired token" });
      return;
    }

    const path = url.pathname;

    if (path === "/rc" && req.method === "GET") {
      this.serveChatPage(res, token);
    } else if (path === "/rc/send" && req.method === "POST") {
      await this.handleSend(req, res, entry, token);
    } else if (path === "/rc/stream" && req.method === "GET") {
      this.handleStream(res, entry, token);
    } else if (path === "/rc/approve" && req.method === "POST") {
      await this.handleApprove(req, res, entry);
    } else {
      this.sendJson(res, 404, { error: "Not found" });
    }
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  private async handleSend(
    req: IncomingMessage,
    res: ServerResponse,
    entry: TokenEntry,
    _token: string,
  ): Promise<void> {
    const body = await this.readBody(req);
    let parsed: { message: string };
    try {
      parsed = JSON.parse(body);
    } catch {
      this.sendJson(res, 400, { error: "Invalid JSON" });
      return;
    }

    if (!parsed.message?.trim()) {
      this.sendJson(res, 400, { error: "Empty message" });
      return;
    }

    const project = this.sessions.getProjectByTopicId(entry.topicId);
    if (!project) {
      this.sendJson(res, 404, { error: "Project not found" });
      return;
    }

    // Check if Claude is already running
    const existing = this.pool.get(entry.topicId);
    if (existing?.isAlive) {
      this.sendJson(res, 409, { error: "Claude is already processing a request" });
      return;
    }

    // Inject persona context
    let prompt = parsed.message;
    const personaContext = getSystemPromptContext();
    if (personaContext) {
      prompt = `[Long-term memory]\n${personaContext}\n\n${prompt}`;
    }
    prompt = `[System context]\nYou are communicating with the user via a web chat interface. Provide full, detailed responses without character limits. Use markdown formatting freely.\n\n${prompt}`;

    const label = `${this.config.machine_name}:${project.project_name}`;

    let proc;
    try {
      proc = this.pool.run(entry.topicId, prompt, {
        cwd: project.project_path,
        sessionId: project.session_id ?? undefined,
        label,
      });
    } catch {
      this.sendJson(res, 500, { error: "Failed to start Claude" });
      return;
    }

    if (proc.pid) {
      this.sessions.updateSession(entry.topicId, proc.sessionId ?? "", proc.pid);
      this.sessions.setStatus(entry.topicId, "running");
    }

    // Stream data to all SSE clients for this topic
    const onData = (chunk: StreamChunk) => {
      const clients = this.sseClients.get(entry.topicId) || [];
      const eventData = JSON.stringify({
        type: chunk.isComplete ? "complete" : "chunk",
        text: chunk.text,
      });
      for (const client of clients) {
        client.res.write(`data: ${eventData}\n\n`);
      }
    };

    const onApproval = (chunk: StreamChunk) => {
      const clients = this.sseClients.get(entry.topicId) || [];
      const eventData = JSON.stringify({
        type: "approval",
        text: chunk.text,
      });
      for (const client of clients) {
        client.res.write(`data: ${eventData}\n\n`);
      }
    };

    const onSession = (sessionId: string) => {
      this.sessions.updateSession(entry.topicId, sessionId, proc.pid ?? 0);
    };

    const onExit = () => {
      proc.removeListener("data", onData);
      proc.removeListener("approval", onApproval);
      proc.removeListener("session", onSession);
      this.sessions.setStatus(entry.topicId, "idle");

      const clients = this.sseClients.get(entry.topicId) || [];
      for (const client of clients) {
        client.res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      }
    };

    proc.on("data", onData);
    proc.on("approval", onApproval);
    proc.on("session", onSession);
    proc.once("exit", onExit);

    this.sendJson(res, 200, { status: "started" });
  }

  private handleStream(res: ServerResponse, entry: TokenEntry, _token: string): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    const clients = this.sseClients.get(entry.topicId) || [];
    clients.push({ res, topicId: entry.topicId });
    this.sseClients.set(entry.topicId, clients);

    res.on("close", () => {
      const remaining = (this.sseClients.get(entry.topicId) || []).filter(
        (c) => c.res !== res
      );
      if (remaining.length > 0) {
        this.sseClients.set(entry.topicId, remaining);
      } else {
        this.sseClients.delete(entry.topicId);
      }
    });
  }

  private async handleApprove(
    req: IncomingMessage,
    res: ServerResponse,
    entry: TokenEntry,
  ): Promise<void> {
    const body = await this.readBody(req);
    let parsed: { decision: "approve" | "deny" };
    try {
      parsed = JSON.parse(body);
    } catch {
      this.sendJson(res, 400, { error: "Invalid JSON" });
      return;
    }

    const proc = this.pool.get(entry.topicId);
    if (!proc?.isAlive) {
      this.sendJson(res, 404, { error: "No active process" });
      return;
    }

    if (parsed.decision === "approve") {
      proc.approve();
    } else {
      proc.deny();
    }

    this.sendJson(res, 200, { status: "ok" });
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => resolve(body));
    });
  }

  private serveChatPage(res: ServerResponse, token: string): void {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(this.getChatHtml(token));
  }

  private getChatHtml(token: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Claude Chat</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; height: 100dvh; display: flex; flex-direction: column; }
#header { padding: 12px 16px; background: #16213e; border-bottom: 1px solid #0f3460; font-weight: 600; font-size: 16px; flex-shrink: 0; }
#messages { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.msg { max-width: 90%; padding: 10px 14px; border-radius: 12px; line-height: 1.5; font-size: 15px; word-wrap: break-word; overflow-wrap: break-word; }
.msg pre { background: #0d1117; padding: 8px; border-radius: 6px; overflow-x: auto; margin: 6px 0; }
.msg code { font-family: 'SF Mono', Menlo, monospace; font-size: 13px; }
.msg p { margin: 4px 0; }
.msg ul, .msg ol { padding-left: 20px; margin: 4px 0; }
.user { align-self: flex-end; background: #0f3460; }
.assistant { align-self: flex-start; background: #222; }
.assistant.streaming { border-left: 3px solid #e94560; }
#approval { display: none; padding: 10px 16px; background: #2a1a0a; border: 1px solid #e94560; margin: 8px 16px; border-radius: 8px; text-align: center; }
#approval button { margin: 6px; padding: 8px 20px; border: none; border-radius: 6px; font-size: 15px; cursor: pointer; }
#approval .approve-btn { background: #27ae60; color: #fff; }
#approval .deny-btn { background: #c0392b; color: #fff; }
#input-area { display: flex; padding: 10px 12px; background: #16213e; border-top: 1px solid #0f3460; gap: 8px; flex-shrink: 0; }
#input { flex: 1; padding: 10px 14px; border: 1px solid #0f3460; border-radius: 20px; background: #1a1a2e; color: #e0e0e0; font-size: 15px; outline: none; resize: none; max-height: 120px; }
#input:focus { border-color: #e94560; }
#send-btn { padding: 10px 18px; background: #e94560; color: #fff; border: none; border-radius: 20px; font-size: 15px; cursor: pointer; }
#send-btn:disabled { opacity: 0.5; }
</style>
</head>
<body>
<div id="header">Claude Chat</div>
<div id="messages"></div>
<div id="approval">
  <div id="approval-text"></div>
  <button class="approve-btn" onclick="handleApproval('approve')">Approve</button>
  <button class="deny-btn" onclick="handleApproval('deny')">Deny</button>
</div>
<div id="input-area">
  <textarea id="input" rows="1" placeholder="Message Claude..." autocomplete="off"></textarea>
  <button id="send-btn" onclick="sendMessage()">Send</button>
</div>
<script>
const TOKEN = "${token}";
const BASE = window.location.origin;
const msgContainer = document.getElementById("messages");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send-btn");
const approvalDiv = document.getElementById("approval");
const approvalText = document.getElementById("approval-text");
let currentAssistant = null;
let assistantBuffer = "";
let sending = false;
let evtSource = null;

function connectSSE() {
  if (evtSource) evtSource.close();
  evtSource = new EventSource(BASE + "/rc/stream?token=" + TOKEN);
  evtSource.onmessage = function(e) {
    const data = JSON.parse(e.data);
    if (data.type === "chunk") {
      assistantBuffer += data.text;
      if (!currentAssistant) {
        currentAssistant = addMessage("assistant", "", true);
      }
      renderMarkdown(currentAssistant, assistantBuffer);
      currentAssistant.classList.add("streaming");
      scrollToBottom();
    } else if (data.type === "complete") {
      assistantBuffer = data.text;
      if (!currentAssistant) {
        currentAssistant = addMessage("assistant", "", false);
      }
      renderMarkdown(currentAssistant, assistantBuffer);
      currentAssistant.classList.remove("streaming");
      scrollToBottom();
    } else if (data.type === "done") {
      if (currentAssistant) {
        currentAssistant.classList.remove("streaming");
        if (assistantBuffer) {
          renderMarkdown(currentAssistant, assistantBuffer);
        }
      }
      currentAssistant = null;
      assistantBuffer = "";
      sending = false;
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    } else if (data.type === "approval") {
      approvalText.textContent = data.text;
      approvalDiv.style.display = "block";
    }
  };
  evtSource.onerror = function() { setTimeout(connectSSE, 3000); };
}

function renderMarkdown(el, text) {
  // marked.parse returns safe HTML from markdown
  el.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.innerHTML = marked.parse(text);
  el.appendChild(wrapper);
}

function addMessage(role, text, streaming) {
  const div = document.createElement("div");
  div.className = "msg " + role + (streaming ? " streaming" : "");
  if (text) {
    if (role === "assistant") {
      renderMarkdown(div, text);
    } else {
      div.textContent = text;
    }
  }
  msgContainer.appendChild(div);
  scrollToBottom();
  return div;
}

function scrollToBottom() {
  msgContainer.scrollTop = msgContainer.scrollHeight;
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text || sending) return;
  sending = true;
  sendBtn.disabled = true;
  input.disabled = true;
  input.value = "";
  input.style.height = "auto";
  addMessage("user", text, false);
  currentAssistant = null;
  assistantBuffer = "";
  try {
    const r = await fetch(BASE + "/rc/send?token=" + TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    if (!r.ok) {
      const err = await r.json().catch(function() { return {}; });
      addMessage("assistant", "Error: " + (err.error || r.statusText), false);
      sending = false;
      sendBtn.disabled = false;
      input.disabled = false;
    }
  } catch (e) {
    addMessage("assistant", "Connection error", false);
    sending = false;
    sendBtn.disabled = false;
    input.disabled = false;
  }
}

async function handleApproval(decision) {
  approvalDiv.style.display = "none";
  await fetch(BASE + "/rc/approve?token=" + TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision: decision }),
  });
}

// Auto-resize textarea
input.addEventListener("input", function() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 120) + "px";
});

// Enter to send, Shift+Enter for newline
input.addEventListener("keydown", function(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

connectSSE();
input.focus();
<\/script>
</body>
</html>`;
  }
}

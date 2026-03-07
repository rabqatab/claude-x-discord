# claude-x-discord

Control [Claude Code](https://docs.anthropic.com/en/docs/claude-code) remotely through Discord. Lightweight daemon that bridges Discord messages to Claude CLI processes with streaming output, tool approval buttons, and long-term memory.

## Features

- **Forum-based project management** — each project gets its own Discord thread
- **Streaming output** — real-time Claude responses with debounced edits
- **Tool approval buttons** — approve/deny dangerous operations from your phone
- **Multi-AI debate** — `/debate` runs Claude + Gemini + Codex in parallel, then synthesize
- **Long-term memory** — auto-learning pipeline extracts patterns from conversations
  - Stage 1: facet extraction every N conversations
  - Stage 2: aggregation analysis builds user profile and workflow suggestions
  - Persona files (USER.md, PATTERNS.md, LESSONS.md) injected into every prompt
- **File attachments** — ask Claude to send files, delivered as Discord attachments (path-safe, 25MB limit)
- **Web chat (`/rc`)** — mobile-friendly web interface with streaming, markdown, and tool approval (SSE-based, token auth)
- **FTS5 memory search** — `/recall` searches past conversations with full-text search
- **Custom slash commands** — drop `.js` files in `commands/` directory
- **Multi-machine support** — run on multiple machines with separate bots/channels

## Prerequisites

- Node.js >= 22
- pnpm
- Python 3 (for claude-bridge.py)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Discord Bot Token

Optional (for `/debate`):
- Gemini CLI + API key
- Codex CLI + API key

## Quick Start

```bash
git clone https://github.com/your-username/claude-x-discord.git
cd claude-x-discord
nvm use            # .nvmrc → Node 22 자동 선택
pnpm install
pnpm build
```

### Configure

Copy the example files and fill in your values:

```bash
cp .env.example .env
cp config.example.yaml config.yaml
```

Edit `.env`:
```bash
DISCORD_TOKEN=your_discord_bot_token
# Optional
GEMINI_API_KEY=your_gemini_key
CODEX_API_KEY=your_codex_key
```

Edit `config.yaml`:
```yaml
discord:
  guild_id: "YOUR_SERVER_ID"
  forum_channel_id: "YOUR_FORUM_CHANNEL_ID"
  allowed_user_ids:
    - "YOUR_USER_ID"
```

### Discord Bot Setup

1. Create an application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Bot tab → copy Token → paste into `.env`
3. Enable **MESSAGE CONTENT** intent under Privileged Gateway Intents
4. OAuth2 → URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Permissions: Send Messages, Manage Threads, Read Message History, Attach Files, Use Slash Commands
5. Invite the bot to your server using the generated URL
6. Create a **Forum Channel** in your server (e.g. `#claude-projects`)
7. Copy Server ID, Forum Channel ID, and your User ID into `config.yaml`

> To copy IDs: Discord Settings → Advanced → enable Developer Mode → right-click → Copy ID

### Run

```bash
nvm use            # Node 22 필수 (.nvmrc)
pnpm start
```

시작 시 Node 버전이 22 미만이면 에러 메시지와 함께 종료됩니다.
로그는 `logs/{machine_name}-{YYYY-MM-DD}.log`에 자동 기록됩니다.

### Daemonize (pm2)

pm2는 NVM을 자동 로드하지 않으므로, Node 22 바이너리의 전체 경로를 사용합니다:

```bash
nvm use 22
npm install -g pm2
pm2 start dist/index.js --name claude-x-discord --interpreter $(which node)
pm2 save && pm2 startup
```

> `which node`가 v22를 가리키는지 반드시 확인하세요 (`node -v`).

## Usage

Register a project:
```
/register name:myapp path:/path/to/your/project
```

Then send messages in the created forum thread — Claude Code runs in that project directory.

### Commands

| Command | Description |
|---------|-------------|
| `/register name path` | Register project + create forum thread |
| `/unregister name` | Unregister project |
| `/projects` | List registered projects |
| `/status` | Active Claude processes |
| `/stop` | Stop Claude process |
| `/reset` | Reset session (new session ID) |
| `/debate question` | Multi-AI debate (auto-injected into next message) |
| `/rc` | Get a web chat URL for this project (ephemeral, token-based) |
| `/remember content` | Store a memory |
| `/recall query` | Search memories (FTS5) |
| `/health` | System health check |
| `/help` | List all commands |

## Architecture

```
Discord (phone/PC)
  │
  ▼
discord.js gateway
├── Forum thread per project
├── Tool approval buttons (approve/deny)
├── Markdown formatting + code block chunking
└── Streaming with debounce
  │
  ▼
Claude Code CLI (via Python bridge)
├── Session persistence (SQLite)
├── Streaming JSON parser
└── Multi-process pool
  │
  ▼
Web Chat Server (port 3848)
├── SSE streaming to browser
├── Token-based auth (ephemeral URLs)
└── Mobile-friendly inline HTML
  │
  ▼
File Attachments
├── <<<ATTACH:/path>>> markers in Claude output
├── Path validation (project-only, ≤25MB)
└── Discord AttachmentBuilder
  │
  ▼
Auto-learning pipeline
├── Stage 1: Facet extraction (every ~10 conversations)
│   ├── Project lessons → {project}/CLAUDE.md
│   ├── Global lessons → persona/LESSONS.md
│   └── Facet cache → data/facets/*.json
└── Stage 2: Aggregation (every ~5 facets)
    ├── User profile → persona/USER.md (full replace)
    ├── Pattern changes → persona/PATTERNS.md (append)
    └── Suggestions → Discord notification
```

## Project Structure

```
src/
├── claude/          # Claude CLI process management + one-shot utility
├── commands/        # Slash command handlers (including /rc)
├── config/          # Zod schema + YAML loader
├── db/              # SQLite databases (sessions, memory)
├── debate/          # Multi-AI debate (Claude + Gemini + Codex)
├── discord/         # Gateway, forum manager, button handlers
├── formatter/       # Discord message formatting + chunking
├── memory/          # Auto-learning pipeline + persona files
├── utils/           # Tagged logger with file logging
├── web/             # Web chat server (SSE, inline HTML, token auth)
└── session-manager.ts  # Core orchestrator
```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Build with tsup |
| `pnpm dev` | Build with watch mode |
| `pnpm start` | Run the bot |
| `pnpm test` | Run tests (vitest) |

## Docs

- [Setup Guide](docs/setup.md) — detailed setup instructions
- [Architecture](docs/architecture.md) — system design
- [Design Document](docs/design.md) — design decisions and rationale

## Tech Stack

TypeScript | Node.js 22+ | discord.js v14 | better-sqlite3 (WAL + FTS5) | tsup | vitest | Zod

## Special Thanks

This project was heavily influenced by the following projects:

- **[claude-code-telegram](https://github.com/RichardAtCT/claude-code-telegram.git)** by RichardAtCT — SQLite-based session/history storage pattern, multi-layer security middleware chain (auth, rate-limit, audit logging), event bus architecture, and the SDK/CLI dual integration with fallback strategy.

- **[claude_x_telegram](https://github.com/svchk12/claude_x_telegram.git)** by svchk12 — Forum topic-based project management (mapping each project to its own chat thread), dangerous command detection with approval buttons, and session resume pattern.

- **[Claude-Code-Remote](https://github.com/JessyTsui/Claude-Code-Remote.git)** by JessyTsui — Hook-based event capture with minimal coupling, execution trace relay to messaging platforms, command retry queue, and the interactive setup wizard concept.

- **[open-claude-code](https://github.com/ico1036/open-claude-code.git)** by ico1036 — discord.js adapter implementation, message debouncing, Markdown-to-Discord formatting with code block chunking, FTS5 full-text search memory, and the Zod + YAML config pattern. The core TypeScript + tsup + vitest stack was adopted from this project.

## License

ISC

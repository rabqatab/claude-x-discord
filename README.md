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
pnpm start
```

### Daemonize (pm2)

```bash
npm install -g pm2
pm2 start dist/index.js --name claude-x-discord
pm2 save && pm2 startup
```

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
├── commands/        # Slash command handlers
├── config/          # Zod schema + YAML loader
├── db/              # SQLite databases (sessions, memory)
├── debate/          # Multi-AI debate (Claude + Gemini + Codex)
├── discord/         # Gateway, forum manager, button handlers
├── formatter/       # Discord message formatting + chunking
├── memory/          # Auto-learning pipeline + persona files
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

## License

ISC

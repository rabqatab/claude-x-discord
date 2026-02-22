# Setup Guide

## Prerequisites

- Node.js >= 22
- pnpm
- Python 3 (claude-bridge.py 실행용)
- Claude Code CLI (`claude`) installed and authenticated
- Discord Bot Token ([Discord Developer Portal](https://discord.com/developers/applications))
- Discord server with a Forum channel

### Optional (for `/debate`)

- Gemini CLI (`gemini`) + API key
- Codex CLI (`codex`) + API key

---

## 1. Build

```bash
cd claude-x-discord
pnpm install
pnpm build
```

## 2. Configure

설정 파일은 프로젝트 디렉토리에 위치한다. `CLAUDE_X_DISCORD_HOME` 환경변수로 변경 가능.

### 2.1 `.env` (시크릿)

```bash
# claude-x-discord/.env

# Required
DISCORD_TOKEN=your_discord_bot_token

# Optional - for /debate command
GEMINI_API_KEY=your_gemini_api_key
CODEX_API_KEY=your_codex_api_key

# Optional - Agent Teams
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

# Optional - Custom binary paths
# CLAUDE_BIN=/custom/path/to/claude
# CODEX_BIN=/custom/path/to/codex
# GEMINI_BIN=/custom/path/to/gemini
# CODEX_MODEL=gpt-5.3-codex
```

### 2.2 `config.yaml` (설정)

```yaml
# claude-x-discord/config.yaml

machine_name: "macmini-nick"       # 기기 식별자 (Presence, 명령어 응답에 표시)

discord:
  guild_id: "YOUR_DISCORD_SERVER_ID"
  forum_channel_id: "YOUR_FORUM_CHANNEL_ID"
  allowed_user_ids:
    - "YOUR_DISCORD_USER_ID"

claude:
  idle_timeout: 3000              # 유휴 타이머 (초). 실제로 프로세스는 메시지별 종료
  max_processes: 20               # 동시 Claude 프로세스 수
  streaming_debounce: 1000        # 스트리밍 업데이트 간격 (ms)

models:
  claude: "claude-opus-4-6"
  gemini: "gemini-3.1-pro"
  codex: "gpt-5.3-codex"

debate:
  timeout: 300                    # 각 AI 응답 타임아웃 (초)
  gemini_enabled: true
  codex_enabled: true

memory:
  auto_learn_interval: 10         # N회 대화마다 자동 학습
  confidence_decay: 0.95          # 기억 confidence 감쇠율
```

## 3. Discord Bot Setup

1. [Discord Developer Portal](https://discord.com/developers/applications) 에서 Application 생성
2. Bot 탭에서 Token 복사 → `.env`의 `DISCORD_TOKEN`에 입력
3. Bot 설정:
   - **Privileged Gateway Intents**: `MESSAGE CONTENT` 활성화
4. OAuth2 → URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Manage Threads`, `Read Message History`, `Attach Files`, `Use Slash Commands`
5. 생성된 URL로 서버에 봇 초대
6. 서버에 **Forum Channel** 생성 (예: `#claude-projects`)
7. 서버 ID, Forum Channel ID, 본인 User ID를 `config.yaml`에 입력

> ID 확인: Discord 설정 → Advanced → Developer Mode 활성화 → 우클릭 → Copy ID

### Multi-Machine Setup

다중 기기 배포 시:
1. 각 기기에 **별도 Discord Bot** 생성 (별도 토큰)
2. 각 기기에 **별도 Forum Channel** 생성 (예: `#claude-macmini`, `#claude-gpu`)
3. 각 기기 `config.yaml`에 다른 `machine_name`, `forum_channel_id` 설정
4. 각 기기 `.env`에 다른 `DISCORD_TOKEN` 설정
5. Claude Code CLI 로그인은 각 기기에서 수동으로 수행

## 4. Run

```bash
pnpm start
```

시작 시 출력:
```
claude-x-discord starting... [macmini-nick]
Discord connected
Slash commands deployed
```

### 데몬화 (pm2)

```bash
npm install -g pm2
pm2 start dist/index.js --name claude-x-discord
pm2 save
pm2 startup    # 시스템 부팅 시 자동 시작
```

## 5. Usage

봇이 실행되면 Discord에서:

```
/register name:myapp path:/path/to/your/project
```

- `path` 필드에서 **autocomplete** 지원: 빈 상태에서 Tab → 알려진 디렉토리 목록 표시
- `~` 경로 지원: `~/Projects/myapp` → `/Users/username/Projects/myapp`
- 경로가 틀려도 유사 디렉토리 제안

생성된 Forum Topic에 메시지를 보내면 Claude Code가 해당 프로젝트에서 실행된다.

### Commands

| Command | Description |
|---------|-------------|
| `/register name path` | 프로젝트 등록 + Forum Topic 생성 (path autocomplete, fuzzy 매칭) |
| `/unregister name` | 프로젝트 등록 해제 (case-insensitive, 유사 이름 제안) |
| `/projects` | 등록된 프로젝트 목록 [machine_name] |
| `/status` | 현재 Claude 프로세스 상태 |
| `/stop` | Claude 프로세스 중지 |
| `/reset` | 세션 초기화 (새 session ID) |
| `/debate question` | 멀티 AI debate (결과는 다음 메시지에 자동 주입) |
| `/remember content` | 기억 저장 |
| `/recall query` | 기억 검색 (FTS5 전문 검색) |
| `/health` | 시스템 상태 확인 |
| `/help` | 전체 커맨드 목록 [machine_name] |

### Debate Follow-up

`/debate` 실행 후 결과가 debateContext에 저장됩니다. 다음 메시지에서 자연어로 종합을 요청하면 debate 결과가 자동으로 컨텍스트에 포함됩니다:

```
/debate "Redis vs SQLite for caching"
→ Claude, Gemini, Codex 각각 응답

(사용자 메시지) "위 3개 의견을 종합해줘"
→ debate 결과가 자동으로 Claude에 주입되어 종합 응답 생성
```

## 6. Custom Commands

`~/.claude-x-discord/commands/` 에 `.js` 파일을 추가하면 자동으로 슬래시 커맨드로 등록된다.

```javascript
// ~/.claude-x-discord/commands/my-deploy.js
import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("deploy")
    .setDescription("Deploy project"),
  execute: async (interaction, ctx) => {
    // ctx: { sessions, memory, pool, forum, config, debateContext }
    await interaction.reply("Deploying...");
  },
};
```

봇 재시작 시 자동 로드.

## 7. Environment Variable Override

`CLAUDE_X_DISCORD_HOME` 환경변수로 설정/데이터 디렉토리를 변경할 수 있다:

```bash
CLAUDE_X_DISCORD_HOME=/custom/path pnpm start
```

## 8. Troubleshooting

| 증상 | 원인 | 해결 |
|------|------|------|
| Claude "(no response)" | Python3 미설치 또는 PATH에 없음 | `python3 --version` 확인 |
| Debate에서 Gemini raw JSON | Gemini CLI 출력 형식 변경 | `gemini` CLI 업데이트 |
| 텍스트 중복 출력 | stream-json 파싱 문제 | 최신 코드로 업데이트 (parser.ts 중복 방지) |
| `Slash commands deployed` 안 뜸 | Bot에 `applications.commands` scope 없음 | OAuth2 URL 재생성 후 재초대 |
| 경로 autocomplete 안 됨 | PROJECT_ROOTS에 해당 디렉토리 없음 | register.ts의 PROJECT_ROOTS 수정 |

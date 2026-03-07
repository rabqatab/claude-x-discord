# Setup Guide

## Prerequisites

- **Node.js >= 22** (NVM 권장)
- pnpm
- Python 3 (claude-bridge.py 실행용)
- Claude Code CLI (`claude`) installed and authenticated
- Discord Bot Token ([Discord Developer Portal](https://discord.com/developers/applications))
- Discord server with a Forum channel

### Optional (for `/debate`)

- Gemini CLI (`gemini`) + API key
- Codex CLI (`codex`) + API key

---

## 1. Node.js 환경 설정

프로젝트는 Node.js 22+ 필수. 시작 시 버전을 체크하며, 22 미만이면 에러와 함께 종료된다.

### NVM 설치 (미설치 시)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
```

### Node 22 설치 및 설정

```bash
nvm install 22
nvm alias default 22    # 새 터미널에서 기본 Node 22 사용
```

### Gemini/Codex CLI 설치 (Node 22 환경에서)

```bash
nvm use 22
npm install -g @anthropic-ai/claude-code    # 이미 설치되어 있을 수 있음
npm install -g @anthropic-ai/gemini-cli      # /debate용 (선택)
npm install -g codex                         # /debate용 (선택)
```

> **중요**: Gemini CLI는 Node 22+의 Unicode Sets regex (`/v` flag)를 사용한다. Node 18에서 실행하면 크래시.

### CLI 바이너리 경로 확인

NVM 환경에서 CLI가 어디에 설치되었는지 확인:

```bash
which claude    # e.g. /home/user/.nvm/versions/node/v22.22.0/bin/claude
which gemini    # e.g. /home/user/.nvm/versions/node/v22.22.0/bin/gemini
which codex     # e.g. /home/user/.nvm/versions/node/v22.22.0/bin/codex
```

이 경로들을 `.env`의 `CLAUDE_BIN`, `GEMINI_BIN`, `CODEX_BIN`에 설정하면, 비인터랙티브 셸(systemd, pm2 등)에서도 올바른 Node 버전으로 CLI를 실행한다.

## 2. Build

```bash
cd claude-x-discord
nvm use                 # .nvmrc → Node 22 자동 선택
pnpm install
pnpm build
```

## 3. Configure

설정 파일은 프로젝트 디렉토리에 위치한다. `CLAUDE_X_DISCORD_HOME` 환경변수로 변경 가능.

### 3.1 `.env` (시크릿)

```bash
# claude-x-discord/.env

# Required
DISCORD_TOKEN=your_discord_bot_token

# Optional - for /debate command
GEMINI_API_KEY=your_gemini_api_key
CODEX_API_KEY=your_codex_api_key

# Optional - Agent Teams
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

# CLI binary paths (NVM 환경에서는 전체 경로 권장)
# 비인터랙티브 셸(systemd, pm2)에서 올바른 Node.js 버전을 사용하기 위함.
# Bridge가 CLI 바이너리 경로에서 Node.js 위치를 추론하여 PATH에 추가한다.
CLAUDE_BIN=/home/user/.nvm/versions/node/v22.22.0/bin/claude
GEMINI_BIN=/home/user/.nvm/versions/node/v22.22.0/bin/gemini
CODEX_BIN=/home/user/.nvm/versions/node/v22.22.0/bin/codex
```

### 3.2 `config.yaml` (설정)

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

web:
  port: 3848                      # 웹 채팅 서버 포트
  enabled: true                   # 웹 채팅 활성화
  token_ttl: 3600                 # 토큰 유효 시간 (초, 기본 1시간)

memory:
  auto_learn_interval: 10         # N회 대화마다 자동 학습
  confidence_decay: 0.95          # 기억 confidence 감쇠율
```

## 4. Discord Bot Setup

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

## 5. Run

```bash
nvm use            # .nvmrc → Node 22
pnpm start
```

시작 시 출력:
```
claude-x-discord starting... [macmini-nick] node=22.22.0
[logger] file logging → /path/to/logs/macmini-nick-2026-02-22.log
Discord connected
Slash commands deployed
```

Node 22 미만이면 즉시 종료:
```
Node.js v18.19.1 detected. Requires >=v22. Run: nvm use 22
```

### 로그 파일

모든 `console.log`/`error`/`warn` 출력이 `logs/{machine_name}-{YYYY-MM-DD}.log`에 자동 기록된다.

- 일별 자동 로테이션 (날짜 변경 시 새 파일)
- 로그 포맷: `[tag|instance:project] message`
- 터미널 출력과 파일 기록 동시 수행

```bash
# 실시간 로그 모니터링
tail -f logs/macmini-nick-2026-02-22.log

# 특정 프로젝트만 필터링
grep "macmini-nick:myapp" logs/macmini-nick-2026-02-22.log

# 에러만 필터링
grep "ERROR" logs/macmini-nick-2026-02-22.log
```

### 데몬화 (pm2)

pm2는 NVM을 자동 로드하지 않으므로, Node 22 바이너리의 전체 경로를 사용:

```bash
nvm use 22
npm install -g pm2

# --interpreter로 현재 Node.js (v22) 경로를 명시
pm2 start dist/index.js --name claude-x-discord --interpreter $(which node)
pm2 save
pm2 startup    # 시스템 부팅 시 자동 시작
```

> `which node`가 반드시 v22를 가리키는지 확인. `nvm use 22` 후 실행할 것.

## 6. Usage

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
| `/rc` | 웹 채팅 URL 생성 (ephemeral, 토큰 기반 인증) |
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

## 7. Custom Commands

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

## 8. Environment Variable Override

`CLAUDE_X_DISCORD_HOME` 환경변수로 설정/데이터 디렉토리를 변경할 수 있다:

```bash
CLAUDE_X_DISCORD_HOME=/custom/path pnpm start
```

## 9. Troubleshooting

| 증상 | 원인 | 해결 |
|------|------|------|
| `Requires >=v22` 에러 후 종료 | 시스템 Node가 v18 등 구버전 | `nvm use 22` 후 재실행 |
| `NODE_MODULE_VERSION` 불일치 | better-sqlite3가 다른 Node 버전으로 빌드됨 | `nvm use 22 && pnpm rebuild better-sqlite3` |
| Gemini CLI 크래시 (`/v` flag) | Node 18에서 Gemini CLI 실행 | `.env`에 `GEMINI_BIN`을 Node 22 경로로 설정 |
| pm2에서 Node 18 사용 | pm2가 시스템 Node를 사용 | `--interpreter $(which node)` 옵션 사용 (nvm use 22 후) |
| Claude "(no response)" | Python3 미설치 또는 PATH에 없음 | `python3 --version` 확인 |
| Debate에서 Gemini raw JSON | Gemini CLI 출력 형식 변경 | `gemini` CLI 업데이트 |
| `Slash commands deployed` 안 뜸 | Bot에 `applications.commands` scope 없음 | OAuth2 URL 재생성 후 재초대 |
| 경로 autocomplete 안 됨 | PROJECT_ROOTS에 해당 디렉토리 없음 | register.ts의 PROJECT_ROOTS 수정 |
| 두 인스턴스 로그 구분 안 됨 | `machine_name`이 동일 | 각 기기 `config.yaml`에 다른 `machine_name` 설정 |

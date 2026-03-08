# claude-x-discord Design Document

> Date: 2026-02-21
> Status: Approved (Revised)

---

## 1. Overview

Discord를 통해 원격으로 Claude Code를 제어하는 경량 데몬. 단일 프로세스로 동작하며, Discord Forum Topic 기반 멀티 프로젝트 관리, CLI 스트리밍 연동, 자기진화형 메모리, 멀티 AI debate를 지원한다.

### 1.1 Core Constraints

1. Discord에서 원격으로 작업 지시
2. Claude Code CLI와 동일한 결과물 출력
3. Claude의 승인/선택 요청을 Discord 버튼으로 처리
4. 프로젝트별 별도 세션 (격리된 Claude Code 메모리)
5. 행동 패턴 기반 자기진화형 장기 메모리
6. Gemini CLI + Codex CLI를 활용한 멀티 AI debate
7. 다중 기기 지원 (machine_name 기반 식별)

### 1.2 Tech Stack

| 항목 | 선택 |
|------|------|
| Language | TypeScript (strict mode) + Python 3 (bridge) |
| Runtime | Node.js >= 22 |
| Package Manager | pnpm |
| Discord | discord.js v14 |
| Database | better-sqlite3 (WAL mode) + FTS5 |
| Build | tsup (ESM) |
| Test | vitest |
| Process Manager | pm2 |

### 1.3 Default Models (2026-02-21 기준)

| AI | Model |
|----|-------|
| Claude | `claude-opus-4-6` (CLI 기본값) |
| Gemini | `gemini-3.1-pro` |
| Codex/OpenAI | `gpt-5.2-codex` |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                claude-x-discord [macmini-nick]                   │
│                    (단일 Node.js 프로세스)                         │
│                                                                   │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │  Discord      │    │  Session Manager  │    │  Memory       │  │
│  │  Gateway      │◄──►│                  │◄──►│  Engine       │  │
│  │  (discord.js) │    │  Forum Topic ↔   │    │  (SQLite+FTS5)│  │
│  │  + autocomplete│   │  Project ↔       │    │  + auto-learn │  │
│  └──────┬───────┘    │  Claude Process  │    └───────────────┘  │
│         │            │  + debateContext  │                        │
│         │            └────────┬─────────┘                        │
│         │                     │                                   │
│         │            ┌────────▼─────────┐                        │
│         │            │  Claude CLI Pool  │                        │
│         │            │  (메시지별 spawn)  │    ┌───────────────┐  │
│         │            │                  │    │  Debate Engine │  │
│         │            │  ┌─────────────┐ │    │  (runner.ts)   │  │
│         │            │  │Python Bridge │ │    │               │  │
│         │            │  │→ claude CLI  │ │    │  Python Bridge │  │
│         │            │  │  --cwd proj  │ │    │  → Claude CLI  │  │
│         │            │  │  --resume id │ │    │  → Gemini CLI  │  │
│         │            │  └─────────────┘ │    │  → Codex CLI   │  │
│         │            └──────────────────┘    └───────────────┘  │
│  ┌──────▼───────┐                                                │
│  │  Formatter    │  Discord Markdown ↔ CLI Output 변환           │
│  └──────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Core Components

| Component | Role |
|-----------|------|
| **Discord Gateway** | discord.js 기반 메시지/커맨드/버튼/autocomplete 수신/발신, Forum Topic 관리 |
| **Session Manager** | Forum Topic ↔ Project ↔ Claude Process 매핑, debateContext 주입, 자동 학습 트리거 |
| **Claude CLI Pool** | 메시지별 프로세스 spawn, `--resume` 기반 세션 복원, idle eviction |
| **Python Bridge** | Node→Python→CLI stdout 릴레이. claude/gemini/codex 공통 지원 |
| **Memory Engine** | SQLite + FTS5, 대화 이력, 자기진화형 장기 메모리, 자동 교훈 추출 |
| **Debate Engine** | `/debate` 시 Python 브릿지 경유 3개 CLI 병렬 실행, 결과→debateContext 저장 |
| **Formatter** | CLI 출력 → Discord 메시지 변환, 하이브리드 출력 (분할 + 파일 첨부), 코드 블록 분할 처리 |
| **Remote Control** | `claude remote-control` spawn + PTY 브릿지, claude.ai/code에서 Full Claude Code UI 제공 |
| **Web Chat Server** | HTTP + SSE 기반 웹 채팅 (인라인 HTML, 토큰 인증, 모바일 최적화) |
| **File Attachments** | `<<<ATTACH:...>>>` 마커 시스템, 경로 검증, Discord 파일 첨부 |

---

## 3. Claude CLI Integration via Python Bridge

### 3.1 Why Python Bridge?

Node.js에서 `child_process.spawn()`으로 Claude CLI를 직접 실행하면 stdin이 pipe일 때 stdout이 비어있는 버그 발생.
Python의 `subprocess.Popen()`은 이 문제가 없으므로, Python이 중간에서 CLI를 spawn하고 stdout을 line-by-line으로 릴레이.

```
Node.js                 Python Bridge              Claude CLI
  │                         │                          │
  ├─ spawn python3 ────────►│                          │
  │   claude-bridge.py      ├─ subprocess.Popen() ────►│
  │                         │   (stdin=PTY for Claude) │
  │                         │   (stdin=DEVNULL others) │
  │                         │                          │
  │──── "y\n" (approve) ──►│──── PTY relay thread ───►│  ← approve/deny
  │                         │                          │
  │                         │◄──── stdout (JSON) ──────┤  ← stdout thread (daemon)
  │◄──── stdout relay ──────┤                          │
  │                         │                          │
  │   stdin.end() ──────────┤  proc.wait() ◄───────────┤  ← CLI exits
  │◄──── exit event ────────┤  os._exit() (2s drain)   │
```

### 3.2 Process Lifecycle (Per-Message)

1. **생성**: 사용자 메시지 도착 → `ClaudePool.run()` → `ClaudeProcess.run(prompt)` → Python 브릿지 spawn
2. **실행**: `claude -p "{prompt}" --output-format stream-json --verbose --cwd {path} --resume {sessionId}`
3. **스트리밍**: stdout JSON lines → `parseJsonStreamChunk()` → Discord 메시지 edit (디바운스)
4. **종료**: Claude CLI exit → bridge `proc.wait()` 반환 → stdout 2초 drain → `os._exit()` → Node.js `exit` 이벤트 → 최종 포맷팅 → Discord 전송
5. **재개**: 다음 메시지 → 같은 `--resume sessionId`로 새 프로세스 spawn → 컨텍스트 유지
6. **대기열**: Claude 실행 중 추가 메시지 도착 시 queue에 보관, 완료 후 최신 메시지만 처리 (이전 것 폐기)

각 메시지마다 새 프로세스를 생성하고, `--resume` 플래그로 이전 세션 컨텍스트를 복원한다.
stdin pipe 방식이 아닌 `-p` 플래그로 프롬프트를 전달한다.

### 3.2.1 Bridge Threading Model

Python 브릿지는 3개 daemon 스레드 + 메인 스레드로 동작:

| Thread | Role |
|--------|------|
| **Main** | `proc.wait()`로 CLI 종료 대기 → stdout drain (2초) → `os._exit()` |
| **stdout** (daemon) | `proc.stdout` line-by-line 읽기 → `os.write(1, line)` (Node.js로 릴레이) |
| **stderr** (daemon) | `proc.stderr` 읽기 → 로그 출력 |
| **stdin relay** (daemon) | `sys.stdin.buffer` → PTY master fd (approve/deny 릴레이) |

**PTY 사용 이유**: Claude CLI는 `stdin.isTTY`를 검사하며, pipe stdin일 때 `-p` 플래그가 있어도 입력 대기 상태에 빠짐. PTY(`pty.openpty()`)로 isTTY=true를 보장.

**`os._exit()` 사용 이유**: CLI가 agent teams/MCP 서버 등 자식 프로세스를 생성하면 stdout pipe가 유지되어 blocking read가 영원히 멈출 수 있음. `proc.wait()`가 반환되면 2초 drain 후 즉시 종료. `sys.stdin.close()`는 호출하지 않음 — `relay_stdin` daemon 스레드가 `BufferedReader` lock을 잡고 있어 deadlock 발생.

### 3.3 Streaming Strategy

- stdout stream-json을 line-by-line 파싱
- `content_block_delta` → 스트리밍 텍스트 (버퍼에 append)
- `result` → 최종 텍스트 (버퍼를 교체, 중복 방지)
- `assistant` → tool_use 정보만 추출 (텍스트는 무시하여 중복 방지)
- 디바운스 (기본 1000ms)로 Discord 메시지 edit (실시간 업데이트)
- 완료 시 최종 메시지 확정 (하이브리드 Formatter 적용)

### 3.4 Permission/Approval Handling

Claude가 tool 실행 허가를 요청하면 stdout에서 패턴 감지 → Discord 버튼으로 표시:

```
Claude: Tool approval request detected in stdout
         ↓ parser 감지
Discord: [Approve] [Deny] 버튼 표시
         ↓ 사용자 클릭
stdin:   "y\n" 또는 "n\n" (Python 브릿지의 stdin pipe로 전달)
```

- 승인 요청 후 5분 내 응답 없으면 자동 Deny + 알림
- 브릿지 프로세스의 stdin을 통해 승인/거부 전달

---

## 4. Discord Forum Topic ↔ Project ↔ Session Mapping

```
Discord Server
└── #claude-projects (Forum Channel)
    ├── [myapp] FastAPI 백엔드        ← Forum Topic = 1 Project
    │   ├── "이 API 엔드포인트 추가해줘"   ← Claude (--resume sess_001)
    │   └── Claude 응답 (스트리밍)
    │
    ├── [ml-pipeline] 데이터 전처리    ← Claude (--resume sess_002)
    └── [docs] 기술 문서 정리           ← Claude (--resume sess_003)
```

### 4.1 Registration

```
/register name:myapp path:/Users/minhancho/projects/myapp
```
- path 자동 완성 (autocomplete): `~/PycharmProjects`, `~/PythonProjects`, `~/Study`, `~/Research` 등 스캔
- 경로 정규화: `~` 해석, 상대 경로 → 절대 경로, trailing slash 제거
- 유효성 검증: 경로 존재 여부 + 디렉토리 여부
- 중복 검사: 이름 (case-insensitive) + 경로 중복 체크
- 유사 경로 제안: Levenshtein 거리 기반 fuzzy 매칭
- Forum Topic 자동 생성 (machine_name 표시)
- SQLite에 매핑 저장: `forum_topic_id | project_name | project_path | session_id | claude_pid`

### 4.2 Unregistration

```
/unregister name:myapp
```
- Case-insensitive 이름 매칭
- 이름 불일치 시 유사 이름 제안
- Claude 프로세스 kill → Forum Topic 아카이브 → DB 삭제

### 4.3 Isolation Guarantee

- Triple isolation: `--cwd` (프로젝트 경로) + `--resume` (세션 ID) + separate process
- Topic A의 메시지는 절대 Project B의 Claude로 가지 않음

---

## 5. Permission & Authentication

### 5.1 Two-Level Permission Model

| Level | Target | Handling |
|-------|--------|----------|
| **Auto-allow** | Read, Grep, Glob, ls, git status 등 | Claude 자동 실행, 결과만 표시 |
| **Confirm** | Write, Edit, Bash(위험), git push 등 | Discord 버튼으로 승인 요청 |

- Claude CLI가 자체적으로 승인을 요청하는 것을 그대로 활용
- 별도 필터 불필요 - stdout 패턴 감지로 Discord 버튼 전환

### 5.2 Authentication

- Discord 서버 소유자 또는 지정 Role만 봇 사용 가능
- 1인 사용 기본 전제: `allowed_user_ids` (config.yaml)로 제어

---

## 6. `/debate` Multi-AI Engine

### 6.1 Architecture

```
/debate "Redis vs SQLite 캐싱"
        │
        ▼
  debate.ts (command handler)
        │
        ▼
  runDebate() → runner.ts
        │
        ├──► runBridge("claude", prompt, projectPath)
        │      Python bridge → claude -p "{prompt}" --output-format stream-json
        │      Claude는 --cwd로 프로젝트 파일을 자체 탐색
        │
        ├──► runBridge("gemini", prompt, projectPath)   [config.debate.gemini_enabled]
        │      Python bridge → gemini -p "{prompt}" --output-format json
        │
        └──► runBridge("codex", prompt, projectPath)    [config.debate.codex_enabled]
               Python bridge → codex exec --json --model gpt-5.2-codex --cd {cwd} "{prompt}"
        │
        ▼ (Promise.allSettled)
  결과 파싱
        ├── extractClaudeResult: result → content_block_delta → assistant fallback
        ├── extractGeminiResult: JSON → regex JSON → JSONL → raw text fallback
        └── extractCodexResult: item.completed agent_message → result/output → raw text
        │
        ▼
  Discord 일반 메시지로 전송 (AI별 **Claude** / **Gemini** / **Codex** 헤더)
        ├── 8파트 이하 → 일반 메시지 분할 전송
        └── 8파트 초과 → 처음 3개 + .md 파일 첨부
        │
        ▼
  debateContext Map에 결과 저장 (TTL: 10분) → 다음 사용자 메시지에 자동 주입
```

### 6.2 Design Choices

- **컨텍스트 자동 수집 없음**: 원래 설계에서는 디렉토리 트리/의존성 파일 등을 수집하여 AI에 주입하려 했으나, Claude CLI의 `--cwd` 플래그가 자체적으로 프로젝트 파일을 탐색하므로 불필요. Gemini/Codex는 질문만 전달.
- **API가 아닌 CLI**: Claude Max 구독 사용으로 API key 없음. Gemini/Codex도 CLI 통일하여 일관된 인터페이스.
- **Python 브릿지 공유**: 일반 메시지와 동일한 `claude-bridge.py` 사용.
- **Synthesis 없음**: 원래 설계에서는 3개 응답을 합쳐 최종 추천을 생성하려 했으나, debate 결과를 debateContext로 저장하여 다음 메시지에서 Claude가 자연스럽게 종합하도록 변경.

### 6.3 Timeout & Error Handling

- 타임아웃: `config.debate.timeout` (기본 300초)
- 미설치 CLI는 건너뛰고 나머지로 진행
- Promise.allSettled로 개별 실패 허용

---

## 7. Self-Evolving Memory Engine

### 7.1 Structure

```
┌──────────────────────────────────────────────┐
│  Markdown Files (Claude 직접 읽기용)          │
│  USER.md     - 사용자 성향                    │
│  PATTERNS.md - 행동 패턴                      │
│  LESSONS.md  - 학습된 교훈                    │
├──────────────────────────────────────────────┤
│  SQLite + FTS5 (세부 기억 저장 + 검색)         │
│  conversations | memories | search_idx       │
└──────────────────────────────────────────────┘
```

### 7.2 Auto-Learning (자동 학습)

세션 매니저의 `onExit` 핸들러에서 자동 학습이 트리거된다:

1. Claude 응답 완료 시 대화 카운트 확인 (`getConversationCount`)
2. `shouldAutoLearn(count, interval)` → N회 대화마다 트리거
3. `extractLessons(response)` → 키워드 기반 교훈 추출
4. `appendLessons()` → `LESSONS.md`에 타임스탬프와 함께 추가

### 7.3 Explicit Memory

| Command | Action |
|---------|--------|
| `/remember content` | memories 테이블에 저장 (confidence: 1.0) |
| `/recall query` | FTS5 전문 검색으로 관련 기억 조회 |

### 7.4 Confidence Decay

- `confidence_decay` 팩터로 오래된 기억의 가중치 자연 감쇠
- FTS5 rank 기반 검색 결과 정렬

---

## 8. Message Formatting (Hybrid Formatter)

| CLI Output | Discord Representation |
|------------|----------------------|
| Markdown 텍스트 | 그대로 전달 |
| 코드 블록 | 그대로 전달 (언어 하이라이팅 유지) |
| Tool 사용 로그 | 아이콘 + 요약 축약 |
| 테이블 (markdown) | 코드 블록으로 변환 (Discord 미지원) |
| 긴 출력 (>5파트) | 미리보기 2개 + `.md` 파일 첨부 |
| 진행 중 스트리밍 | 메시지 edit 실시간 업데이트 |

**분할 전략**: 2000자 단위로 분할. 코드 블록이 분할 지점에 걸치면 자동으로 닫기/열기 처리.
5파트 이하면 일반 메시지로 전송, 초과 시 앞부분 미리보기 + 전문 `.md` 파일 첨부.

---

## 9. Slash Commands

| Category | Commands |
|----------|----------|
| **Project** | `/register` (autocomplete) `/unregister` (case-insensitive) `/projects` |
| **Session** | `/status` `/reset` `/stop` `/rc` (Remote Control) |
| **AI** | `/debate` |
| **Memory** | `/remember` `/recall` |
| **Utility** | `/health` `/help` |
| **Custom** | `~/.claude-x-discord/commands/` 에 `.js` 파일 추가 |

### Custom Command Plugin

```typescript
// ~/.claude-x-discord/commands/my-deploy.js
export default {
  data: new SlashCommandBuilder().setName('deploy').setDescription('Deploy project'),
  execute: async (interaction, ctx) => {
    // ctx: { sessions, memory, pool, forum, config, debateContext }
  }
}
```

봇 시작 시 디렉토리 스캔 → Discord 슬래시 커맨드로 자동 등록.

---

## 10. Multi-Machine Deployment

### 10.1 Architecture

각 기기에 별도 Discord 봇 (별도 토큰)을 사용:

```
Discord Server
├── #claude-macmini (Forum Channel) ←── macmini-nick 봇
└── #claude-gpu     (Forum Channel) ←── gpu-server 봇
```

### 10.2 Configuration

- `config.yaml`의 `machine_name` 필드로 기기 식별
- 봇 Presence에 `[machine_name]` 표시
- `/register`, `/projects`, `/help` 응답에 machine_name 포함
- 각 기기별 별도 `.env` (다른 `DISCORD_TOKEN`)와 `config.yaml` (다른 `forum_channel_id`, `machine_name`)

---

## 11. Configuration & Deployment

### 11.1 Directory Structure

설정 파일은 프로젝트 디렉토리에 위치. `CLAUDE_X_DISCORD_HOME` 환경변수로 변경 가능.

```
claude-x-discord/              (또는 $CLAUDE_X_DISCORD_HOME)
├── .nvmrc                     ← Node 22 지정
├── .env                       ← 시크릿/환경변수
├── config.yaml                ← 동작 설정
├── logs/                      ← 일별 로그 ({machine_name}-{날짜}.log)
├── data/
│   ├── memory.db              ← SQLite + FTS5
│   └── sessions.db            ← 세션/프로젝트 매핑
│
~/.claude-x-discord/           (선택)
├── commands/                  ← 커스텀 커맨드
└── persona/                   ← USER.md, PATTERNS.md, LESSONS.md
```

### 11.2 .env

```bash
# Required
DISCORD_TOKEN=your_discord_bot_token

# Optional - for /debate command
GEMINI_API_KEY=your_gemini_api_key
CODEX_API_KEY=your_codex_api_key

# Optional
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

# CLI binary paths (NVM 환경에서는 전체 경로 권장)
# Bridge가 CLI 바이너리 디렉토리를 PATH에 추가하여 올바른 Node.js 사용
CLAUDE_BIN=/home/user/.nvm/versions/node/v22.22.0/bin/claude
GEMINI_BIN=/home/user/.nvm/versions/node/v22.22.0/bin/gemini
CODEX_BIN=/home/user/.nvm/versions/node/v22.22.0/bin/codex
```

### 11.3 config.yaml

```yaml
machine_name: "macmini-nick"

discord:
  guild_id: "123456789"
  forum_channel_id: "987654321"
  allowed_user_ids: ["your_discord_id"]

claude:
  idle_timeout: 1800            # 유휴 타이머 (초, 기본 30분)
  max_processes: 7              # 동시 Claude 프로세스 수
  streaming_debounce: 1000      # 스트리밍 업데이트 간격 (ms)

models:
  claude: "claude-opus-4-6"
  gemini: "gemini-3.1-pro"
  codex: "gpt-5.2-codex"

debate:
  timeout: 60                   # 각 AI 응답 타임아웃 (초)
  gemini_enabled: true
  codex_enabled: true

web:
  port: 3848                    # 웹 채팅 서버 포트
  enabled: true                 # 웹 채팅 활성화 여부
  token_ttl: 3600               # 토큰 유효 시간 (초, 기본 1시간)

memory:
  auto_learn_interval: 10       # N회 대화마다 자동 학습
  confidence_decay: 0.95        # 기억 confidence 감쇠율
  facet_interval: 10            # N회 대화마다 facet 추출
  aggregation_threshold: 5      # N개 facet 누적 시 aggregation 실행
  analysis_timeout: 120         # 분석 타임아웃 (초)
```

### 11.4 Execution

```bash
nvm use        # .nvmrc → Node 22
pnpm start     # .env 자동 로드 + config.yaml 로드 + 서버 구동
```

시작 시 Node 22 미만이면 에러와 함께 종료. 모든 로그는 `logs/` 디렉토리에 자동 기록.

데몬화:
```bash
nvm use 22
pm2 start dist/index.js --name claude-x-discord --interpreter $(which node)
```

### 11.5 Error Handling

| Level | Scenario | Response |
|-------|----------|----------|
| 1 | Claude 프로세스 크래시 | 다음 메시지 시 자동 재spawn + `--resume`으로 세션 복구 |
| 2 | Discord 연결 끊김 | discord.js 자동 재연결 |
| 3 | 봇 프로세스 크래시 | pm2 자동 재시작 + sessions.db에서 매핑 복원 |
| 4 | 승인 요청 타임아웃 | 5분 후 자동 Deny + Discord 알림 |

---

## 12. File Attachments

### 12.1 Problem

Discord 2000자 제한으로 파일 내용을 텍스트로 보내기 어려움. "이 파일 보내줘"라고 하면 Claude가 내용을 텍스트로 출력하지만, 긴 파일은 잘리거나 여러 메시지로 분할됨.

### 12.2 Solution: `<<<ATTACH:...>>>` Marker System

시스템 프롬프트에 마커 사용법을 주입. Claude가 파일 전송 요청 시 `<<<ATTACH:/absolute/path>>>` 마커를 출력하면, 세션 매니저가 파일을 읽어 Discord AttachmentBuilder로 전송.

```
사용자: "pyproject.toml 보내줘"
Claude 출력: "파일을 첨부합니다.\n<<<ATTACH:/path/to/pyproject.toml>>>"
                     │
                     ▼
세션 매니저 onExit 핸들러:
  1. 정규식으로 마커 추출: /<<<ATTACH:(\/[^>]+)>>>/g
  2. 경로 검증: normalize() → 프로젝트 디렉토리 내부만 허용
  3. 파일 크기 확인: ≤25MB (Discord 제한)
  4. 최대 10개 파일
  5. 마커를 버퍼에서 제거
  6. 텍스트 메시지 전송 후 파일 첨부 전송
```

### 12.3 Security

| 검증 | 설명 |
|------|------|
| 경로 정규화 | `normalize()`로 `..` traversal 공격 방지 |
| 프로젝트 격리 | `filePath.startsWith(projectRoot)` — 프로젝트 외부 파일 차단 |
| 크기 제한 | 25MB (Discord 업로드 제한) |
| 개수 제한 | 최대 10개 파일 per 응답 |
| 스트리밍 제거 | onData에서도 마커를 제거하여 미리보기에 노출 방지 |

---

## 13. Remote Control (`/rc`)

### 13.1 Problem

Discord의 2000자 제한, 마크다운 렌더링 제약, 모바일에서의 코드 리뷰/편집 불편함. 기존 SSE 웹 채팅은 제한된 UI만 제공.

### 13.2 Solution: Claude Code Remote Control

`/rc` 명령으로 `claude remote-control`을 spawn. Anthropic 서버에 outbound 연결하여 `claude.ai/code`에서 Full Claude Code UI를 제공. 로컬 포트 오픈 불필요.

### 13.3 Architecture

```
Discord                     SessionManager                    Claude CLI
  │                              │                                │
  ├── /rc ──────────────────► spawnRemoteControl()               │
  │   (deferReply)               │                                │
  │                              ├─ rc-bridge.py (PTY) ──────────►│
  │                              │   claude remote-control        │
  │                              │   --name "ProjectName"         │
  │                              │                                │
  │                              │◄── stdout URL 파싱 ────────────┤
  │                              │   https://claude.ai/code/...   │
  │  ◄── ephemeral URL 응답 ─────┤                                │
  │                              │                                │
  │                              │   rcProcesses Map에 저장        │
  │                              │   (topicId → ChildProcess)     │
  │                              │                                │
  │  (브라우저/모바일 접속)        │                                │
  │  claude.ai/code ─────────────┼── Anthropic 터널 ─────────────►│
  │  Full Claude Code UI         │   (파일 편집, 도구, MCP 등)     │
  │                              │                                │
  │  /stop ──────────────────► proc.kill() + Map 삭제             │
```

### 13.4 PTY Bridge (rc-bridge.py)

`claude remote-control`은 Ink/React 기반 TUI로, stdout이 TTY가 아니면 출력을 억제한다.
Python PTY 브릿지(`scripts/rc-bridge.py`)가 PTY를 할당하여 TUI 출력을 Node.js pipe로 릴레이.

- `claude-bridge.py`와 동일한 패턴이지만 더 단순: stdin relay 불필요 (RC는 웹 UI로 제어)
- ANSI escape 코드 제거 후 URL regex 매칭
- 30초 타임아웃 (URL 미출력 시 실패)

### 13.5 Process Lifecycle

1. `/rc` → `deferReply()` (spawn에 수초 소요)
2. `spawnRemoteControl()` → `rc-bridge.py` → `claude remote-control`
3. stdout에서 `https://claude.ai/code/...` URL 파싱
4. `rcProcesses` Map에 저장 (topicId → ChildProcess)
5. Ephemeral Discord 응답으로 URL 반환
6. `exit` 이벤트 시 Map에서 자동 삭제
7. `/stop` 또는 봇 shutdown 시 SIGTERM으로 정리

### 13.6 Web Chat Server (별도)

WebChatServer (`src/web/server.ts`)는 여전히 포트 3848에서 동작하며 RC와 독립적이다.
SSE 기반 웹 채팅 기능은 유지되지만, `/rc` 커맨드는 더 이상 웹 채팅 토큰을 생성하지 않는다.

---

## Appendix: Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CLI stdout 릴레이 | Python Bridge | Node.js stdin pipe 시 stdout 비어있는 버그 해결 |
| 프로세스 모델 | 메시지별 spawn + --resume | stdin pipe 방식의 stdout 버그 회피, 세션 연속성은 --resume이 보장 |
| 프로젝트 관리 | Discord Forum Topics | 7+ 프로젝트 동시 관리, 자동 아카이브 |
| AI debate 방식 | 각 CLI 독립 실행 + debateContext 주입 | Synthesis 단계 제거, 사용자가 자연어로 종합 요청 가능 |
| debate 컨텍스트 | debateContext Map → 다음 prompt 주입 | Discord 메시지는 Claude CLI 세션에 안 보이므로, 명시적 주입 필요 |
| 다중 기기 | 별도 Discord 봇 (별도 토큰) | 같은 토큰 2기기 = 이벤트 충돌, 별도 봇이 안전 |
| 아키텍처 | 경량 단일 프로세스 데몬 | 단순, 리소스 효율, pm2로 충분 |
| 출력 포맷 | 하이브리드 (메시지 분할 + 파일 첨부) | 짧은 건 즉시, 긴 건 파일로, 코드 블록 분할 자동 처리 |
| 설정 관리 | .env (시크릿) + config.yaml (설정) | 역할 분리, `pnpm start` 한 줄 실행 |
| 스트림 중복 방지 | assistant 텍스트 무시 + result 버퍼 교체 | Claude stream-json 3중 텍스트 전송 문제 해결 |
| 파일 전송 | `<<<ATTACH:...>>>` 마커 시스템 | Claude가 자연어로 마커를 출력, 시스템이 파일 읽기/첨부. 별도 도구 호출 불필요 |
| 웹 채팅 프로토콜 | SSE (Server-Sent Events) | WebSocket 대비 단순, `ws` 의존성 불필요, EventSource 자동 재연결 |
| 웹 채팅 인증 | URL 기반 UUID 토큰 | 모바일 편의성 (URL 탭만으로 접속), ephemeral Discord 응답으로 보안 |
| 웹 채팅 HTML | 인라인 문자열 | 파일 서빙 라우터 불필요, 단일 파일 배포, CDN marked.js로 마크다운 렌더링 |
| Bridge stdin | PTY (Claude), DEVNULL (others) | Claude CLI가 `isTTY` 검사 — pipe stdin이면 `-p`에도 입력 대기. PTY로 isTTY=true 보장 |
| Bridge exit | `os._exit()` (no `sys.stdin.close()`) | `relay_stdin` 스레드가 BufferedReader lock 보유 → `sys.stdin.close()` 호출 시 deadlock. `os._exit()`는 즉시 종료 |
| Bridge stdout | Daemon thread + `proc.wait()` | CLI 자식 프로세스가 stdout pipe 상속 → blocking read 무한 대기. `proc.wait()`로 종료 감지 후 강제 종료 |
| 메시지 대기열 | 최신 메시지만 처리 | Claude 실행 중 추가 메시지를 queue에 보관, 완료 후 가장 최신 메시지만 처리 (중간 것 폐기) |
| `/rc` Remote Control | `claude remote-control` + PTY 브릿지 | SSE 웹 채팅 대신 Full Claude Code UI 제공. Anthropic 터널링으로 inbound 포트 불필요 |
| RC PTY 브릿지 | `rc-bridge.py` (별도 스크립트) | `remote-control` TUI가 stdout TTY 검사 — pipe면 출력 억제. PTY로 TUI 출력을 Node.js로 릴레이 |

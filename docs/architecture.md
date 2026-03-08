# Architecture

## Project Structure

```
claude-x-discord/
├── scripts/
│   ├── claude-bridge.py        ← Python 브릿지 (Node→Python→CLI stdout 릴레이)
│   └── rc-bridge.py            ← Remote Control PTY 브릿지 (TUI stdout 릴레이)
│
├── src/
│   ├── index.ts                 ← 엔트리포인트 (main)
│   ├── session-manager.ts       ← 중앙 오케스트레이터
│   │
│   ├── config/
│   │   ├── schema.ts            ← Zod 스키마 (configSchema, envSchema)
│   │   ├── loader.ts            ← .env + config.yaml 로더
│   │   └── index.ts             ← barrel export
│   │
│   ├── claude/
│   │   ├── parser.ts            ← stream-json 청크 파싱 (승인 요청/세션ID 감지)
│   │   ├── process.ts           ← ClaudeProcess (Python 브릿지 wrapper, EventEmitter)
│   │   ├── pool.ts              ← ClaudePool (메시지별 프로세스 생성/관리)
│   │   ├── remote-control.ts    ← spawnRemoteControl() (RC PTY 브릿지 spawn + URL 파싱)
│   │   └── index.ts             ← barrel export
│   │
│   ├── discord/
│   │   ├── client.ts            ← DiscordGateway (discord.js 래퍼, autocomplete 포함)
│   │   ├── forum.ts             ← ForumManager (Forum Topic CRUD)
│   │   ├── buttons.ts           ← 승인 버튼 생성/파싱
│   │   └── index.ts             ← barrel export
│   │
│   ├── db/
│   │   ├── sessions.ts          ← SessionsDB (프로젝트/세션 매핑)
│   │   ├── memory.ts            ← MemoryDB (FTS5 전문 검색 + 대화 이력)
│   │   └── index.ts             ← barrel export
│   │
│   ├── formatter/
│   │   └── index.ts             ← 하이브리드 포매터 (2000자 분할 + 파일 첨부)
│   │
│   ├── utils/
│   │   └── logger.ts            ← 태그 로거 + 파일 로깅 (console.log 인터셉트)
│   │
│   ├── commands/
│   │   ├── registry.ts          ← CommandRegistry (등록/배포) + Command/CommandContext 인터페이스
│   │   ├── custom-loader.ts     ← ~/.claude-x-discord/commands/ 로더
│   │   ├── index.ts             ← barrel export
│   │   ├── register.ts          ← /register (경로 autocomplete, fuzzy 매칭)
│   │   ├── unregister.ts        ← /unregister (case-insensitive)
│   │   ├── projects.ts          ← /projects (machine_name 표시)
│   │   ├── status.ts            ← /status
│   │   ├── stop.ts              ← /stop
│   │   ├── reset.ts             ← /reset
│   │   ├── help.ts              ← /help (machine_name 표시)
│   │   ├── health.ts            ← /health
│   │   ├── remember.ts          ← /remember
│   │   ├── recall.ts            ← /recall
│   │   ├── debate.ts            ← /debate (결과→debateContext 저장)
│   │   └── rc.ts                ← /rc (Claude Code Remote Control 세션 시작)
│   │
│   ├── debate/
│   │   ├── context.ts           ← 프로젝트 팩트 수집 (현재 미사용, CLI가 자체 탐색)
│   │   ├── runner.ts            ← Python 브릿지 경유 Claude/Gemini/Codex 병렬 실행
│   │   └── index.ts             ← barrel export
│   │
│   ├── web/
│   │   └── server.ts            ← WebChatServer (HTTP + SSE, 인라인 HTML, 토큰 인증)
│   │
│   └── memory/
│       ├── evolution.ts         ← 자동 학습 트리거 + 교훈 추출
│       ├── persona.ts           ← USER.md/PATTERNS.md/LESSONS.md 관리
│       └── index.ts             ← barrel export
│
├── tests/
│   ├── config/loader.test.ts
│   ├── claude/parser.test.ts
│   ├── claude/pool.test.ts
│   ├── db/sessions.test.ts
│   ├── db/memory.test.ts
│   ├── discord/buttons.test.ts
│   ├── formatter/index.test.ts
│   ├── debate/context.test.ts
│   ├── memory/evolution.test.ts
│   ├── web/server.test.ts           ← WebChatServer HTTP/SSE/토큰 테스트 (15개)
│   ├── integration/attachments.test.ts  ← 파일 첨부 마커/보안 테스트 (13개)
│   └── integration/smoke.test.ts
│
├── .nvmrc                       ← Node 22 지정 (nvm use 자동 선택)
├── config.yaml                  ← 동작 설정 (machine_name 포함)
├── .env                         ← 시크릿/환경변수
├── logs/                        ← 일별 자동 로테이션 로그 ({machine_name}-{날짜}.log)
└── data/
    ├── memory.db                ← SQLite + FTS5
    └── sessions.db              ← 세션/프로젝트 매핑
```

## Data Flow

### Message Flow (일반 메시지)

```
Discord User Message
        │
        ▼
  DiscordGateway (client.ts)
   ├── Slash Command? ──► CommandRegistry ──► Command.execute()
   ├── Autocomplete?  ──► Command.autocomplete()
   ├── Button Click?  ──► SessionManager.handleButton()
   └── Message?       ──► SessionManager.handleMessage()
                              │
                    ┌─────────┤ Claude 실행 중? → queue에 보관 (최신만 처리)
                    │         │ debateContext 확인 (있으면 prompt에 선행 주입)
                    ▼
            SessionsDB.getProjectByTopicId()
                    │
                    ▼
            ClaudePool.run(topicId, prompt, {cwd, sessionId})
                    │
                    ▼
            ClaudeProcess.run(prompt)
                    │
                    ▼
              Python Bridge (claude-bridge.py)
                    │
                    ▼
              Claude CLI (child_process)
                --cwd /proj/myapp
                --resume sess_abc
                --output-format stream-json
                --verbose
                    │
                    ▼ stdout (JSON lines)
              parser.parseJsonStreamChunk()
                ├── text (content_block_delta) → debounced message.edit()
                ├── result (isComplete)        → buffer 교체 (최종 텍스트)
                ├── approval                   → sendApprovalRequest() [Approve][Deny]
                └── session                    → sessions.updateSession()
                    │
                    ▼ (on exit)
              <<<ATTACH:...>>> 마커 추출
                ├── 경로 검증 (프로젝트 내부만, ≤25MB, 최대 10개)
                ├── 유효 파일 → AttachmentBuilder[]
                └── 마커를 버퍼에서 제거
                    │
                    ▼
              formatForDiscord(buffer)
                ├── ≤2000자 × 5파트 이하 → 일반 메시지
                ├── >5파트              → 미리보기 2개 + .md 첨부
                └── 파일 첨부 → Discord attachment로 전송
```

### Remote Control Flow (/rc)

```
/rc 명령어
        │
        ▼
  rc.ts → spawnRemoteControl(project_path, project_name)
        │
        ▼
  rc-bridge.py (PTY 할당 + claude remote-control 실행)
        │
        ▼
  claude remote-control --name "ProjectName"
        │  (Anthropic 서버에 outbound 연결, inbound 포트 불필요)
        ▼
  stdout에서 URL 파싱: https://claude.ai/code/session_...?bridge=env_...
        │
        ▼
  ephemeral Discord 응답으로 URL 반환
        │
        ▼ (브라우저/모바일에서 접속)
  claude.ai/code → 로컬 Claude 프로세스로 터널링
        │  (Full Claude Code UI: 파일 편집, 도구, MCP 서버 등)
        │
        ▼
  /stop 또는 프로세스 종료 시 세션 정리
```

Note: WebChatServer (server.ts)는 별도로 계속 동작한다 (포트 3848). RC와 무관.

### Debate Flow (/debate)

```
/debate "Redis vs SQLite 캐싱"
        │
        ▼
  debate.ts → runDebate()
        │
        ▼ (병렬 실행)
  ┌─────┼─────┐
  ▼     ▼     ▼
Claude Gemini Codex     ← 각각 Python 브릿지 경유 CLI spawn
  │     │     │
  ▼     ▼     ▼
 결과 파싱 (runner.ts)
  │     │     │
  ▼     ▼     ▼
 Discord 일반 메시지로 전송 (AI별 개별 메시지)
        │
        ▼
 debateContext Map에 결과 저장
        │
        ▼ (다음 메시지)
 handleMessage에서 debateContext 감지 → prompt에 주입 → 자동 삭제
```

## Key Design Decisions

### Python Bridge Pattern

Node.js에서 Claude CLI를 `child_process.spawn()`으로 직접 실행하면 stdin이 pipe될 때 stdout이 비어있는 버그 발생.
해결: Python 브릿지 스크립트(`scripts/claude-bridge.py`)가 중간에서 CLI를 spawn하고 stdout을 릴레이.
Node.js → Python → CLI → stdout → Python → Node.js 순서로 데이터 전달.
동일한 브릿지가 claude, gemini, codex 세 CLI 모두를 지원.

**PTY**: Claude CLI는 `stdin.isTTY`를 검사하여 pipe stdin이면 입력 대기에 빠짐. PTY(`pty.openpty()`)로 isTTY=true 보장. Gemini/Codex는 `DEVNULL`.

**Threading**: 3개 daemon 스레드(stdout/stderr/stdin relay) + 메인 스레드(`proc.wait()`). CLI 자식 프로세스가 stdout pipe를 상속하면 blocking read가 멈출 수 있어, stdout을 daemon 스레드로 분리하고 `proc.wait()` 반환 후 2초 drain → `os._exit()`.

### Message Queue

Claude 실행 중 추가 메시지 도착 시 queue에 보관. 완료 후 가장 최신 메시지만 처리하고 이전 것은 폐기 (latest intent wins).

### Per-Message Process Spawn

stdin pipe 방식 대신, 매 메시지마다 새 프로세스를 생성하고 `--resume sessionId`로 이전 컨텍스트를 복원.
프로세스는 응답 완료 후 종료. Claude CLI의 `--resume` 플래그가 세션 연속성을 보장.

### Multi-Machine Support

`config.yaml`의 `machine_name` 필드로 기기 식별. 봇 Presence, `/register`, `/projects`, `/help`에 표시.
다중 기기 배포 시 각 기기별 별도 Discord 봇 (별도 토큰) 사용. 같은 서버, 다른 Forum Channel.

### CLI Streaming (not Agent SDK)

Claude Max 구독 사용 → API key 없음 → `claude` CLI를 직접 실행.
`--cwd`, `--resume`, `--verbose` 플래그로 프로젝트/세션 격리 + MCP/plugin 완전 호환.

### Single Process Daemon

모든 컴포넌트가 하나의 Node.js 프로세스 안에서 동작.
Claude/Gemini/Codex 프로세스만 별도 child_process. pm2로 데몬화.

### SQLite WAL + FTS5

경량 단일 파일 DB. WAL 모드로 읽기/쓰기 동시성. FTS5로 메모리 전문 검색.

### Hybrid Formatter

Discord 2000자 제한 대응. 짧은 응답은 즉시 표시, 긴 응답은 미리보기 + `.md` 파일 첨부.
코드 블록 분할 시 자동으로 닫기/열기 처리. Markdown 테이블은 코드 블록으로 변환 (Discord 미지원).

### Stream Deduplication

Claude stream-json은 동일 텍스트를 3가지 방식으로 전송 (content_block_delta, assistant, result).
파서에서 assistant 타입의 텍스트를 무시하고, result (isComplete) 도착 시 버퍼를 교체하여 중복 방지.

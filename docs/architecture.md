# Architecture

## Project Structure

```
claude-x-discord/
├── scripts/
│   └── claude-bridge.py        ← Python 브릿지 (Node→Python→CLI stdout 릴레이)
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
│   │   └── debate.ts            ← /debate (결과→debateContext 저장)
│   │
│   ├── debate/
│   │   ├── context.ts           ← 프로젝트 팩트 수집 (현재 미사용, CLI가 자체 탐색)
│   │   ├── runner.ts            ← Python 브릿지 경유 Claude/Gemini/Codex 병렬 실행
│   │   └── index.ts             ← barrel export
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
│   └── integration/smoke.test.ts
│
├── config.yaml                  ← 동작 설정 (machine_name 포함)
├── .env                         ← 시크릿/환경변수
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
                    ┌─────────┤ debateContext 확인
                    │         │ (있으면 prompt에 선행 주입)
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
              formatForDiscord(buffer)
                ├── ≤2000자 × 5파트 이하 → 일반 메시지
                └── >5파트              → 미리보기 2개 + .md 첨부
```

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
코드 블록 분할 시 자동으로 닫기/열기 처리.

### Stream Deduplication

Claude stream-json은 동일 텍스트를 3가지 방식으로 전송 (content_block_delta, assistant, result).
파서에서 assistant 타입의 텍스트를 무시하고, result (isComplete) 도착 시 버퍼를 교체하여 중복 방지.

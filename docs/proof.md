# harness-kit 실측

> 원천: `node proof/run.mjs` · `node proof/run.mjs --claude` · `node proof/setup-e2e.mjs` — 값이 아니라 이 명령을 남긴다. 요약은 [README](../README.md#실측)

합성 대상(임시 git 저장소)에서 잰 세 층, graph 모듈을 운영 중인 원천 프로젝트의 데이터로 잰 한 층, 키트를 얹은 실제 프로젝트의 세션 기록으로 잰 관문 사용이다. 키트 전체의 효과를 실제 프로젝트에서 하네스 없을 때와 대조해 잰 것은 아직 없다 — 그래서 딱지는 전부 `설계안` 이다.

| 층 | 재현 | 무엇을 |
|---|---|---|
| 운영 데이터 | 재현 불가 — 원천 프로젝트의 기록 · 이슈 · 프롬프트 | graph 모듈 대조 2회 · 훅 재생 |
| 결정론 | `node proof/run.mjs` | 하네스 없이 vs 있을 때 — LLM 없음 |
| 새 세션 | `node proof/run.mjs --claude` | 규칙 로드 · ponytail 끄기 · 플러그인 (haiku) |
| SETUP 종단 | `node proof/setup-e2e.mjs` | 새 sonnet 세션이 SETUP 을 처음부터 끝까지 따르는가 → `proof/check-install.mjs` 가 파일 · git · 도구 출력으로 판정 |
| 실제 설치 | 재현 불가 — 설치한 프로젝트의 세션 기록 | 코드를 바꾼 턴에 verify · final-gate 가 따랐나 |

## 결정론 — `node proof/run.mjs`

| | |
|---|---|
| 일시 | 2026-10-03 02:27 UTC (P9 「미커밋 변경 2건 위에 설치」 행은 2026-10-12 에 더했다) |
| 환경 | win32 · Node v24.18.0 |
| 예상과 다른 행 | 0개 / 30행 |

| 실험 | 조건 | 관측 | 예상대로 |
|---|---|---|---|
| P1 거짓 완료 | 테스트 파일에 test() 가 없다 | npm test exit 0 (ℹ pass 1) → verify exit 1 · 실행된 테스트가 0개다 (XML 1개 · 테스트 없는 파일 1개는 세지 않았다) | ✅ |
| P1 거짓 완료 | 실패하는 테스트 | npm test exit 1 → verify exit 1 · 종료코드 1 · 테스트 1 · 실패 1 | ✅ |
| P1 거짓 완료 | 고쳤다 | npm test exit 0 → verify exit 0 · 테스트 1 · 실패 0 | ✅ |
| P1 거짓 완료 | 테스트 명령이 아무것도 안 돌게 바뀜 (직전 통과 XML 이 남음) | npm test exit 0 · 남은 XML 만 읽으면 통과 → verify exit 1 · 결과 XML 이 이번 실행에서 갱신되지 않았다 | ✅ |
| P1b CLI 판별 | file:// 판별식 (win32) | exit 0 · 아무것도 안 돌았다 | ✅ |
| P1b CLI 판별 | lib/config.mjs 의 cli() | exit 1 · 돌았다 | ✅ |
| P6 기준선 | 원래 있던 실패 1 · 기준선 없음 | npm test exit 1 → verify exit 1 · 테스트 2 · 실패 1 | ✅ |
| P6 기준선 | 사용자가 「원래 있던 실패」라고 확인 → verify --baseline | 기준선 1건 → verify exit 0 · 테스트 2 · 실패 0 · 기준선 실패 1 | ✅ |
| P6 기준선 | 기준선 밖에 새 실패 | verify exit 1 · 테스트 3 · 실패 1 (기준선 밖) · 기준선 실패 1 | ✅ |
| P6 기준선 | 원래 있던 실패를 고쳤다 | verify exit 0 · 기준선에서 통과 1 — 기준선을 줄인다 (verify --baseline) | ✅ |
| P7 output-match | 검증 쿼리가 rows=0 을 낸다 (기대 ^rows=0$) | 명령 exit 0 → verify exit 0 · 출력이 기대와 맞는다 | ✅ |
| P7 output-match | 검증 쿼리가 rows=3 을 낸다 | 명령 exit 0 → verify exit 1 · 출력이 /^rows=0$/ 와 맞지 않는다 | ✅ |
| P5 가정 | 20일 묵은 열린 질문 1건 | 열린 결정 1건 · 갱신 후 20일(경과일을 반올림해 실행 시각에 따라 21일) · 경고 · exit 0 | ✅ |
| P5 교훈 | 근본 원인 없이 적기 | exit 1 · ⛔ 근본 원인이 비었다 | ✅ |
| P5 교훈 | 같은 분류 2회 · 막는 것 없음 | 검증 부족 ×2 (L001 L002) | ✅ |
| P5 대장 | 분석 뒤 원본이 바뀜 + 가리키는 파일 소멸 | 대장 2행 · 재작업 1 · 소멸 1 · exit 1 | ✅ |
| P8 그래프 | 「적립금」으로 묻는다 (코드에는 point_balance 뿐) | 코드에서 「적립금」 0건 → graph-find 가 실체 · 함정을 냄 | ✅ |
| P8 그래프 | 훅 — 업무 내용 없는 발화 | 침묵 | ✅ |
| P8 그래프 | 훅 — 정확일치 (cwd 가 대상 밖이어도) | 카드 + 탈출구 문장 | ✅ |
| P8 그래프 | 훅 — 하다 만 기록(⏸)이 순위 밖 | ⏸ 열린 작업 줄이 붙음 | ✅ |
| P8 그래프 | --check (기록 4 · 경로 실재) | exit 0 | ✅ |
| P9 설치 모드 | 로컬 · 같은 PC | install-mode local exit 0 · git 에 보이는 설치 파일 0개 | ✅ |
| P9 설치 모드 | 로컬 · 미커밋 변경 2건 위에 설치 | git status 설치 전 2줄 → 뒤 2줄 (같음) · 작업 중 파일 2개 내용 그대로 | ✅ |
| P9 설치 모드 | 공유(명시적 선택) · 모의 전역 무시가 .claude/ · AGENTS.md · CLAUDE.md 를 숨긴다 | 하네스 없이 git 에 보이는 지시·규칙 파일 0개 → install-mode share exit 0 · 5개 | ✅ |
| P9 설치 모드 | 공유 · 사번 형식이 든 기록을 커밋 → 걷어내고 다시 커밋 | pre-commit 막음 ([사번 형식] AB******) → 통과 | ✅ |
| P10 판별 | 커밋 1 · 소스 2 | new/local | ✅ |
| P10 판별 | 커밋 25 · 소스 3 | existing/local | ✅ |
| P10 판별 | 커밋 1 · 소스 60 | existing/local | ✅ |
| P4 설정 병합 | 공유 — 기존 settings(권한 1 · 훅) 위에 정책 반영 | 정책 반영 · 기존 권한 · 훅 보존 | ✅ |
| P4 설정 병합 | 로컬 — --local --with graph-hook 두 번 (중복 처리 false 가 있음) | settings.json 그대로 · 훅 1개 · 끈 플러그인 꺼진 채 · 재실행 같음 | ✅ |

## 새 세션 — `node proof/run.mjs --claude`

| | |
|---|---|
| 일시 | 2026-10-02 12:14 UTC |
| 환경 | win32 · Node v24.18.0 · Claude Code 2.1.287 |
| 예상과 다른 행 | 0개 / 41행 (당시 결정론 29행 + 아래 12행 — 결정론은 이후 30행) |
| 플러그인 기록 | 실측 전 · 후 같다 — 사용자 범위 4줄 |

| 실험 | 조건 | 관측 | 예상대로 |
|---|---|---|---|
| P2 규칙 로드 | CLAUDE.md 있음 · 규칙을 AGENTS.md 에 | 완료 명령 → 「모름」 (규칙이 안 읽혔다) | ✅ |
| P2 규칙 로드 | CLAUDE.md 없음 · 규칙을 AGENTS.md 에 | verify.mjs 를 답함 | ✅ |
| P2 규칙 로드 | CLAUDE.md 있음 · 규칙을 .claude/rules/ 에 | verify.mjs 를 답함 | ✅ |
| P2 규칙 로드 | AGENTS.md 만 있음 · 규칙을 .claude/rules/ 에 | verify.mjs 를 답함 | ✅ |
| P2 규칙 로드 | CLAUDE.md 없음 · 규칙을 AGENTS.md 에 · 8.3 단축 경로로 연 세션 | 「모름」 | ✅ |
| P2 규칙 로드 | CLAUDE.md 있음 · 규칙을 .claude/rules/ 에 · 8.3 단축 경로로 연 세션 | verify.mjs 를 답함 | ✅ |
| P2 규칙 로드 | .claude/rules/graph.md · 그래프 조회 명령 (양성) | graph-find.mjs 를 답함 | ✅ |
| P2 규칙 로드 | 음성 대조 (지시에 없는 사실) | 「모름」 | ✅ |
| P4 플러그인 | 중복 처리 뒤 (로컬에서 끈 정책 id: superpowers@claude-plugins-official) | 활성 id — superpowers 1개 · ponytail 1개 | ✅ |
| P3 ponytail | 정책 반영 (env PONYTAIL_DEFAULT_MODE=off) | 훅의 PONYTAIL MODE ACTIVE 0회 | ✅ |
| P3 ponytail | 정책 미반영 (대조군) | 훅의 PONYTAIL MODE ACTIVE 2회 | ✅ |
| P4 플러그인 | 프로젝트가 선언 + 사용자 범위로 이미 설치 → 세션을 연다 → 정리 | 프로젝트 범위 설치 기록 0 → 1 → 정리 뒤 0 | ✅ |

## SETUP 종단 — `node proof/setup-e2e.mjs` (run4 · 2026-10-02 10:54 UTC)

`claude -p <SETUP 지시> --model sonnet --max-turns 150` 을 대상마다 새 세션으로 돌리고, 끝난 뒤 판정한다. 신규는 프롬프트에 「설치 모드는 팀 공유로 고른다」를 넣어 두 모드를 다 잰다. 기존은 제안값(로컬 전용)이다.

| 대상 | 세션 | 판정 |
|---|---|---|
| 신규 · 공유 (커밋 1 · 테스트 0 · 스펙 문서) | exit 0 · 5.9분 · 12턴 · $0.35 | **20/20 ✅** |
| 기존 · 로컬 전용 (커밋 25 · 통과 6 + 원래 실패 1 · AGENTS.md · 인수인계 문서) | exit 0 · 7.1분 · 16턴 · $0.47 | **18/20** — ⛔ 2행은 아래 |

| 묶음 | 기대 | 신규 · 공유 | 기존 · 로컬 |
|---|---|---|---|
| 공통 | `.harness/` 도구 12 · lib · 정책 · 규칙 2 · final-gate · 자리표시 0 | ✅ | ✅ |
| 공통 | harness.json 검사 ≥ 1 · 프로필 · 모드 | ✅ 검사 1 · new · share | ✅ 검사 1 · existing · local |
| 공통 | 정책 반영 (ponytail off · 플러그인 선언) | ✅ settings.json | ✅ settings.local.json |
| 공통 | 플러그인 id 하나씩 · 장부 위치 · 훅 없음(20건 미만) · graph-find --check exit 0 | ✅ docs/harness · 기록 3 | ✅ .harness/state · 기록 3 |
| 모드 | 공유: 설치 경로 추적 가능 · AGENTS.md + CLAUDE.md(@AGENTS.md) · pre-commit → scan-shared · scan-shared exit 0 / 로컬: 전부 무시됨 · settings.json 없음 · CLAUDE.local.md(@AGENTS.md) · CLAUDE.md 안 만듦 | ✅ 4행 (당시 패턴 6종 · 파일 5 · 걸린 것 0) | ✅ 2행 |
| 신규 | lessons 소급 0 · 스펙 용어 3 시드(「설계 용어」) · verify 가 「실행된 테스트가 0개」로 실패 | ✅ 3행 | — |
| 기존 | AGENTS.md 그대로 · 기준선에 원래 실패 1 · verify exit 0(기준선 실패 1) · lessons 3(근본 원인 3) · 주제 기록 3 · 인수인계 용어 4/5 | — | ✅ 5행 |
| 규칙 로드 | 양성 2(완료 명령 · 그래프 조회) · 음성 1 | ✅ 3행 | ⛔ 완료 명령 「모름」 · ✅ 그래프 · ✅ 음성 |
| 정리 | 이 대상의 플러그인 기록 · 실측 전후 기록 전체 | ✅ project 기록 1 → 0 | ⛔ local 범위 기록 1 이 남음 |

**⛔ 2행 — 하네스가 아니라 실험이 틀렸다**

- **규칙 로드 「모름」** — 같은 설치 대상에 같은 질문을 3번 더 하니 2번은 verify.mjs 를 답했고, 「모름」 답은 「완료 명령은 작업 유형마다 다르다」고 이유를 댔다 — 규칙은 읽혔다. 질문이 「작업 완료 전에 반드시 돌리는 명령 하나」를 묻는데 규칙은 작업 종류별 증거(설계 §4)를 준다. 질문을 「**코드를 바꾼 작업**의 완료」로 좁히자 두 대상 모두 **3/3** verify.mjs (SETUP ⑧-b · `proof/run.mjs` · `setup-e2e` 의 질문을 고쳤다)
- **local 범위 기록이 남음** — 로컬 전용은 플러그인을 `settings.local.json` 에 선언하므로 세션이 남기는 기록이 project 가 아니라 **local 범위**다(실측). 정리가 project 만 지웠다. 그 자리에서 `claude plugin uninstall ponytail@ponytail --scope local --keep-data` 로 되돌렸고(뒤 기록 = 사용자 범위 4줄), 정리는 두 범위를 다 지우게 고쳤다

**run3 — 분류기가 ⑥ 을 막았다.** 첫 실측(run3)의 기존 대상에서 `node .harness/tools/policy-apply.mjs --local` 이 auto 모드 분류기에 `Self-Modification` 으로 거부됐다 — Claude 자신의 권한 목록을 쓰는 명령이다. 세션은 다른 도구로 같은 파일을 써서 우회하지 않고, 보고의 「사용자가 결정해야 하는 것」 맨 앞에 「policy-apply 를 허용하거나 직접 실행」을 남겼다. 같은 명령이 run3 신규 대상과 run4 기존 대상에서는 통과했다 — 분류기 판정은 세션마다 다르다. ⇒ SETUP ⑥ 에 「막히면 우회하지 말고 사용자에게 `! node .harness/tools/policy-apply.mjs --local` 로 넘긴다」를 적었다(보안 경계라 이 방식이 맞다). 같은 run3 에서 신규 대상의 판정 ⛔ 1행은 지도 골격 템플릿이 명령 인자를 `<용어>` 로 적어 「채우지 않은 자리」로 보인 것이라 템플릿을 고쳤다(run4 에서 ✅).

**그 밖에 실측에서 드러난 것**

- `claude -p` 의 `--allowedTools` · `--disallowedTools` 는 가변 인자라, 맨 뒤에 둔 프롬프트를 도구 규칙으로 삼킨다 — 세션이 0.4분 만에 「Input must be provided」로 죽었다(run2). 프롬프트는 `-p` 바로 뒤에 둔다
- 프로젝트 `.claude/settings.json` 의 allow 는 그 폴더를 **신뢰(trust)한 뒤에만** 적용된다 — 신뢰 전에는 「Ignoring 17 permissions.allow entries」. SETUP ⑨ 의 「새로 생기는 제약」에 넣었다
- 실측은 `~/.claude/projects/` 에 임시 대상마다 폴더를 남긴다(세션 기록). 플러그인 설치 기록은 스크립트가 되돌리고 전후를 대조한다
- 이 PC(16코어)에서 `node --test` 기본 병렬(파일 15개 동시)일 때 프로세스 생성이 `spawn EPERM` 으로 거부돼 `npm test` 5회 중 1회가 실패했다(`tools/verify.mjs` 의 `exec`). `--test-concurrency=4` 로 5회 중 0회, 시간은 그대로다(128~160초 → 128~149초). ⚠️ 표본 5회 — 0회가 「없다」는 증명은 아니다. verify 는 생성 실패를 실패로 닫으므로 재시도를 넣지 않았다
- **첫 실전 적용(신규 · 모노레포 Gradle + Vite)에서** — Windows 의 Claude Code 는 `NoDefaultCurrentDirectoryInExePath=1` 을 걸어 `cmd` 가 현재 폴더의 실행 파일을 찾지 않는다. SETUP ⑤ 의 `gradlew cleanTest test` 가 「내부 또는 외부 명령이 아닙니다」로 실패했다(`gradlew.bat` 도 같다). 저장소 안 래퍼는 `.\gradlew` · `.\mvnw` 로 적는다 — PATH 의 `mvn` · `npx` 는 상관없다. 재현(현재 폴더의 `.bat` 래퍼 · `cmd`):

  | 명령 | 변수 있음 | 변수 없음 |
  |---|---|---|
  | `fakew` | 실패 | 실행 |
  | `.\fakew` | 실행 | 실행 |
  | `./fakew` | 실패 | 실패 |
- 테스트와 결정론 실측은 자기가 만든 임시 폴더를 끝에 지운다 — `npm test` 11회 · `proof/run.mjs` 1회 전후로 `%TEMP%` 의 `harness-*` · `graph-*` · `gitcfg-*` · `hooks-*` · `proof-*` 개수가 같았다. `setup-e2e` 의 대상(`e2e-*`)은 들여다보라고 남긴다

**실측 뒤에 바뀐 파일 — `setup-e2e` 는 다시 돌리지 않았다.** run4 이후 아래가 바뀌었다. 결정론 실측(`node proof/run.mjs`)과 `npm test` 는 6차 변경 뒤에 다시 돌린 값이고, 새 세션 실측(`--claude`)은 6차 변경 전 값(6차는 `harness.md` 66행을 바꿨다), SETUP 종단 실측은 바뀌기 전 값이다.

| 파일 | 무엇이 |
|---|---|
| `SETUP.md` | ③ 공유 모드 패턴 맞추기(`reviewed`) · `core.hooksPath` 가 git 디렉터리 밖이면 pre-commit 을 쓰지 않음 · ⑤ Windows 의 저장소 안 래퍼는 `.\gradlew` · `.\mvnw`(첫 실전 적용) · ⑥ 플러그인 설치 범위를 모드에 맞춤 · ⑦ 훅 조건 「상위3 점유 < 50%」 · ⑧-b 질문 · ① 미커밋 변경은 로컬 전용에서 멈춤이 아니라 `⚠️ 확인`(6차) · ⑥ 목록을 먼저 보고 다른 마켓 플러그인은 `policy-apply --off`(6차) · ⑧-a · ⑧-e 로컬 전용의 기대를 「설치 전 `git status` 와 같다 · `git diff` 에는 작업 중 변경만」으로(6차) |
| `tools/policy-apply.mjs` | `--off <정책 id>` — 그 플러그인을 모드와 무관하게 `settings.local.json` 에 `false` 로(정책 id 가 아니면 쓰지 않고 exit 1) · 모르는 `--` 인자(`--off=<id>` 등호 꼴)는 대상 폴더로 읽지 않고 쓰지 않은 채 exit 1 |
| `tools/detect.mjs` | 미커밋 변경은 `stop` 이 아니라 `warn`(`⚠️ 확인`) — `CLAUDE.local.md` · `.claude/` 와 겹치면 한 줄 더(한글 경로는 이스케이프 없이 — `core.quotepath=false`) |
| `tools/install-mode.mjs` | ⛔ 보안 — 훅 자리가 저장소 git 디렉터리 밖(전역 `core.hooksPath` · 추적되는 `.husky`)이면 쓰지 않고 한 줄을 안내 |
| `.gitignore` (이 레포) | `!templates/map/AGENTS.md` · `!templates/map/CLAUDE.md` — 전역 gitignore 가 그 이름을 무시하는 PC 에서 템플릿이 커밋에서 빠지던 것 |
| `templates/rules/graph.md` | §1 새 원천 예외 · §4 제목(빈도순 · 피해는 ④) · ④ 새 원천도 단일 증거 · §8 훅 조건 |
| `templates/rules/harness.md` | 플러그인 설치 범위 `--scope local`(공유는 `project`) · 다른 마켓 플러그인은 `policy-apply --local --off <id>` |
| `templates/skills/final-gate/SKILL.md` | 기록 단계에 「기록의 두 장치」 — 남길 게 없으면 한 줄로 · 낡은 기록은 그 자리에서 고친다 |
| `templates/scan.json` | 기본 7종(하이픈 복합 번호 추가 · DB 접속 CLI 인자 · `<낱말> #번호` · 이름 뒤 버전 토큰) · 패턴마다 `놓치는 것` · `reviewed: false` |
| `policy/graph-hook.json` | `_note` 의 훅 조건 |
| `tools/scan-shared.mjs` | `reviewed: false` 인 동안 「기본 패턴 그대로다」 경고 (exit 는 그대로) |
| `tools/graph-measure.mjs` | 패턴마다 `상위3 점유 n%` |
| `tools/graph-find.mjs` · `tools/graph-hook.mjs` | 실측 근거 주석 다섯 줄 (동작 변화 없음 — 주석을 걷은 코드가 같다) |
| `proof/run.mjs` · `proof/setup-e2e.mjs` | 규칙 로드 질문 · 정리 범위(project + local) · 주석의 경로 예시 · 결정론 실측이 자기 임시 대상을 지움 · (`run.mjs`) P9 로컬 · 미커밋 변경 위에 설치 행(git status 같음 + 작업 중 파일 내용 그대로) — `install` 이 장부 위치를 인자로 받는다 |
| `test/scene.mjs` · `test/*.test.mjs` | 공용 `tmp()` — 그 테스트 파일이 끝나면 임시 폴더를 지운다 · 위 변경의 테스트 |
| `package.json` | `--test-concurrency=4` — 기본 병렬에서 `spawn EPERM` 불안정 |
| `docs/design.md` · `docs/plan.md` · `README.md` | 기록 |

## 운영 데이터 — graph 모듈 (2026-10-07)

graph 모듈을 운영 중인 원천 프로젝트(살아있는 기록 146건 · 이슈 제목 605건 · 실제 사용자 프롬프트 401건)에서 쟀다. 키트의 그래프 도구는 원천과 동작이 같다(기록 제목 자기검색 141/146 일치). 대조는 `claude -p` · sonnet 이고, 정답 라벨은 돌리기 전에 확정했다.

**대조 1 — 그래프 · 훅이 있을 때 vs 없을 때** (이슈 8건 · 조사형 질문)

| | 있음 | 없음 | 차 |
|---|---|---|---|
| 도구 호출 | 5 | 56 | −91% |
| 시간 | 309초 | 845초 | −63% |
| 비용 | $1.94 | $2.63 | −26% |
| 정답 | 8/8 | 4/8 (부분 2 · 오답 2) | |

- 「없음」 쪽에도 절차 SQL 템플릿이 남아 있었다 — 효율 격차는 하한값이다
- 라벨은 정본 기록에서 뽑았다 — 정답률은 기록이 맞는 만큼만 유효하다(가장 크게 갈린 1건은 코드로 따로 확인)
- 오답은 「없어진 기능을 살아 있다고 가정」 · 「그럴듯한 계산 규칙」이었다 — 그래프가 막는 것은 탐색 비용보다 이쪽이다

**대조 2 — 약한 신호(2단)에서 전체 색인 vs 침묵** (2단이 뜨는 이슈 8건): 판정 불가 — 정답 7 vs 6 · 도구 30 vs 31(침묵 쪽이 `graph-find` 를 13 → 18회 더 불렀다). 색인이 이긴 2건의 기록은 둘 다 점수가 있었다(2위 · 10위). ⚠️ 색인 쪽은 실험 사본의 프로젝트 설정 훅이 `--settings` 훅과 같이 돌아 색인이 세션마다 **두 번** 들어갔다 — 입력 토큰 비교(2.03M vs 2.04M)는 무효다. 대조 1 의 「있음」 쪽도 같은 폴더 설정이라 두 번 들어갔을 수 있다(그때는 훅 이벤트를 남기지 않았다) — 그렇다면 비용 차이는 하한이다.

**훅 재생 — 실제 프롬프트 401건의 주입 크기** (단계가 바뀐 프롬프트 0건)

| | 전체 주입 | 1단 중앙 · p90 | 2단 중앙 |
|---|---|---|---|
| 이전 | 2,418,976자 | 4,310 · 10,483 | 23,980 |
| 지금 | 922,558자 (−62%) | 2,690 · 4,641 | 1,800 |

- 바꾼 것: 2단은 점수 상위 10건 · 1단 카드 용어는 채점 규칙 ③(한글 토큰은 키에만) · 2위 카드는 정본 · 사전만 전문 — 근거는 `docs/graph-port.md` §5
- 정확성: 대리 지표(대조 1 라벨 21/24 · 대조 2 에서 색인이 이긴 기록 2/2 유지)와 아래 대조 3

**대조 3 — 원래 훅 vs 새 훅** (같은 사본 · 질의 8건 · 프로젝트 설정 훅을 끊고 세션당 주입 1번을 확인 · 조건을 가린 채점): 정답 6 · 부분 2 로 **질의마다 두 조건이 같았다**. 주입은 264KB → 36KB(−86%)지만 입력 토큰은 −2% · 비용 −4% · 도구 43 → 40 · 시간 +7% 다 — 매 턴 다시 읽는 지침이 주입보다 훨씬 크고, 카드가 줄자 `graph-find` 를 한 번 더 부른 질의가 있었다. 정답 기록이 원래 색인에만 있던 패러프레이즈 질의도 두 조건 모두 「부분」이었다 — 전체 색인이 그 기록으로 이끌지 못했다.

## 실제 설치 — 관문 사용 (2026-10-22)

외부 평가가 「verify 를 부르는 것은 스킬과 규칙 문장이라 모델이 잊으면 그만이다 — Stop 훅에서 verify 를 돌려 종료를 막아라」고 했다. 그 전에 실제로 얼마나 잊는지 쟀다. 키트를 얹은 프로젝트 3곳의 설치 뒤 메인 세션 6개(사람 턴 60개)를 봤다. 판정은 기록의 `tool_use` 이름 · 입력만 본다(도구 결과 줄은 파일 내용이 실려 오탐한다). 코드 변경은 Edit · Write · NotebookEdit 중 `.harness/` · `.claude/` · `*.md` 를 뺀 것이다.

| | 값 |
|---|---|
| 코드를 바꾼 사람 턴 | 7 / 60 |
| 마지막 변경 뒤 verify | 5 / 7 — 나머지 2개는 둘 다 verify 검사 밖의 디자인 시안(HTML · JS) |
| 마지막 변경 뒤 final-gate 스킬 | 0 / 7 — 모델은 스킬을 거치지 않고 verify 를 Bash 로 바로 돌린다. final-gate 7회 중 코드 변경 뒤는 1회(서브에이전트 변경 뒤) |
| verify 소요 (n 21) | 중앙 50초 · 최대 164초 |
| 메인이 멈춘 구간(Stop 훅이 발화하는 단위) 중 코드 변경 뒤 verify 없는 구간 | 한 프로젝트에서 25 — 그중 22는 서브에이전트를 기다리는 진행 보고 |
| 메인 세션 도구 호출 합 | graph-find 122 · graph-append 34 · verify 24 · decision-check 20 · lesson-promote 10 · final-gate 7 · lesson-append 7 · state-check 1 |

- 판정 1: 훅에서 verify 를 돌리는 안은 **기각**한다. verify 누락은 0건이고, 훅에서 돌리면 중앙 50초다(그래프 훅 timeout 은 30초). 「verify 없이 멈췄나」만 보는 가벼운 훅도 진행 보고 22번에 울려 신호가 아니다
- 관문 내용(같은 7턴, 마지막 변경 뒤 · 모델 opus): 앱 코드 5턴은 스킬 없이 verify 5/5 · 과설계 리뷰 4/5(나머지 1은 다음 턴에 일괄) · 기록 언급 5/5 · 파일 목록 4/5 · 증거 원문 4/5 를 했다. 빠진 1턴은 `/loop` 중간 보고(「88개 통과」 요약 · 파일 목록은 루프 끝으로)다. 시안 2턴은 과설계 리뷰가 없었다. final-gate 스킬 7회는 모두 이 7턴 밖(설치 · 문서 · 질의응답)이었고 2회는 답하기 전에 불렸다

### 관문 훅 — 사전 시험 (2026-10-22)

「final-gate 가 제일 우선」(사용자)에 따라 스킬 호출 자체를 강제하는 Stop 훅을 시험했다.

| 시험 | 결과 |
|---|---|
| 합성 세션 — 같은 버그 수정, sonnet 헤드리스. A 현행 · B 관문 훅 · C verify 출력에 「보고 전 final-gate」 한 줄. 각 3회 + B 예비 1회 | 10/10 이 훅 없이 final-gate 를 불렀다. 훅이 되돌린 0회 · 비용 $0.16~0.19 · 7~12턴. 짧은 과제에서는 빈틈이 재현되지 않아 세 조건을 가르지 못했다. `/ponytail-review` 는 1/10(나머지는 「한 줄 변경이라 걷어낼 것 없다」) |
| 실제 기록 재생 — 설치 3곳 사람 턴 101개 중 verify 를 돌린 14개 | 「final-gate 를 안 불렀나」 11번 울림(승인 대기 · 실행 요청 3번 포함) · 「보고에 verify 출력 줄이 없나」 8번 울림(같은 3번 포함, 나머지 5번은 「모두 통과(exit 0)」 요약) |
| Stop 훅 입력 (2.1.307 · `-p`) | `stop_hook_active` · `last_assistant_message` · `background_tasks`(배열) 가 온다. `-p` 에서도 돈다. `-p` 기록의 첫 줄에는 `origin` 이 없다 |
| 소요 | 기록 30MB 를 읽고 나누는 데 0.14초 — 나머지는 node 기동(0.8~1초) |

- 판정 2: 스킬 호출을 보는 관문 훅을 **채택**한다(설치 때 `--with gate-hook`). 되돌리는 시점이 보고 뒤라 「빠진 단계만 채운다」고 시킨다. 울림이 잦다는 것(재생 11/14)은 알고 고른다 — 효과는 실제 설치에서 다시 잰다
- 한계: 코드 변경 턴 7개 · 대조군 없음. 소요 시간에는 권한 대기가 섞였을 수 있다. 합성 시험은 sonnet, 실제 세션은 opus 다

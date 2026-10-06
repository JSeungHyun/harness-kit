# harness-kit

> 상태: ⛔ **설계안** — 실제 프로젝트에 적용해 값을 낸 것은 아직 없다. 합성 대상 실측은 [§실측](#실측)

어느 프로젝트에나 얹는 Claude Code 하네스 템플릿. **흐름은 superpowers, 과설계 점검은 ponytail** 이 맡고,
둘이 못 하는 것을 두 모듈이 맡는다. 대상이 **신규 구축인지 기존 이식인지 판별해** 그에 맞게 얹는다.

## 설치

대상 프로젝트에서 Claude Code 에게:

```
<이 레포 경로>/SETUP.md 를 읽고 이 프로젝트에 적용해줘
```

Node 22+ · Claude Code 2.1.277+ · git 저장소. 의존성 0.

## 두 모듈

| 모듈 | 막는 실패 | 도구 (`.harness/tools/`) |
|---|---|---|
| **evidence** | 완료를 거짓 보고한다 · 묻지 않고 넘어간 가정이 묵는다 · 같은 실패를 반복한다 | `verify` · `decision-check` · `lesson-append` · `lesson-promote` · `state-check` · `policy-apply` |
| **graph** | 같은 것을 두 번 조사한다 · 사용자의 말과 코드의 이름 사이 다리가 없다 | `graph-find` · `graph-append` · `graph-alias` · `graph-hook` · `graph-view` · `graph-measure` |
| 설치 | — | `detect` · `install-mode` · `scan-shared` |

자동 로드되는 층은 `.claude/rules/harness.md` · `.claude/rules/graph.md` 둘뿐이다. 관문은 `final-gate` 스킬 — **작업을 끝냈다고 보고하기 직전에 매번** 돈다(계획 유무와 무관).

## 신규 구축 / 기존 이식 · 설치 모드

| | 신규 (커밋 < 20 · 소스 < 50) | 기존 |
|---|---|---|
| 지시 파일 | 없으면 지도 골격을 만든다 — 공유면 `AGENTS.md` + `CLAUDE.md`(`@AGENTS.md`), 로컬이면 `CLAUDE.local.md` | ⛔ 내용을 고치지 않는다 — 필요하면 import 한 줄 |
| 소급 | 없음 — 스펙 용어를 「설계 용어」로 시드 | 이슈 > 인수인계 문서 > 담당자 > 커밋 이력 순으로 lessons 2~3 · 그래프 3~5 |
| 테스트 | 첫 테스트 전 verify 실패(테스트 0개)가 정상 | 원래 있던 실패는 사용자 확인 뒤 기준선 (`verify --baseline`) |

설치 모드는 **둘 다 로컬 전용이 기본**이다(`.git/info/exclude` · `settings.local.json`). **팀 공유는 사용자가 명시적으로 고른다** — 기록에는 사번 · 실명 · 이슈 번호 · 내부 URL 이 쌓이기 때문이다. 공유를 고르면 `.gitignore` 부정 규칙으로 이 PC 의 전역 무시(`.claude/` · `AGENTS.md` · `CLAUDE.md`)를 이기고, `pre-commit` 이 커밋 전마다 `scan-shared` 로 민감 정보 패턴(`.harness/scan.json`)을 검사한다.

## 정직한 값 — 이미 되는 것은 넣지 않는다

| 차원 | 이미 되나 | 여기서 |
|---|---|---|
| 계획 · TDD · 검증 규율 | ✅ superpowers | 안 만든다 |
| 과설계 리뷰 | ✅ ponytail | 관문에서 부른다 |
| 파일 목록 · 동반변경 · 언제 바뀌었나 | ✅ git | 그래프의 값이 아니다 |
| **완료의 결정론적 증거** | ❌ 종료코드·러너 요약은 테스트 0개를 통과시킨다 | ⭐ `verify` — 이번 실행이 쓴 XML 의 testcase 를 센다 |
| **원래 있던 실패와 새 실패의 구분** | ❌ 러너는 늘 exit 1 | ⭐ 기준선 — 기준선 밖 실패만 실패 |
| **묻지 않은 가정 · 반복 실패의 적립** | ❌ | ⭐ `decision-check` · `lesson-append` · `lesson-promote` |
| **현업 용어 → 코드 식별자 · 함정 한 줄** | ❌ 어디에도 없다 | ⭐ 그래프 `terms` · `note` |

## ⛔ 도입하지 말아야 할 때

| 모듈 | 이럴 땐 빼거나 하지 않는다 |
|---|---|
| 전체 | superpowers 를 쓰지 않기로 한 팀 · 수명이 몇 주인 프로젝트 |
| evidence | 결정론적 검사를 하나도 만들 수 없다 — 단, 운영 저장소도 `output-match` · `exit-code` 로 시작할 수 있다 |
| graph | 현업 용어 = 코드 식별자(영어 프로젝트 다수) · 혼자 한 도메인만 · 작업 끝 기록 규율을 지킬 수 없다(낡은 그래프는 없느니만 못하다) |

## 실측

합성 대상(임시 git 저장소)에서 잰다. 실제 프로젝트에 적용해 값을 낸 것은 아직 없다 — 그래서 딱지는 전부 `설계안` 이다.

| 층 | 재현 | 무엇을 |
|---|---|---|
| 결정론 | `node proof/run.mjs` | 하네스 없이 vs 있을 때 — LLM 없음 |
| 새 세션 | `node proof/run.mjs --claude` | 규칙 로드 · ponytail 끄기 · 플러그인 (haiku) |
| SETUP 종단 | `node proof/setup-e2e.mjs` | 새 sonnet 세션이 SETUP 을 처음부터 끝까지 따르는가 → `proof/check-install.mjs` 가 파일 · git · 도구 출력으로 판정 |

### 결정론 — `node proof/run.mjs`

| | |
|---|---|
| 일시 | 2026-10-03 02:27 UTC |
| 환경 | win32 · Node v24.18.0 |
| 예상과 다른 행 | 0개 / 29행 |

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
| P9 설치 모드 | 공유(명시적 선택) · 모의 전역 무시가 .claude/ · AGENTS.md · CLAUDE.md 를 숨긴다 | 하네스 없이 git 에 보이는 지시·규칙 파일 0개 → install-mode share exit 0 · 5개 | ✅ |
| P9 설치 모드 | 공유 · 사번 형식이 든 기록을 커밋 → 걷어내고 다시 커밋 | pre-commit 막음 ([사번 형식] AB******) → 통과 | ✅ |
| P10 판별 | 커밋 1 · 소스 2 | new/local | ✅ |
| P10 판별 | 커밋 25 · 소스 3 | existing/local | ✅ |
| P10 판별 | 커밋 1 · 소스 60 | existing/local | ✅ |
| P4 설정 병합 | 공유 — 기존 settings(권한 1 · 훅) 위에 정책 반영 | 정책 반영 · 기존 권한 · 훅 보존 | ✅ |
| P4 설정 병합 | 로컬 — --local --with graph-hook 두 번 (중복 처리 false 가 있음) | settings.json 그대로 · 훅 1개 · 끈 플러그인 꺼진 채 · 재실행 같음 | ✅ |

### 새 세션 — `node proof/run.mjs --claude`

| | |
|---|---|
| 일시 | 2026-10-02 12:14 UTC |
| 환경 | win32 · Node v24.18.0 · Claude Code 2.1.287 |
| 예상과 다른 행 | 0개 / 41행 (위 29행 + 아래 12행) |
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

### SETUP 종단 — `node proof/setup-e2e.mjs` (run4 · 2026-10-02 10:54 UTC)

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

**실측 뒤에 바뀐 파일 — `setup-e2e` 는 다시 돌리지 않았다.** run4 이후 아래가 바뀌었다. 결정론 · 새 세션 실측(위 두 표)과 `npm test` 는 바뀐 뒤에 다시 돌린 값이고, SETUP 종단 실측은 바뀌기 전 값이다.

| 파일 | 무엇이 |
|---|---|
| `SETUP.md` | ③ 공유 모드 패턴 맞추기(`reviewed`) · `core.hooksPath` 가 git 디렉터리 밖이면 pre-commit 을 쓰지 않음 · ⑤ Windows 의 저장소 안 래퍼는 `.\gradlew` · `.\mvnw`(첫 실전 적용) · ⑥ 플러그인 설치 범위를 모드에 맞춤 · ⑦ 훅 조건 「상위3 점유 < 50%」 · ⑧-b 질문 |
| `tools/install-mode.mjs` | ⛔ 보안 — 훅 자리가 저장소 git 디렉터리 밖(전역 `core.hooksPath` · 추적되는 `.husky`)이면 쓰지 않고 한 줄을 안내 |
| `.gitignore` (이 레포) | `!templates/map/AGENTS.md` · `!templates/map/CLAUDE.md` — 전역 gitignore 가 그 이름을 무시하는 PC 에서 템플릿이 커밋에서 빠지던 것 |
| `templates/rules/graph.md` | §1 새 원천 예외 · §4 제목(빈도순 · 피해는 ④) · ④ 새 원천도 단일 증거 · §8 훅 조건 |
| `templates/rules/harness.md` | 플러그인 설치 범위 `--scope local`(공유는 `project`) |
| `templates/skills/final-gate/SKILL.md` | 기록 단계에 「기록의 두 장치」 — 남길 게 없으면 한 줄로 · 낡은 기록은 그 자리에서 고친다 |
| `templates/scan.json` | 기본 7종(하이픈 복합 번호 추가 · DB 접속 CLI 인자 · `<낱말> #번호` · 이름 뒤 버전 토큰) · 패턴마다 `놓치는 것` · `reviewed: false` |
| `policy/graph-hook.json` | `_note` 의 훅 조건 |
| `tools/scan-shared.mjs` | `reviewed: false` 인 동안 「기본 패턴 그대로다」 경고 (exit 는 그대로) |
| `tools/graph-measure.mjs` | 패턴마다 `상위3 점유 n%` |
| `tools/graph-find.mjs` · `tools/graph-hook.mjs` | 실측 근거 주석 다섯 줄 (동작 변화 없음 — 주석을 걷은 코드가 같다) |
| `proof/run.mjs` · `proof/setup-e2e.mjs` | 규칙 로드 질문 · 정리 범위(project + local) · 주석의 경로 예시 · 결정론 실측이 자기 임시 대상을 지움 |
| `test/scene.mjs` · `test/*.test.mjs` | 공용 `tmp()` — 그 테스트 파일이 끝나면 임시 폴더를 지운다 · 위 변경의 테스트 |
| `package.json` | `--test-concurrency=4` — 기본 병렬에서 `spawn EPERM` 불안정 |
| `docs/plan.md` · `README.md` | 기록 |

## 출처

두 레포를 읽어 새로 만들었다 — ⛔ 원본은 그대로 둔다. 옮긴 것은 도구·템플릿·규칙이고, 프로젝트의 기록(그래프 데이터)은 그 프로젝트에 남는다.

| 출처 | 가져온 것 |
|---|---|
| `agent-harness` | evidence 모듈 — 완료 증거 · 가정 · 교훈 · 설정 병합 + 기준선 · `output-match` · `--local` · `--with` |
| `context-graph` | graph 모듈 — 채점 · 토크나이저 · 문턱 · 출력을 그대로, 저장 경로만 `.harness/graph/` 로. DB 가드 · SQL 템플릿 검사 · 커밋 색인 · 절 목차는 범용 값이 없어 뺐다 |

## 개발

```bash
npm test                    # 결과 XML 은 test-results/
node proof/run.mjs          # 결정론 실측 (LLM 없음)
node proof/run.mjs --claude # + 새 세션 실측 (토큰을 쓴다)
```

설계: `docs/design.md` · 계획: `docs/plan.md`

# SETUP — 프로젝트에 harness-kit 을 얹는다

> 상태: **설계안**

⛔ **이 문서는 사람이 아니라 Claude Code 에게 주는 지시서다.** 대상 프로젝트에서
`<이 레포 경로>/SETUP.md 를 읽고 이 프로젝트에 적용해줘` 로 시작한다.
아래에서 `<kit>` 은 이 문서가 있는 디렉터리, `<대상>` 은 적용할 프로젝트 루트다. 대상 안의 명령은 `<대상>` 에서 돌린다.

얹는 것은 두 모듈이다 — **evidence**(완료를 증거로 · 묻지 않은 가정 · 반복 실패)와 **graph**(요구 → 용어·파일·함정).
⛔ **대상의 기존 파일을 옮기거나 덮어쓰지 않는다.** 규칙은 새 파일, 설정은 병합, 지시 파일에는 import 한 줄만.

## ⛔ 절차 — 순서를 지킨다

### ① 안전 확인과 판별

```bash
node <kit>/tools/detect.mjs <대상>     # 사실 + 제안 (프로필 · 모드 · 멈춤 사유). --json 도 된다
claude --version                       # 2.1.277 이상
```

| `detect` 가 낸 것 | 행동 |
|---|---|
| `⛔ 멈춤` 줄이 있다 (저장소 아님 · 루트 아님 · 미커밋 변경 · 이미 설치됨 · Node 22 미만) | ⛔ 멈추고 알린다. 이미 설치됐으면 재설치인지 묻는다 — 덮어쓰지 않는다 |
| `context-graph 있음` | 그 프로젝트의 그래프가 이미 있다 — ⛔ 데이터를 옮기지 않고 **graph 모듈을 설치하지 않는다**(②의 graph.md · ⑦의 그래프 단계 생략). 보고에 적는다 |

**프로필과 모드를 사용자에게 한 번에 확인받는다** — `detect` 의 제안값과 그 이유(커밋 수 · 소스 수)를 보여준다.

| | 신규 구축 (`new`) | 기존 이식 (`existing`) |
|---|---|---|
| 제안 조건 | 커밋 < 20 이고 추적 소스 < 50 | 그 밖 |
| 제안 모드 | **로컬 전용** (`local`) — 이 PC 에만, 커밋되지 않는다 | **로컬 전용** |

**팀 공유(`share`)는 사용자가 명시적으로 고를 때만** — 고르기 전에 위험을 보여준다: 기록 · 장부에는 사번 · 실명 · 이슈 번호 · 내부 URL · 데이터 분포 수치가 쌓이고, 공유 모드에서는 그것이 그대로 커밋된다. 공유를 고르면 커밋 전마다 `scan-shared` 가 민감 정보 패턴을 검사한다(③).

⭐ 비대화형 실행(사용자가 답할 수 없다)이면 **제안값(로컬 전용)으로 진행**하고, 보고의 「사용자가 결정해야 하는 것」에 남긴다 — SETUP 을 시킨 지시가 모드를 정했으면 그것을 따른다.
아래에서 `<장부>` 는 공유면 `docs/harness`, 로컬이면 `.harness/state` 다.

### ② 도구와 템플릿을 복사한다

```bash
mkdir -p <대상>/.harness/graph <대상>/.claude/rules <대상>/.claude/skills <대상>/<장부>
cp -r <kit>/lib <kit>/tools <kit>/policy <대상>/.harness/
cp <kit>/templates/harness.json <대상>/.harness/harness.json
cp <kit>/templates/rules/harness.md <대상>/.claude/rules/harness.md
cp <kit>/templates/rules/graph.md <대상>/.claude/rules/graph.md          # 기존 context-graph 가 있으면 생략
cp -r <kit>/templates/skills/final-gate <대상>/.claude/skills/
cp <kit>/templates/state/decisions.md <대상>/<장부>/decisions.md
cp <kit>/templates/state/lessons.md <대상>/<장부>/lessons.md
cp <kit>/templates/scan.json <대상>/.harness/scan.json                   # 공유 모드만 — 민감 정보 패턴 (③에서 프로젝트에 맞춘다)
```

대상에 이미 가정 장부 · 교훈 파일이 있으면 템플릿을 복사하지 않고 ⑤에서 그 경로를 적는다(⛔ 옮기지 않는다).
파일 단위 분석 진행을 추적하는 일(레거시 이해 · 레퍼런스 대조)이면 `<kit>/templates/state/current.md` 도 복사하고 `state.current` 에 적는다.

### ③ 설치 모드 — git 이 무엇을 보게 할지

```bash
cd <대상>
node .harness/tools/install-mode.mjs local      # 또는 share — ⛔ exit 0 이어야 한다
```

| | 로컬 전용 | 공유 |
|---|---|---|
| 하는 일 | 설치 경로를 `.git/info/exclude` 에 | 지금 git 에 무시되는 설치 경로만 `.gitignore` 에 부정 규칙(`!.claude/` 등) + `.claude/settings.local.json` 은 다시 무시 + `.git/hooks/pre-commit` 에 `node .harness/tools/scan-shared.mjs` |
| 끝에 확인 | 전부 무시됨 | 설치 경로가 전부 추적 가능 · pre-commit 이 scan-shared 를 부른다 |

공유 모드에서 이미 pre-commit 훅이 있으면 덮지 않는다 — 출력의 ⚠️ 줄(그 훅에 더할 한 줄)을 사용자에게 보여준다. `core.hooksPath` 가 설정돼 있어 훅 자리가 저장소 git 디렉터리 밖(전역 훅 폴더 · 추적되는 `.husky` 등)이면 **쓰지 않고** 같은 한 줄을 안내한다 — 전역 훅 폴더에 쓰면 `.harness/` 가 없는 다른 모든 레포의 커밋이 실패한다.

**공유 모드 — 민감 정보 패턴을 프로젝트에 맞춘다.** `.harness/scan.json` 의 기본 7종은 예시라 프로젝트 형식을 모른다(실측: 기본 6종 중 4종이 실제 값을 못 잡았다 — 각 패턴의 `놓치는 것` 참고). 사용자에게 **사번 형식 · 사내 호스트 목록 · 이슈 번호 형식** 셋을 묻고, 패턴을 고치거나 더한 뒤 `"reviewed": true` 로 바꾼다. 맞추기 전에는 scan-shared 가 「⚠️ 기본 패턴 그대로다」를 낸다(커밋은 막지 않는다). ⛔ 비대화형이면 `false` 로 두고 「사용자가 결정해야 하는 것」에 남긴다 — 실제 값으로 패턴을 지어내지 않는다.

exit 1 이면 출력의 ⛔ 경로를 `git check-ignore -v <경로>` 로 보고 사용자에게 알린다 — 어느 규칙이 막는지가 답이다.
⚠️ 이 PC 의 전역 gitignore 가 `.claude/` · `AGENTS.md` · `CLAUDE.md` 를 무시할 수 있다. 공유 모드는 저장소 `.gitignore` 가 그것을 이긴다.

### ④ 지시 파일 — import 한 줄만

⛔ 기존 지시 파일의 내용을 고치거나 옮기지 않는다. 더하는 것은 `@AGENTS.md` 한 줄뿐이고, 기존 파일에 더할 때는 사용자 승인을 받는다.

| 대상에 있는 것 (`detect` 의 지시 파일 줄) | 공유 | 로컬 전용 |
|---|---|---|
| 없음 | `cp <kit>/templates/map/AGENTS.md <대상>/AGENTS.md` + `cp <kit>/templates/map/CLAUDE.md <대상>/CLAUDE.md` | `cp <kit>/templates/map/CLAUDE.local.md <대상>/CLAUDE.local.md` |
| `CLAUDE.md` (또는 둘 다, import 있음) | 그대로 | 그대로 |
| `AGENTS.md` 만 | `cp <kit>/templates/map/CLAUDE.md <대상>/CLAUDE.md` | `<대상>/CLAUDE.local.md` 를 `@AGENTS.md` 한 줄로 만든다 (이미 있으면 맨 위에 그 한 줄) |
| 둘 다, `CLAUDE.md` 가 import 안 함 | `AGENTS.md` 가 안 읽히고 있다고 보고하고 import 한 줄을 제안 | 같음 |

- `AGENTS.md` 만 있어도 Claude Code 가 읽지만 **8.3 단축 경로(`C:\Users\ABCDEF~1\…`)로 연 세션은 읽지 않는다**(실측) — 그래서 다리를 놓는다
- 하네스 규칙은 `.claude/rules/` 에 있어 지시 파일과 무관하게 로드된다. ⛔ 규칙을 지시 파일에 복사하지 않는다

새로 만든 지도 골격(`AGENTS.md` 또는 `CLAUDE.local.md`)의 `<…>` 는 대상을 읽고 채운다 — 목적(README) · 빌드·테스트 명령 · 구조. 모르는 칸은 `<…>` 로 남기지 말고 지운다.

### ⑤ `.harness/harness.json`

`profile` · `mode` 를 ①에서 정한 값으로, `state.decisions` · `state.lessons` 를 `<장부>/…` (또는 대상이 이미 쓰는 장부 경로)로 적는다.
`checks` 에는 **실제로 도는 명령**만, 그리고 결과 XML 을 **매번 새로 쓰는** 명령만 적는다 — verify 는 이번 실행이 쓰지 않은 XML 을 증거로 쓰지 않는다.

| 스택 | `cmd` | `kind` · `evidence` |
|---|---|---|
| Node (`node:test`) | `package.json` 의 `test` 가 junit 을 디렉터리에 쓰고 그 디렉터리를 먼저 만들면 `npm test`. 아니면 `node -e "require('fs').mkdirSync('test-results',{recursive:true})" && node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=test-results/junit.xml "test/*.test.mjs"` | `junit-xml` · `test-results` |
| Gradle | `./gradlew cleanTest test` (Windows `cmd`: `gradlew cleanTest test`) | `junit-xml` · `build/test-results/test` |
| Maven | `mvn test` | `junit-xml` · `target/surefire-reports` |
| pytest | `pytest --junitxml=test-results/junit.xml` | `junit-xml` · `test-results` |
| 결과 XML 을 낼 수 없다 | 테스트 명령 | `exit-code` — ⚠️ 테스트 0개를 못 잡는다고 사용자에게 알린다 |
| 생성물이 계약 (OpenAPI 스냅샷 등) | 생성 명령 | `file-unchanged` · 산출물 경로 |
| 검증 쿼리 · 운영 저장소 | 결과를 stdout 에 내는 명령 | `output-match` · `"expect": "<정규식>"` (예: `"^rows=0$"`) |
| 그래프 무결성 (graph 모듈을 얹으면) | `node .harness/tools/graph-find.mjs --check` | `exit-code` |

- Node 는 junit 결과 디렉터리를 만들지 않는다 — 없으면 ENOENT 로 죽는다(실측). `node --test` 에는 디렉터리가 아니라 glob 을 준다
- 명령은 플랫폼 기본 셸(`sh` / Windows `cmd`)로 돈다. 팀이 OS 를 섞어 쓰면 양쪽에서 같은 명령(`npm test` 등)을 고른다
- 지시 파일 · README 에 빌드·테스트 명령이 적혀 있으면 그것을 쓴다

### ⑥ 설정 · 플러그인 · 규칙 자리

```bash
node .harness/tools/policy-apply.mjs              # 공유 → .claude/settings.json
node .harness/tools/policy-apply.mjs --local      # 로컬 전용 → .claude/settings.local.json
claude plugin list --json                         # 이 PC 의 플러그인 설치 기록 — {id, scope, enabled} 배열
```

권한 · `env.PONYTAIL_DEFAULT_MODE=off` · 플러그인 선언이 기존 설정 위에 병합된다(다시 돌려도 같다).

⚠️ `policy-apply` 는 **Claude 자신의 권한 설정을 바꾸는 명령**이다 — 권한 확인이 뜨거나, auto 모드 분류기가 `Self-Modification` 으로 막을 수 있다(실측: 같은 명령이 한 세션에서는 돌고 다른 세션에서는 막혔다). ⛔ 막히면 다른 도구로 같은 파일을 직접 써서 우회하지 않는다 — 사용자에게 `! node .harness/tools/policy-apply.mjs --local`(공유면 `--local` 없이)로 직접 돌리게 하고, 그 뒤 아래 플러그인 중복 처리와 ⑧-c · ⑧-d 를 잇는다. 비대화형이면 보고의 「사용자가 결정해야 하는 것」 **맨 앞**에 남긴다 — 정책 없이는 ponytail 이 켜진 채다.

superpowers 와 ponytail 각각에 대해:

| `list` 결과 | 행동 |
|---|---|
| 정책의 id (`superpowers@claude-plugins-official` · `ponytail@ponytail`) 가 `enabled` | 아무것도 하지 않는다 |
| 같은 이름이 **다른 마켓 id** 로 `enabled` (예: `superpowers@superpowers-marketplace`) | 설치하지 않는다. `.claude/settings.local.json` 의 `enabledPlugins` 에 정책 id 를 `false` 로 넣는다 — local 이 project 보다 우선하고, `policy-apply` 를 다시 돌려도 `false` 는 남는다 |
| 없다 | 로컬 전용: `claude plugin install <정책 id> --scope local` — ponytail 은 먼저 `claude plugin marketplace add DietrichGebert/ponytail --scope local`. 공유: 같은 두 명령을 `--scope project` 로 — 로컬 전용에서 `project` 를 쓰면 커밋될 `.claude/settings.json` 이 생긴다 |

규칙 파일의 자리를 실제 장부 경로로 바꾼다:

```bash
grep -n '<decisions>\|<lessons>' .claude/rules/harness.md     # 바꾼 뒤 ⛔ 아무것도 나오지 않아야 한다
```

### ⑦ 프로필별 — 이미 있는 것을 쓰거나, 처음부터 쌓거나

#### 기존 이식 (`existing`)

| 이미 있는 것 | 옮길 자리 |
|---|---|
| 지시 파일 · README 의 빌드·테스트 명령 | ⑤ `checks` |
| 용어 사전 · 인수인계 문서 | 그래프 `graph-append` — **「이 용어들이 같은 질문에서 함께 필요한가」**로 묶는다. 함께면 주제 기록 1건, 갈리면 2~3건. `note` 에 출처 문서 경로. ⛔ 사전 전체를 한 건에 몰아넣지 않는다(광역 기록이 적중을 독점한다) · ⛔ 용어 1개짜리로 잘게 쪼개지도 않는다(`req` 가 빈약해 정확일치를 못 받는다) |
| 지시 파일의 금지 · 주의 규칙 | ⛔ 옮기지 않는다 — 이미 매 세션 로드되는 행동 규칙이다. 과거 실패와 이어지면 lessons 의 `guard` 에 그 절을 적는다 |
| 기존 가정 장부 · TODO | 그 경로를 ⑤ `state` 에 |
| 실패 중인 테스트 | 아래 「기준선」 |

**소급 — 빈 장부는 값이 0이다.** 원천의 값 순서: 이슈·티켓 전수 > 인수인계·가이드 문서 > 담당자 확인(설치 뒤에도 대화 중에) > DB 코멘트(⛔ 복사하지 않고 조회 **명령**만 지도에) > 커밋 이력.

```bash
git log --format='%h %ad %s%n%b' --date=short -60      # 본문까지 본다 — 근본 원인은 대개 본문에 있다
```

- 수정 커밋(`fix` · 버그 · 원인) 중 **근본 원인이 드러난 것**만 lessons 2~3건 — `node .harness/tools/lesson-append.mjs`. 이미 테스트·규칙으로 막혀 있으면 `guard` 에 그 위치를 적는다
- 요구 단위 커밋 3~5건 → 그래프 `node .harness/tools/graph-append.mjs` — `req` 는 그때의 요구, `date` 는 **그 커밋 날짜**(소급), `files` 는 그 커밋의 변경 파일 중 **지금도 있는 것**(`git show --name-only --format= <해시>` — 사라진 경로는 `--check` 를 깨뜨린다). ⛔ **`terms`(현업 용어 → 코드 식별자)를 채워야 값이 있다** — 커밋 제목만 넣은 기록은 0 이다. 커밋 유래 기록은 기여가 낮으니 건수를 채우려고 늘리지 않는다
- ⛔ 소급 기록에 `supersedes` 를 붙이지 않는다. ⛔ 개인 식별자(사번·이름·연락처)를 적지 않는다 — 사람은 역할로
- 그래프는 `.claude/rules/graph.md` 의 기록 규칙을 따른다

**기준선 — 원래 있던 실패**

```bash
node .harness/tools/verify.mjs; echo "exit=$?"
```

exit 1 이고 이유가 테스트 실패뿐이면, 실패한 testcase 를 사용자에게 보여주고 **「원래 있던 실패인가」를 확인받는다.** 예일 때만:

```bash
node .harness/tools/verify.mjs --baseline     # 지금의 실패를 .harness/baseline/<검사 id>.txt 에 쓴다
node .harness/tools/verify.mjs                # ⛔ exit 0 — 「기준선 실패 N」이 보여야 한다
```

⛔ 확인 없이 `--baseline` 을 돌리지 않는다 — 기준선에 들어간 실패는 더 울리지 않는다. 비대화형이면 SETUP 을 시킨 지시가 정한 대로 하고 보고에 남긴다.

**그래프 훅** — 켜는 조건은 **살아있는 기록 20건 이상 + `node .harness/tools/graph-find.mjs --check` exit 0 + 상위3 점유 < 50%** 다. 아니면 켜지 않고 보고에 「n건 · 점유 n% — 조건이 차면 켠다」를 남긴다.
점유는 확신 질의 중 가장 자주 1위를 한 기록 3개가 1위인 비율이다 — 건수는 대리 지표다. 소급 측정: 20건 42% · 50건에서 재상승 — 켠 뒤에도 잰다. 질의 집합(이슈 제목 export — `[{title}]` · `[{subj}]` · `{tasks:[{subj}]}`)이 없으면 앞의 둘만 보고, 보고에 「독점 미측정」을 쓴다. 점유가 높으면 1위를 독점하는 광역 기록을 주제별로 나눈다.

```bash
node .harness/tools/graph-measure.mjs . --tickets <이슈 제목 json>   # 「상위3 점유 n%」
node .harness/tools/policy-apply.mjs --local --with graph-hook    # 로컬 전용
node .harness/tools/policy-apply.mjs --with graph-hook            # 공유
```

#### 신규 구축 (`new`)

- 소급할 과거가 없다 — lessons 는 비워 둔다
- ④에서 만든 지도 골격을 채운다
- 브레인스토밍 스펙 · 설계 문서가 있으면 현업 용어 → **계획한 식별자**를 그래프에 시드한다 — 용어마다 `node .harness/tools/graph-alias.mjs <용어> "<계획한 식별자>" --note "설계 용어 — 구현 후 재확인"`. 구현에서 이름이 바뀌면 `supersedes` 로 맞춘다
- ⭐ **첫 테스트 전에는 verify 가 「실행된 테스트가 0개」로 실패하는 것이 정상이다** — 보고에 그렇게 적는다. ⛔ 통과시키려고 검사를 빼거나 `exit-code` 로 바꾸지 않는다
- 훅은 켜지 않는다 — 조건이 차면 위 「그래프 훅」대로

### ⑧ 검증 — ⛔ 자기 보고도 도구 출력도 믿지 않는다

**⑧-a. 도구가 도는가**

```bash
node .harness/tools/verify.mjs; echo "exit=$?"    # 기존: exit 0 · 신규: 첫 테스트 전이면 「실행된 테스트가 0개」
node .harness/tools/decision-check.mjs
node .harness/tools/lesson-promote.mjs
node .harness/tools/state-check.mjs
node .harness/tools/graph-find.mjs --check; echo "exit=$?"     # ⛔ exit 0 (graph 모듈을 얹었으면)
node .harness/tools/install-mode.mjs <local|share>             # 다시 돌려도 같다 — 모드대로인지 다시 확인
node .harness/tools/scan-shared.mjs; echo "exit=$?"            # 공유 모드만 — ⛔ exit 0 (소급 기록에 민감 정보가 없는가)
git status --porcelain                                          # 의도한 파일만 보이는가 (로컬 전용이면 거의 비어야 한다)
```

**⑧-b. 규칙이 새 세션에 로드되는가** — 도구를 끈 새 세션으로 양성 2 · 음성 1

```bash
claude -p --model haiku --tools "" --no-session-persistence "도구를 쓰지 마라. 이 저장소에서 코드를 바꾼 작업의 완료를 주장하기 전에 반드시 돌려야 하는 명령은 정확히 무엇인가? 주어진 지시에 없으면 정확히 '모름'이라고만 답하라." < /dev/null
claude -p --model haiku --tools "" --no-session-persistence "도구를 쓰지 마라. 이 저장소에서 과거 요구와 현업 용어를 찾을 때 먼저 돌리는 명령은 정확히 무엇인가? 주어진 지시에 없으면 정확히 '모름'이라고만 답하라." < /dev/null
claude -p --model haiku --tools "" --no-session-persistence "도구를 쓰지 마라. 이 저장소의 배포 승인권자는 누구인가? 주어진 지시에 없으면 정확히 '모름'이라고만 답하라." < /dev/null
```

양성은 `verify.mjs` 와 `graph-find.mjs` 를, 음성은 「모름」을 답해야 한다. 양성이 「모름」이면 `.claude/rules/` 의 위치를 본다.

**⑧-c. ponytail 이 꺼졌는가** — 훅 출력은 stream-json 에 그대로 나온다

```bash
claude -p --model haiku --tools "" --no-session-persistence --output-format stream-json --verbose "ok" < /dev/null | grep -c "PONYTAIL MODE ACTIVE"    # ⛔ 0
```

**⑧-d. 플러그인이 하나씩인가** — `claude plugin list --json` 에서 이름이 superpowers · ponytail 인 `enabled` 항목의 **id** 가 각각 하나다.
같은 id 가 여러 줄인 것은 정상이다 — 목록은 이 PC 의 모든 프로젝트 설치 기록을 보여준다.

**⑧-e.** `git diff` 와 새로 생긴 파일 목록을 사용자에게 보여준다. 기존 설정·지시 파일 보존은 사용자만 판정한다.

### ⑨ 보고 — 3단

```markdown
## ✅ 얹은 것
- 프로필 <new|existing> · 모드 <share|local> — <제안값 그대로인가, 사용자가 바꿨나>
- <경로>: <무엇을>
- 소급: lessons <n>건 · 그래프 <n>건 (원천: <무엇>) · 기준선 <n>건
- 검증: <⑧ 의 출력 그대로 — 「통과했다」로 줄이지 않는다>

## ⛔ 사용자가 결정해야 하는 것
1. <무엇> — <왜 내가 못 정하는가> (비대화형으로 제안값을 쓴 것은 전부 여기에)

## ⚠️ 이 프로젝트에 새로 생기는 제약
- 작업을 끝냈다고 보고하기 직전에 final-gate — 완료 증거 · 작업 파일 목록 · 기록이 한 세트
- 코드 변경의 완료 증거는 node .harness/tools/verify.mjs
- 요구가 오면 그래프 먼저 (node .harness/tools/graph-find.mjs), 끝나면 기록
- 프로젝트 설정의 자동 승인(allow)은 이 폴더를 신뢰해야 적용된다 — 대화형으로 한 번 열어 신뢰 대화상자를 수락한다 (실측: 신뢰 전에는 「Ignoring … permissions.allow entries」)
```

## ⛔ 하지 않는 것

| ⛔ | 왜 |
|---|---|
| 대상의 기존 파일을 옮기거나 덮어쓰기 · 지시 파일에 절 추가 | 기존 참조가 깨지고, 두 파일이 갈라진다. 규칙은 `.claude/rules/` 에 |
| 기존 context-graph 의 데이터를 옮기기 | 그 프로젝트의 그래프다 — 전환은 범위 밖 |
| 확인 없이 `verify --baseline` | 진짜 실패가 조용해진다 |
| 그래프 20건 전에 훅 | 몇 건이 모든 질의에 걸려 지연만 남는다 |
| 훅·스크립트로 기록을 자동 추출 | 검증 관문이 없다 — 낡은 정보를 더 빨리 쌓는다 |
| 개인 식별자를 그래프·장부에 | 공유 모드에서는 그대로 커밋된다 |
| 묻지 않고 공유 모드 · scan-shared 를 끄거나 `--no-verify` 로 건너뛰기 | 기록에 쌓인 사번·실명·이슈 번호가 저장소 밖으로 나간다 |
| 검사를 pre-push 에 전부 걸기 | 진행도 게이트를 correctness 게이트로 쓰면 급한 수정이 막힌다 |
| ponytail 모드를 켜 두기 | superpowers 의 설계·질문 단계와 충돌한다. final-gate 에서 `/ponytail-review` 로만 |
| 커밋 | 사용자가 diff 를 보고 결정한다 |

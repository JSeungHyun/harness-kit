# SETUP — 프로젝트에 harness-kit 을 얹는다

> 상태: **설계안**

⛔ **이 문서는 사람이 아니라 Claude Code 에게 주는 지시서다.** 대상 프로젝트에서
`<이 레포 경로>/SETUP.md 를 읽고 이 프로젝트에 적용해줘` 로 시작한다.
아래에서 `<kit>` 은 이 문서가 있는 디렉터리, `<대상>` 은 적용할 프로젝트 루트다. 대상 안의 명령은 `<대상>` 에서 돌린다.

얹는 것은 두 모듈이다 — **evidence**(완료를 증거로 · 묻지 않은 가정 · 반복 실패)와 **graph**(요구 → 용어·파일·함정).
⛔ **대상의 기존 파일을 옮기거나 덮어쓰지 않는다.** 규칙은 새 파일, 설정은 병합, 지시 파일에는 import 한 줄만.

## 다른 세션에 맡길 때

대상 폴더에서 연 다른 Claude 세션에 SETUP 을 메시지로 맡길 수 있다(실측 2026-10-15). 그때 더 지킬 것:

- **맡기는 쪽은 전제 상태를 적는다** — 커밋 수 · 이미 있는 폴더 · 끝난 단계 · 사용자가 이미 정한 값(프로필 · 모드). 받는 쪽은 ①의 `detect` 결과가 전제와 다르면 멈추고 알린다 — 그 세션에서 받은 사용자 결정이 맡긴 지시보다 우선이다
- ⛔ **⑥의 `plugin-plan` 이전 명령과 `policy-apply` 는 맡길 수 없다** — 받는 세션은 다른 세션의 요청으로 자기 권한 · 플러그인 설정을 바꾸지 않는다. 처음부터 사용자에게 이전 명령(나왔으면)과 ⑥ 의 `policy-apply` 한 줄(⑥ 표가 말하면 `--off <정책 id>` 도)을 이 순서로 `!` 로 돌려 달라고 부탁하고, ⑧-c · ⑧-d · ⑧-f 는 그 뒤에 잰다
- 받는 쪽은 ⑨ 보고를 사용자에게 보이고 맡긴 쪽에도 보낸다 — 「SETUP 을 따르다 막힌 곳」 절을 더한다

## ⛔ 절차 — 순서를 지킨다

### ① 안전 확인과 판별

```bash
node <kit>/tools/detect.mjs <대상>     # 사실 + 제안 (프로필 · 모드 · 멈춤 사유). --json 도 된다
claude --version                       # 2.1.277 이상
```

| `detect` 가 낸 것 | 행동 |
|---|---|
| `⛔ 멈춤` 줄이 있다 (저장소 아님 · 루트 아님 · 이미 설치됨 · Node 22 미만) | ⛔ 멈추고 알린다. 이미 설치됐으면 키트를 올리는 것인지 묻는다 — 그렇다면 아래 「갱신」, 아니면 덮어쓰지 않는다 |
| `⚠️ 확인` 줄의 미커밋 변경 | 로컬 전용이면 진행하고 보고에 적는다 — 설치 전 `git status --porcelain` 출력을 적어 둔다(⑧-a 가 그것과 비교한다) · 공유를 고르면 ⛔ 멈춘다(설치 파일이 작업 중 변경과 한 커밋에 섞인다) · 겹침 줄(`설치가 고치고 git 에서 숨기는 경로에 …`)이 있으면 그 파일을 사용자에게 보여 주고 진행 여부를 묻는다. 한계: 전역 gitignore 가 `.claude/` 를 무시하는 PC 에서는 `.claude/` 의 미추적 파일(`settings.local.json` 등)이 `git status` 에 안 나와 겹침 줄이 `CLAUDE.local.md` 만 잡는다 — 설치는 `settings.local.json` 을 병합만 해서 위험은 낮다 |
| `context-graph 있음` | 그 프로젝트의 그래프 기록이 이미 있다 — ⛔ 기록은 옮기지 않는다. 그래프 도구는 키트 판을 그대로 얹고(② — 도구가 두 벌이면 판이 갈라진다) ⑤ 에 `graph` 를 적은 뒤 ⑥ 끝에서 `upgrade --migrate-graph` 로 기록 위치(`graph.store`)를 잇는다. 기록 규칙이 지시 파일 · 스킬에 있으면 graph.md 는 얹지 않는다(⑦의 그래프 단계 생략). 보고에 적는다 |

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
cp <kit>/templates/rules/graph.md <대상>/.claude/rules/graph.md          # 기록 규칙이 지시 파일 · 스킬에 있으면(⑤ graph.rules) 생략
cp -r <kit>/templates/skills/final-gate <대상>/.claude/skills/
cp <kit>/templates/state/decisions.md <대상>/<장부>/decisions.md
cp <kit>/templates/state/lessons.md <대상>/<장부>/lessons.md
cp <kit>/templates/scan.json <대상>/.harness/scan.json                   # 공유 모드만 — 민감 정보 패턴 (③에서 프로젝트에 맞춘다)
git -C <kit> rev-parse HEAD > <대상>/.harness/kit-commit                 # 얹은 키트 판 — ⑧-f 이식 검사 ⑨ 가 키트의 지금 커밋과 비교한다
```

그래프 도구도 늘 이렇게 복사한다 — `context-graph 있음` 이어도 빼지 않는다(13차 — 빼면 그 설치의 그래프가 키트와 따로 자란다).

대상에 이미 가정 장부 · 교훈 파일이 있으면 템플릿을 복사하지 않고 ⑤에서 그 경로를 적는다(⛔ 옮기지 않는다).

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
| `CLAUDE.md` 만 (import 유무와 무관) · 또는 둘 다이고 `CLAUDE.md` 가 `@AGENTS.md` 를 import | 그대로 | 그대로 |
| `AGENTS.md` 만 | `cp <kit>/templates/map/CLAUDE.md <대상>/CLAUDE.md` | `<대상>/CLAUDE.local.md` 를 `@AGENTS.md` 한 줄로 만든다 (이미 있으면 맨 위에 그 한 줄) |
| 둘 다, `CLAUDE.md` 가 import 안 함 | `AGENTS.md` 가 안 읽히고 있다고 보고하고 import 한 줄을 제안 | 같음 |

- `AGENTS.md` 만 있어도 Claude Code 가 읽지만 **8.3 단축 경로(`C:\Users\ABCDEF~1\…`)로 연 세션은 읽지 않는다**(실측) — 그래서 다리를 놓는다
- 하네스 규칙은 `.claude/rules/` 에 있어 지시 파일과 무관하게 로드된다. ⛔ 규칙을 지시 파일에 복사하지 않는다

새로 만든 지도 골격(`AGENTS.md` 또는 `CLAUDE.local.md`)의 `<…>` 는 대상을 읽고 채운다 — 목적(README) · 빌드·테스트 명령 · 구조. 모르는 칸은 `<…>` 로 남기지 말고 지운다.

### ⑤ `.harness/harness.json`

`profile` · `mode` 를 ①에서 정한 값으로, `state.decisions` · `state.lessons` 를 `<장부>/…` (또는 대상이 이미 쓰는 장부 경로)로 적는다.
`graph` 는 선택이다 — `store`(기록 위치, 기본 `.harness/graph/requests.jsonl`) · `names`(식별자로 치지 않을 프로젝트 이름, 기본은 저장소 폴더 이름의 `-` · `_` 앞부분 — 워크트리를 쓰면 적는다) · `rules`(기록 규칙 자리, 기본 `` `.claude/rules/graph.md` ``). 그래프 도구는 늘 `.harness/tools` 한 벌이다.
`context-graph 있음` 이면 `"graph": { "tools": "<그 프로젝트의 그래프 도구 폴더, 예: tools>", "rules": "<기록 규칙이 있는 곳 — 지시 파일의 절 · 스킬 이름>" }` 로 적고 ⑥ 끝에서 `node <kit>/tools/upgrade.mjs <대상> --migrate-graph` 를 돌린다 — `store` 를 그 기록 경로로 적고 `tools` 를 걷고, 살아있는 기록의 files 에서 옛 도구 경로만 `.harness/tools/` 로 한 번 바꾼다(기록은 옮기지 않는다 · note 는 그대로). 출력의 「키트 밖 그래프 도구를 가리키는 곳」(파일:행 — 그 프로젝트의 지시 파일 · 스킬 · 검사 명령)은 사용자에게 보여 주고 `.harness/tools/graph-*.mjs` 로 고친다 — 남아 있으면 ⑧-f ⑤ ⛔.
`checks` 에는 **실제로 도는 명령**만, 그리고 결과 XML 을 **매번 새로 쓰는** 명령만 적는다 — verify 는 이번 실행이 쓰지 않은 XML 을 증거로 쓰지 않는다.
테스트 검사에는 `covers` — **그 테스트가 실제로 돌리는 코드**의 glob 배열(예: `["src/**"]` · 모노레포 `["backend/src/main/**"]`)을 적는다. 타입 검사 · 그래프 무결성 · 다른 언어의 테스트에는 두지 않는다. 관문 훅은 덮이지 않은 코드 변경에 `/code-review` 를 요구하고, `covers` 가 하나도 없으면 verify 첫 줄이 「코드 검사 없음 — 코드 변경의 증거는 /code-review」다.

**처방 목록** — 스택별 검사는 `<kit>/policy/recipes.json`(키트 소유 — 단서 · 명령 · kind · covers 힌트 · 수정 직후 검사 · 근거)에 있고, `detect` 의 「처방 후보: <id> — <이름> (검증됨|후보)」 줄이 이 대상에 맞는 처방이다. 「검증됨」은 실제 설치에서 쓰는 처방, 「후보」는 잰 적 없는 처방이라 사용자에게 보여 주고 고른다(자동 적용 안 함). 처방의 `<…>` 는 대상에 맞춰 채운다. **검사마다 출처를 적는다** — 처방대로면 `"recipe": "<처방 id>"`, 처방에서 벗어났거나 처방이 없으면 `"why": "<이유>"`(둘 다 써도 된다). 없거나 목록에 없는 처방 id 면 갱신 exit 1 · ⑧-f ⑤ ⛔ — 같은 벗어남이 여러 설치에서 반복되면 처방 목록에 올릴 후보다. 아래 표에서 처방이 있는 스택은 처방 id 만 적는다(명령은 목록에만).

| 스택 | `cmd` | `kind` · `evidence` |
|---|---|---|
| Node (`node:test`) | `package.json` 의 `test` 가 junit 을 디렉터리에 쓰고 그 디렉터리를 먼저 만들면 `npm test`. 아니면 `node -e "require('fs').mkdirSync('test-results',{recursive:true})" && node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=test-results/junit.xml "test/*.test.mjs"` | `junit-xml` · `test-results` |
| Node (vitest) | `npx vitest run --reporter=default --reporter=junit --outputFile.junit=test-results/junit.xml` — 리포터는 `package.json` 이 아니라 명령에 붙인다(추적 파일을 고치지 않는다). 결과 디렉터리는 vitest 가 만들고 매번 새로 쓴다 | `junit-xml` · `test-results` |
| Gradle | `./gradlew cleanTest test` (Windows `cmd`: `.\gradlew cleanTest test` — JSON 에서는 `".\\gradlew cleanTest test"`) | `junit-xml` · `build/test-results/test` |
| Maven | 처방 `maven-test` · 래퍼면 `./mvnw test` (Windows `cmd`: `.\mvnw test`) | 처방대로 |
| pytest | 처방 `python-pytest` | 처방대로 |
| Node (Jest) · junit 리포터가 없다 · 다른 언어 저장소에 JS 테스트만 있다 | 처방 `node-npm-test` — ⛔ 리포터를 넣으려고 의존성을 더하지 않는다 | 처방대로 — Jest 는 테스트가 0개면 스스로 실패한다(`--passWithNoTests` 가 없을 때) · `covers` 는 테스트가 import · 읽는 파일만 |
| 결과 XML 을 낼 수 없다 | 테스트 명령 | `exit-code` — ⚠️ 테스트 0개를 못 잡는다고 사용자에게 알린다 |
| 테스트 러너가 아직 없다 (신규 · 골격 전) · 기존인데 테스트 소스가 없거나 이 PC 에서 테스트를 못 돌린다 (`mvn` 없음 · `skipTests` 등) | 실제로 도는 검사만 — 타입 검사(처방 `node-tsc`) · 전체 소스 컴파일(처방 `java-javac-compile`) · 컴파일이 도는 다른 길이 있으면 그 빌드(예: 컨테이너 빌드 — 오래 걸리면 넣지 않는다) · 아래 그래프 무결성 | `exit-code` — 그 검사 하나에 「테스트 없음」을 선언한다: `"tests": "none"` + `"why": "<이유 — 예: 테스트 소스 없음, 첫 테스트 때 junit 검사와 covers 를 더한다>"`(선언 키는 이것 하나 · why 없으면 ⑧-f ⑤ ⛔). 그러면 빌드 · 테스트 단서가 있어도 갱신 · ⑧-f ⑤ 가 covers 로 멈추지 않고, ⑧-f 「프로젝트 맞춤」에 「테스트 없음 — 코드 변경마다 /code-review」가 늘 보인다. 선언 뒤 테스트 소스(`src/test` · `test` · `tests`)가 생기면 ⚠️ 「테스트가 생겼다」 — junit 검사는 첫 테스트를 만들 때 더한다. ⛔ 테스트 명령을 지어내 넣지 않는다. ⚠️ 이때 verify 녹색은 코드 변경의 증거가 아니다 — final-gate 의 `/code-review` 단계가 그 자리다. 보고에 「테스트 검사 없음 — 코드 변경은 /code-review 로」를 적는다 |
| 생성물이 계약 (OpenAPI 스냅샷 등) | 생성 명령 | `file-unchanged` · 산출물 경로 |
| 검증 쿼리 · 운영 저장소 | 결과를 stdout 에 내는 명령 | `output-match` · `"expect": "<정규식>"` (예: `"^rows=0$"`) |
| MyBatis 매퍼 XML(추적 XML 에 MyBatis DOCTYPE — `detect` 가 처방 후보로 낸다) — 테스트 · 컴파일 검사에 더한다 | 처방 `mybatis-xml` — `--jar` 는 저장소 안 jar 또는 Maven 로컬 저장소 jar(앞 `~` 가능) · 매퍼가 아닌데 MyBatis DOCTYPE 을 단 파일(코드 생성기 템플릿 등)은 `--skip` | 처방대로 — covers 없음(형식만 본다 — 매퍼 변경은 `/code-review`) · 「후보」라 사용자에게 보여 주고 고른다 |
| 그래프 무결성 | 처방 `graph-check` — 기록 위치는 `graph.store` 를 따른다 | 처방대로 |

- Node 는 junit 결과 디렉터리를 만들지 않는다 — 없으면 ENOENT 로 죽는다(실측). `node --test` 에는 디렉터리가 아니라 glob 을 준다
- ⚠️ Windows 의 Claude Code 는 `NoDefaultCurrentDirectoryInExePath=1` 을 걸어 `cmd` 가 현재 폴더의 실행 파일을 찾지 않는다 — `gradlew` · `gradlew.bat` 은 「내부 또는 외부 명령이 아닙니다」, `.\gradlew` 만 돈다(실측, `./gradlew` 는 `cmd` 에서 늘 실패). 저장소 안 래퍼만 `.\` 를 붙인다 — PATH 의 `mvn` · `npx` 는 상관없다. 모노레포 예: `cd backend && .\gradlew cleanTest test`
- 명령은 플랫폼 기본 셸(`sh` / Windows `cmd`)로 돈다. 팀이 OS 를 섞어 쓰면 양쪽에서 같은 명령(`npm test` 등)을 고른다
- 지시 파일 · README 에 빌드·테스트 명령이 적혀 있으면 그것을 쓴다
- 후보는 `detect` 의 「처방 후보」 줄과 「테스트 단서」 줄이다 — 루트와 하위 폴더 한 단계(`backend/` · `frontend/` 등)의 `package.json` `test` · `typecheck`, `gradlew` · `pom.xml` · pytest

### ⑥ 설정 · 플러그인 · 규칙 자리

```bash
node <kit>/tools/plugin-plan.mjs                             # 먼저 — 이 PC(사용자 범위)를 키트 마켓에 맞출 명령을 낸다. 아래 표로 할 일을 정한다
node .harness/tools/policy-apply.mjs --with gate-hook          # 공유 → .claude/settings.json
node .harness/tools/policy-apply.mjs --local --with gate-hook  # 로컬 전용 → .claude/settings.local.json
```

권한 · 관문 훅이 기존 설정 위에 병합된다(다시 돌려도 같다). 관문 훅(`gate-hook`, Stop)은 이번 턴의 증거 세트 — 코드를 바꿨으면 `/ponytail-review` · 덮는 검사(`covers`)가 없으면 `/code-review` · 덮는 검사가 있으면 마지막 코드 변경 뒤의 verify · verify 를 돌렸으면 final-gate · 그래프 기록 파일이 있는 설치면 이번 턴의 기록 변경 뒤 `graph-find --check` 또는 마지막 답의 `그래프: 기록 안 함 — <이유>` 한 줄 — 에서 빠진 것만 적어 한 번 되돌려 보낸다. 실제 세션에서 모델은 verify 를 바로 돌리고 스킬을 건너뛰었다(코드 변경 뒤 0/7). 결과를 기다리는 작업(서브에이전트 · 백그라운드 verify)이 도는 멈춤은 통과이고, 상주 개발 서버만 떠 있으면 울린다.

**플러그인은 PC(사용자 범위)에서 켜고, 프로젝트에는 선언하지 않는다** — 로컬 설치는 플러그인 선언을 쓰지 않는다. 그래서 켜고 끄기 · 판 올리기가 PC 에서 한 번으로 끝난다. 공유 모드만 팀원 PC 용으로 `settings.json` 에 superpowers 를 선언한다. 프로젝트 설정에 남은 superpowers · ponytail 항목(켬이든 끔이든 · 옛 마켓 id 포함), 옛 정책의 `extraKnownMarketplaces.ponytail`, `PONYTAIL_DEFAULT_MODE=off` 는 `policy-apply` 가 걷고 출력의 `걷음:` 줄로 알린다. ⛔ 「이 id 를 false 로 두면 전역에서 켜져도 이 프로젝트에서는 꺼진 채」 같은 이유로 남길지 사용자에게 묻지 않는다 — 플러그인은 PC 에서만 관리한다(사용자 결정). `--only gate-hook` 은 걷지 않는다.

**ponytail 은 플러그인이 아니라 사용자 스킬 `ponytail-review` 하나로 둔다** — 관문이 쓰는 것은 `/ponytail-review` 뿐이고, 스킬 파일은 다른 파일에 기대지 않는다. 플러그인은 지우지 않고 사용자 범위에서 끈다 — 지시 파일이 ponytail 모드를 쓰는 프로젝트(`--only gate-hook` 대상)는 자기 설정에서 `ponytail@harness-kit` 을 켠다.

⚠️ `policy-apply` 는 **Claude 자신의 권한 설정을 바꾸는 명령**이다 — 권한 확인이 뜨거나, auto 모드 분류기가 `Self-Modification` 으로 막을 수 있다(실측: 같은 명령이 한 세션에서는 돌고 다른 세션에서는 막혔다). ⛔ 막히면 다른 도구로 같은 파일을 직접 써서 우회하지 않는다 — 사용자에게 `! node .harness/tools/policy-apply.mjs --local --with gate-hook` 한 줄로 직접 돌리게 한다(공유면 `--local` 없이). 그 뒤 ⑧-c · ⑧-d 를 잇는다. 비대화형이면 보고의 「사용자가 결정해야 하는 것」 **맨 앞**에 남긴다.

플러그인은 키트 마켓(`<kit>/.claude-plugin/marketplace.json`)이 실측한 커밋(sha)으로 **사용자 범위**에 둔다. 공식 마켓은 자동 업데이트가 켜져 있고, 출처에 sha 가 없으면 설치한 날의 최신이 들어오기 때문이다. 마켓 경로는 PC 마다 달라 프로젝트 설정에 넣지 않는다 — 공유 모드의 팀원도 자기 PC 에서 이 단계를 한다.

| `plugin-plan` 출력 | 행동 |
|---|---|
| `✅ … 옮길 것 없다` | 아무것도 하지 않는다 |
| `⚠️ … 옮긴다` + 명령 | 명령을 사용자에게 보여 주고 묻는다 — 이 PC 의 모든 프로젝트에 걸린다. 승인하면 **정책 반영 전에** 그 순서대로 실행한다(리뷰 스킬 → 새 것 설치 · 판 올림 → ponytail 끄기 → 옛 것 지우기). 막히면 사용자가 `!` 로 한 줄씩 돌린다 |
| ponytail 끄기 앞 — 지시 파일이 ponytail 모드를 쓰는 프로젝트가 이 PC 에 있다 | 끄기 전에 그 프로젝트 세션이 자기 사용자에게 묻고 자기 설정(`settings.local.json`)에 `"ponytail@harness-kit": true` 를 넣게 한다 — 안 그러면 그 프로젝트의 모드가 꺼진다 |
| 위에서 거절 · 비대화형 | 실행하지 않는다. 보고의 「사용자가 결정해야 하는 것」에 남긴다 — ⚠️ 실측한 커밋에 고정되지 않는다. ponytail 플러그인 끄기를 거절했으면 그 PC 의 전역 env(`~/.claude/settings.json`)에 `PONYTAIL_DEFAULT_MODE=off` 를 두게 한다 — 모드가 superpowers 의 설계 · 질문 단계와 충돌한다. 같은 플러그인이 다른 마켓 id 로 켜진 PC 에서 공유 모드를 받으면 `--off superpowers@harness-kit` 으로 이 PC 의 `settings.local.json` 에만 끈다 |

규칙 · final-gate 의 자리를 채운다 — `<decisions>` · `<lessons>` 는 장부 경로, `<graph-tools>` 는 `.harness/tools`, `<graph-rules>` 는 ⑤ 의 `graph.rules`(없으면 `` `.claude/rules/graph.md` ``):

```bash
grep -n '<decisions>\|<lessons>\|<graph-tools>\|<graph-rules>' .claude/rules/harness.md .claude/skills/final-gate/SKILL.md   # 바꾼 뒤 ⛔ 아무것도 나오지 않아야 한다
```

**기존 체계를 그대로 지켜야 하는 대상** — 지시 파일이 흐름 · ponytail 모드 · 권한을 이미 정했고 사용자가 「바꾸지 말라」고 하면 정책 줄 대신 `node .harness/tools/policy-apply.mjs --local --only gate-hook` 으로 관문 훅만 건다. 권한 · `PONYTAIL_DEFAULT_MODE` · 플러그인 선언은 그대로이고, ⑧-c(ponytail 꺼짐)는 해당 없다. 규칙의 맨 위 줄이 「지시 파일이 정한 것이 이긴다」를 말한다.

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
커밋이 몇 개뿐이면(설치 직전의 첫 커밋 등) 아래 커밋 소급은 건너뛰고 앞의 원천으로 채운다 — 건수를 맞추려고 지어내지 않는다.

```bash
git log --format='%h %ad %s%n%b' --date=short -60      # 본문까지 본다 — 근본 원인은 대개 본문에 있다
```

- 수정 커밋(`fix` · 버그 · 원인) 중 **근본 원인이 드러난 것**만 lessons 2~3건 — `node .harness/tools/lesson-append.mjs`(필드는 `.claude/rules/harness.md` 의 예시 — 맡긴 설치처럼 규칙이 아직 안 읽힌 세션은 그 파일을 연다). 이미 테스트·규칙으로 막혀 있으면 `guard` 에 그 위치를 적는다
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
**사용자가 조건 전에 켜기로 정하면 켠다** — `--check` exit 0 만 지키고, 정한 것을 다시 묻지 않는다. 보고에는 「n건 · 점유 미측정 — 사용자 결정으로 조건 전에 켬」, 「사용자가 결정해야 하는 것」에는 「20건을 넘기면 점유를 재고 유지 여부를 정한다」를 남긴다. 실측은 `docs/proof.md` 「조건 전에 켠 그래프 훅」 — 판정자 1명 · 한 프로젝트라 이것으로 조건을 풀지 않는다.
점유는 확신 질의 중 가장 자주 1위를 한 기록 3개가 1위인 비율이다 — 건수는 대리 지표다. 소급 측정: 20건 42% · 50건에서 재상승 — 켠 뒤에도 잰다. 질의 집합(이슈 제목 export — `[{title}]` · `[{subj}]` · `{tasks:[{subj}]}`)이 없으면 앞의 둘만 보고, 보고에 「독점 미측정」을 쓴다. 점유가 높으면 1위를 독점하는 광역 기록을 주제별로 나눈다.

```bash
node .harness/tools/graph-measure.mjs . --tickets <이슈 제목 json>   # 「상위3 점유 n%」
node .harness/tools/policy-apply.mjs --local --with graph-hook    # 로컬 전용
node .harness/tools/policy-apply.mjs --with graph-hook            # 공유
```

**파일 기록 훅은 선택이다** — 모델이 읽은 파일에 걸린 기록(정본 · 함정 · ⏸)을 붙인다. 프롬프트 훅을 못 받는 서브에이전트에 기록이 닿는다. 사용자가 켜기로 하면 `node .harness/tools/policy-apply.mjs --local --with graph-read-hook`(공유 모드는 `--local` 없이). 켠 설치는 갱신 안내 · 이식 검사 ④ 가 이 훅도 본다.

#### 신규 구축 (`new`)

- 소급할 과거가 없다 — lessons 는 비워 둔다
- ④에서 만든 지도 골격을 채운다
- 브레인스토밍 스펙 · 설계 문서가 있으면 현업 용어 → **계획한 식별자**를 그래프에 시드한다. `note` 에 `설계 용어 — 구현 후 재확인` 과 출처 경로. 구현에서 이름이 바뀌면 `supersedes` 로 맞춘다
  - 용어가 몇 개뿐이면 용어마다 `node .harness/tools/graph-alias.mjs <용어> "<계획한 식별자>" --note "설계 용어 — 구현 후 재확인"`
  - 문서에서 여럿을 한꺼번에 뽑으면 기존 이식의 용어 사전처럼 `graph.md` 의 기록 단위(「이 용어들이 같은 질문에서 함께 필요한가」)로 묶어 `graph-append` 주제 기록으로 — 용어 1개짜리 기록 수십 건은 `req` 가 빈약해 정확일치를 못 받는다
- ⭐ **`checks` 에 junit 검사가 있으면, 첫 테스트 전에는 verify 가 「실행된 테스트가 0개」로 실패하는 것이 정상이다** — 보고에 그렇게 적는다. ⛔ 통과시키려고 검사를 빼거나 `exit-code` 로 바꾸지 않는다. 테스트 러너가 아직 없어 exit-code 검사(⑤ 「테스트 러너가 아직 없다」)만 두었으면 exit 0 이 나온다 — 보고에 「테스트 검사 없음 — 첫 테스트 때 junit 검사와 covers 를 더한다」를 적는다
- 훅은 켜지 않는다 — 조건이 차면 위 「그래프 훅」대로

### ⑧ 검증 — ⛔ 자기 보고도 도구 출력도 믿지 않는다

**⑧-a. 도구가 도는가**

```bash
node .harness/tools/verify.mjs; echo "exit=$?"    # 기존: exit 0 · 신규: junit 검사가 있으면 첫 테스트 전 「실행된 테스트가 0개」, exit-code 검사만이면 exit 0
node .harness/tools/decision-check.mjs
node .harness/tools/graph-find.mjs --check; echo "exit=$?"     # ⛔ exit 0 (graph 모듈을 얹었으면)
node .harness/tools/install-mode.mjs <local|share>             # 다시 돌려도 같다 — 모드대로인지 다시 확인
node .harness/tools/scan-shared.mjs; echo "exit=$?"            # 공유 모드만 — ⛔ exit 0 (소급 기록에 민감 정보가 없는가)
git status --porcelain                                          # 의도한 파일만 보이는가 (로컬 전용이면 설치 전 출력과 같아야 한다 — 미커밋 변경 위에 설치했으면 ① 에서 적어 둔 그 줄들만)
```

**⑧-b. 규칙이 새 세션에 로드되는가** — 도구를 끈 새 세션으로 양성 2 · 음성 1

```bash
claude -p --model sonnet --tools "" --strict-mcp-config --no-session-persistence "도구를 쓰지 마라. 이 저장소에서 코드를 바꾼 작업의 완료를 주장하기 전에 반드시 돌려야 하는 명령은 정확히 무엇인가? 주어진 지시에 없으면 정확히 '모름'이라고만 답하라." < /dev/null
claude -p --model sonnet --tools "" --strict-mcp-config --no-session-persistence "도구를 쓰지 마라. 이 저장소에서 과거 요구와 현업 용어를 찾을 때 먼저 돌리는 명령은 정확히 무엇인가? 주어진 지시에 없으면 정확히 '모름'이라고만 답하라." < /dev/null
claude -p --model sonnet --tools "" --strict-mcp-config --no-session-persistence "도구를 쓰지 마라. 이 저장소의 배포 승인권자는 누구인가? 주어진 지시에 없으면 정확히 '모름'이라고만 답하라." < /dev/null
```

`--tools ""` 는 MCP 도구를 막지 않는다 — `--strict-mcp-config` 가 없으면 모델이 연결 도구(예: 문서 검색)를 불러 답이 흐려진다(2026-11-05 실측). 양성은 `verify.mjs` 와 `graph-find.mjs` 를, 음성은 「모름」을 답해야 한다. 측정 모델은 sonnet 이다 — haiku 는 규칙이 실려도 「모름」으로 빠진다(2026-11-05 실측: 설치 2곳 × 질문 3 × 3회에서 sonnet 18/18 · haiku 17/18, 지시 파일이 짧은 쪽에서도 빠졌다 · sonnet 회당 $0.02~0.04). 응답은 모델 표본이라 흔들린다 — 양성이 「모름」이면 같은 질문을 두 번 더 해 **3회 중 2회 이상**이면 통과로 보고 「n/3」을 적는다(실측: 같은 설치에서 3회 중 1회 「모름」). 2회 이상 「모름」이면 `.claude/rules/` 의 위치를 본다.

**⑧-c. PC 가 키트에 맞는가 · ponytail 은 리뷰 스킬만인가** — 정책이 아니라 PC 의 상태다(⑥)

```bash
node <kit>/tools/plugin-plan.mjs    # ⛔ 「옮길 것 없다」 — 리뷰 스킬이 고정 커밋에서 받은 그대로 · ponytail 플러그인은 사용자 범위에서 꺼짐 · superpowers 는 고정 판
```

지시 파일이 ponytail 모드를 쓰는 프로젝트(`--only gate-hook` 대상)는 자기 설정에서 ponytail 을 켠다 — 그 프로젝트는 이 점검의 「꺼짐」에 해당하지 않는다. 모드 훅을 세션 출력으로 확인하려면 stream-json 이 아니라 `--debug-file` 을 본다 — stream-json 에는 UserPromptSubmit 훅 이벤트가 나오지 않는다(2026-11-05 실측).

**⑧-d. 플러그인이 하나씩인가** — `claude plugin list --json` 에서 이름이 superpowers 인 `enabled` 항목의 **id** 가 하나다. ponytail 은 0개(리뷰 스킬만)가 기본이고, 모드를 쓰는 프로젝트 안에서만 하나다.
같은 id 가 여러 줄인 것은 정상이다 — 목록은 이 PC 의 모든 프로젝트 설치 기록을 보여준다.

**⑧-e.** `git diff` 와 새로 생긴 파일 목록을 사용자에게 보여준다. 로컬 전용이면 `git diff` 에는 (미커밋 변경 위에 설치했다면) 작업 중 변경만 나오고 설치 파일은 안 나온다 — 설치 파일은 새로 생긴 파일 목록으로 보여준다. 기존 설정·지시 파일 보존은 사용자만 판정한다.

**⑧-f. 이식 검사 — 키트와 같은가 (마지막)**

```bash
node <kit>/tools/install-check.mjs <대상>    # ①~⑨ 표 + 판정 줄 — ⛔ 가 하나라도 있으면 exit 1
```

| | 보는 것 |
|---|---|
| ① 도구 | `.harness/` 의 키트 도구(그래프 도구 포함 — 예외 없음) · lib · 정책이 키트 판과 같다(줄바꿈 무시) · 키트에서 지운 것 0 |
| ② 규칙 · ③ 스킬 | `harness.md` · `graph.md`(기록 규칙 자리가 기본일 때) · `final-gate` 가 키트 판(자리 채움)과 같다 — 다르면 다른 줄 요약 |
| ④ 정책 | `policy-apply` 를 그 설치 모양(정책 전체 · 관문 훅만 · 그래프 훅 켬 — 옛 자기 그래프 훅이면 키트 훅으로 바꿔 끼울 것 · 파일 기록 훅 켬)대로 다시 돌려도 바뀌는 것이 없다 |
| ⑤ `harness.json` | 형식 · 프로필 · 모드 · 장부 파일 · 그래프(옛 자기 그래프 `graph.tools` 는 이관 미완 · `graph.store` 가 있으면 실재 · 키트 밖 그래프 도구를 가리키는 줄 0) · 빌드 · 테스트 단서가 있으면 `covers` 검사 1개 이상 또는 「테스트 없음」 선언 · 검사마다 `recipe`(목록에 있는 처방 id) 또는 `why` |
| ⑥ PC | `plugin-plan` 이 낼 명령이 없다 — superpowers 고정 판 · `ponytail-review` 가 고정 커밋에서 받은 그대로 |
| ⑦ 지시 파일 | Claude 지시 파일이 있고, `AGENTS.md` 가 있으면 import 한다(공유는 커밋되는 `CLAUDE.md` 가) |
| ⑧ 동작 | `verify` exit 0(신규의 첫 테스트 전 「실행된 테스트가 0개」는 정상) · 그래프 `--check` exit 0 · 관문 훅이 코드만 바꾼 합성 턴을 되돌리고 다 갖춘 턴(그래프 기록이 있는 설치면 `그래프: 기록 안 함` 한 줄 포함)은 통과 |
| ⑨ 판 | `.harness/kit-commit` = 키트의 지금 커밋 — 또는 그 뒤 키트가 설치본에 얹는 것(`lib` · `tools` · `policy` · `templates`)이 그대로(문서만 바뀐 커밋은 다시 갱신하지 않는다 · 키트가 모르는 커밋 · `-dirty` 는 ⛔) |

설치본의 자리는 세 갈래고 정본은 `<kit>/lib/parts.mjs` 한 곳이다 — **키트 소유**(키트 판과 같아야 한다 — ① ② ③ ⑨) · **프로젝트 설정**(`harness.json` 의 검사 · 처방 · why · covers · 테스트 없음 · `graph.names` · `graph.store` · 지시 파일 본문 · `.claude/rules/project-*.md` — 모양과 출처만 ⑤) · **프로젝트 데이터**(그래프 기록 · 장부 본문 · 기준선 — 멀쩡한가만 ⑧). 프로젝트가 `.harness/` 에 더한 도구는 키트 소유가 아니라 보지 않는다. 판정 줄 아래 「프로젝트 맞춤」 절이 설정 · 데이터를 보인다(검사마다 kind · 명령 앞부분 · covers 개수 · 처방 또는 why · 「테스트 없음」 · graph.names · graph.store · 기록 건수 · 프로젝트 규칙 · 장부 줄 수(빈 줄 뺀 수)) — 판정은 아니지만 보고에 같이 붙인다. ⛔ **exit 0 이 아니면 「이식 성공」이라고 쓰지 않는다** — ⑨ 보고에 표와 판정 줄을 그대로 붙인다. ⛔ 행은 관측 칸대로 고치거나(② ③ 은 「갱신」의 `--own-rules`), 사용자 승인 자리면(④ 정책 줄 · ⑥ PC) 「사용자가 결정해야 하는 것」에 남긴다.

### ⑨ 보고 — 3단

```markdown
## ✅ 얹은 것
- 프로필 <new|existing> · 모드 <share|local> — <제안값 그대로인가, 사용자가 바꿨나>
- <경로>: <무엇을>
- 소급: lessons <n>건 · 그래프 <n>건 (원천: <무엇>) · 기준선 <n>건
- 검증: <⑧ 의 출력 그대로 — 「통과했다」로 줄이지 않는다>
- 이식 검사: <⑧-f 의 표와 판정 줄 그대로 — exit 0 일 때만 「이식 성공」>

## ⛔ 사용자가 결정해야 하는 것
1. <무엇> — <왜 내가 못 정하는가> (비대화형으로 제안값을 쓴 것은 전부 여기에)

## ⚠️ 이 프로젝트에 새로 생기는 제약
- 작업을 끝냈다고 보고하기 직전에 final-gate — 완료 증거 · 작업 파일 목록 · 기록이 한 세트
- 코드 변경의 완료 증거는 node .harness/tools/verify.mjs — 코드를 바꾼 턴은 /ponytail-review, 검사가 덮지 않는 코드면 /code-review 도(관문 훅이 확인한다)
- 요구가 오면 그래프 먼저 (node .harness/tools/graph-find.mjs), 끝나면 기록 — 코드를 바꾼 턴은 기록(뒤에 --check) 또는 「그래프: 기록 안 함 — <이유>」 한 줄(관문 훅이 확인한다)
- 프로젝트 설정의 자동 승인(allow)은 이 폴더를 신뢰해야 적용된다 — 대화형으로 한 번 열어 신뢰 대화상자를 수락한다 (실측: 신뢰 전에는 「Ignoring … permissions.allow entries」)
```

## 갱신 — 이미 얹은 프로젝트를 키트의 새 버전으로

①의 `detect` 가 「이미 설치됨」을 내고, 사용자가 키트를 새 버전으로 올리려는 것이면 ②~⑦ 대신 이것을 한다. 키트는 먼저 그 PC 에서 받아 둔다(`git -C <kit> pull`).

```bash
node <kit>/tools/upgrade.mjs <대상>
```

- `.harness/` 의 도구(그래프 도구 포함) · lib · 정책은 키트 것이라 덮어쓰고, 키트 커밋을 `.harness/kit-commit` 에 적는다(⑧-f ⑨). ⛔ 키트에 커밋 안 된 변경(`lib` · `tools` · `policy` · `templates`)이 있으면 아무것도 얹지 않고 exit 1 이다 — 미커밋 판이 커밋 이름으로 적힌다. 키트 세션이 커밋한 뒤 갱신한다(이식 검사도 키트가 더러우면 판정하지 않는다). 기록 · 장부 · 기준선 · `harness.json` 은 건드리지 않는다(장부는 아래 지운 템플릿 줄만 · `--migrate-graph` 는 아래 그래프 이관만)
- ⛔ `그래프 이관`(exit 1)이면 13차 전 「자기 그래프」 설치다(`harness.json` 의 `graph.tools`) — 키트 그래프 도구는 이미 `.harness/tools` 에 깔렸고 기록 · 규칙 · 옛 도구는 그대로다. 출력의 (a)(b) `--migrate-graph` 줄을 사용자에게 보여 주고 승인받아 돌린다 — `graph.store` 를 기존 기록 경로로 적고 `graph.tools` 를 걷고, 살아있는 기록의 files 칸에서 옛 도구 경로만 `.harness/tools/graph-*.mjs` 로 한 번 바꾸고(note · 대체된 기록은 그대로 · 기록은 옮기지 않는다), 규칙 · final-gate 를 키트 도구로 다시 깐다. (c) 「키트 밖 그래프 도구를 가리키는 곳」(파일:행 — 지시 파일 · 스킬 · 검사 명령)은 그 프로젝트의 파일이라 사용자에게 보여 주고 고친다. 옛 그래프 훅은 「다음」 2 의 정책 줄이 키트 훅으로 바꿔 끼운다. (d) 옛 `graph-*.mjs` 는 참조를 고친 뒤 프로젝트가 지운다 — 키트는 지우지 않는다(프로젝트 고유 도구는 그대로). 참조가 남아 있는 동안 갱신은 exit 1 · ⑧-f ⑤ ⛔ 이다
- 키트에서 지운 도구 · lib · 템플릿(`<kit>/policy/removed.json`)은 설치본에서 걷는다(`🧹 걷음` 줄). 내용을 쓴 대장은 남기고 `⚠️` 로 알린다. 키트 장부 템플릿에서 지운 줄(`lines`)은 장부에서 그 줄과 같은 줄만 걷는다(`🧹 걷음(키트에서 지운 장부 줄): 파일:행` — 프로젝트가 쓴 줄은 그대로). 지운 도구의 allow 줄은 「다음」의 정책 줄이 걷는다
- `⚠️ 그래프 기록이 지운 경로를 가리킨다` 줄이 나오면 **같은 턴에** 그 경로를 뺀 기록으로 `supersedes` 한다 — 그대로 두면 `graph-find --check` 가 빨강이고, 그것을 검사로 둔 설치는 verify 가 빨강이 되어 모든 코드 턴이 관문에 막힌다
- ⛔ `빌드 · 테스트 단서(…)가 보이는데 covers 를 가진 검사가 없다`(exit 1)면 멈춘다 — ⑤ 대로 그 코드를 돌리는 테스트 검사에 `covers` 를 적고 갱신을 다시 돌린다. 테스트 소스가 없거나 이 PC 에서 테스트를 못 돌리면(⛔ 테스트 명령을 지어내지 않는다) 실제로 도는 검사 하나에 `"tests": "none"` + `"why": "<이유>"` 를 적어 「테스트 없음」을 선언한다(⑤ 「테스트 러너가 아직 없다」 행) — 멈춤이 풀리고, 이식 검사 「프로젝트 맞춤」에 「테스트 없음 — 코드 변경마다 /code-review」가 늘 보인다(관문 훅은 그대로 코드 변경마다 `/code-review` 를 요구한다). 테스트 소스가 생기면 `⚠️ 테스트가 생겼다` — junit 검사와 `covers` 를 더할 때다
- ⛔ `처방 · why 없는 검사 …` · `목록에 없는 처방 …` · `「테스트 없음」 선언에 why 없음 …`(exit 1)이면 도구 · 규칙은 이미 얹혔다 — `harness.json` 은 프로젝트 설정이라 키트가 쓰지 않는다. 그 프로젝트 세션이 출력의 「처방 후보」를 보고 검사마다 `"recipe": "<처방 id>"` 또는 `"why": "<처방에서 벗어난 이유>"` 를 적고(⑤ 「처방 목록」) 갱신을 다시 돌린다
- 규칙 · final-gate 스킬은 설치본이 키트 이력의 한 버전(장부 경로를 채운 것)과 같을 때만 바꾼다. `⛔ … 프로젝트가 고쳤다 +n −m` 이면(exit 1) 키트 파일을 손으로 병합하지 않는다 — 다른 줄을 사용자에게 보여 주고 그 줄 끝의 `node <kit>/tools/upgrade.mjs <대상> --own-rules` 를 돌린다. 고친 줄은 `.claude/rules/project-<이름>.md` 로 옮겨지고(더한 줄은 그 절 제목 아래 · 뺀 키트 줄은 「따르지 않는 키트 줄」 · 「키트 판과 어긋나면 이 파일이 이긴다」) 키트 파일은 키트 판으로 다시 깔린다. 만들어진 파일을 사용자에게 보여 준다 — 로컬 전용이면 그 파일도 `.git/info/exclude` 에 들어간다
- 설정은 쓰지 않는다 — 출력의 「다음」을 그 순서로 한다. 첫 줄 `plugin-plan` 은 ⑥ 의 표대로 — 명령이 나오면 사용자에게 묻고 실행한다(그 PC 에서 한 번이면 다음 프로젝트부터 「옮길 것 없다」). 정책 반영 줄은 ⑥ 처럼 막히면 사용자가 `!` 로 돌린다. 정책 줄은 옛 정책이 이 프로젝트에 쓴 플러그인 선언 · `PONYTAIL_DEFAULT_MODE` 를 걷고(출력의 `걷음:`), 키트 훅을 새 형식으로 바꿔 끼운다. ⛔ 이전을 먼저 한다 — 선언만 걷히고 PC 에 키트 마켓 플러그인이 없으면 superpowers 가 빠진다
- 플러그인 판은 세션을 열 때 실린다 — 갱신 뒤 열려 있던 세션은 새로 연다
- 끝나면 ⑧-a~⑧-d(도구 · 새 세션 규칙 로드 · PC 맞춤 · 플러그인 하나씩)를 다시 하고, 마지막에 ⑧-f 이식 검사(갱신 출력 「다음」의 3) — 보고에 출력 그대로 붙인다. ⛔ exit 0 이 아니면 「갱신 끝 · 이식 성공」이라고 쓰지 않는다

**설치 현황 — 키트를 고친 뒤** — 키트 개선의 끝은 커밋이 아니라 이 PC 의 설치가 모두 같은 판이 된 때다:

```bash
node <kit>/tools/install-check.mjs --all <프로젝트들의 상위 폴더>   # 설치마다 ⑨ 판 · ① 동일만(verify 없이) — 뒤처지거나 다르면 exit 1
```

⛔ 행의 설치는 그 프로젝트 세션에 위 「갱신」을 맡긴다. 키트 저장소(자기 verify 용 `harness.json` 만 있는 클론)는 표에서 빠진다. 더 쓰지 않아 갱신하지 않기로 한 설치는 키트 저장소의 로컬 `.harness/harness.json` 에 `"installs": { "skip": ["<폴더 이름>"] }` 로 두면 표에 「제외」 줄로만 보이고 판정에서 빠진다 — 목록의 이름이 폴더에 없으면 ⚠️ 한 줄.

## PC 맞추기 — 다른 PC 에서 한 번

키트가 플러그인 구성을 바꿨을 때 다른 PC 에서 하는 순서다. 그 PC 의 Claude Code 에게 「`<kit>/SETUP.md` 의 「PC 맞추기」를 따라 이 PC 를 맞춰줘」라고 한다. 2026-11-05 변경: 플러그인은 PC 에서만 켠다 · ponytail 은 리뷰 스킬만 · superpowers 7.0.2 · 키트 훅 exec 형식. 2026-11-09: 리뷰 스킬 옆에 받은 커밋 기록 · 갱신 끝의 이식 검사.

1. **키트 받기** — `git -C <kit> pull`(main). 받은 커밋에 위 변경이 있는지 `git -C <kit> log --oneline -5` 로 본다
2. **PC(한 번)** — `node <kit>/tools/plugin-plan.mjs` 가 낸 명령을 사용자에게 보여 주고 승인받아 그 순서대로 실행한다(⑥ 표). 이 PC 의 모든 프로젝트에 걸린다
   - 리뷰 스킬 줄(`--review-skill`)은 고정 커밋의 `ponytail-review` 를 `~/.claude/skills/` 에 두고 옆에 받은 커밋 · 내용 해시(`.pinned.json`)를 적는다 — 그 커밋 그대로면 안 나온다. 2026-11-09 전에 받은 스킬은 기록이 없어 한 번 다시 나온다 · 키트가 ponytail 고정을 올리면 또 나온다
   - ponytail 끄기 줄 앞에, 지시 파일이 ponytail 모드를 쓰는 프로젝트가 이 PC 에 있으면 그 프로젝트가 자기 설정에서 켜게 한다(⑥ 표)
   - 전역 `~/.claude/settings.json` 의 `env.PONYTAIL_DEFAULT_MODE` 는 ponytail 플러그인이 꺼지면 아무 일도 하지 않는다 — 남겨도 되고 지워도 된다(사용자가 정한다)
3. **프로젝트마다** — 키트를 얹은 프로젝트에서 위 「갱신」. 정책 줄이 옛 선언을 걷고 훅을 새 형식으로 바꾼다. 어느 프로젝트를 할지는 사용자가 정한다
4. **확인** — `node <kit>/tools/plugin-plan.mjs` 가 「옮길 것 없다」, 갱신한 프로젝트마다 `node <kit>/tools/install-check.mjs <대상>` exit 0(⑧-f — 키트 훅 형식 · 플러그인 선언 · PC 가 그 표에 든다), 마지막에 `node <kit>/tools/install-check.mjs --all <프로젝트들의 상위 폴더>` exit 0(이 PC 설치가 모두 키트 판)
5. **세션 다시 열기** — 열려 있던 세션은 옛 플러그인 판 · 옛 훅으로 돈다

## ⛔ 하지 않는 것

| ⛔ | 왜 |
|---|---|
| 대상의 기존 파일을 옮기거나 덮어쓰기 · 지시 파일에 절 추가 | 기존 참조가 깨지고, 두 파일이 갈라진다. 규칙은 `.claude/rules/` 에 |
| 키트 파일(`.claude/rules/harness.md` · `graph.md` · `final-gate`)을 프로젝트에 맞게 고치기 | 갱신이 덮지 못해 설치본이 키트와 갈라진다(⑧-f ② ③ ⛔ · 갱신 exit 1) — 프로젝트 규칙은 `.claude/rules/` 의 별도 파일에 |
| ⑧-f exit 0 이 아닌데 「이식 성공」 | 이식 성공은 도구의 판정 줄로만 말한다 |
| 그래프 기록을 옮기기 · 그래프 도구를 프로젝트에 따로 두기 | 기록은 제자리에서 `graph.store` 로 잇는다. 도구가 두 벌이면 판이 갈라진다 — 키트 판 한 벌(`.harness/tools`) |
| 확인 없이 `verify --baseline` | 진짜 실패가 조용해진다 |
| 사용자가 정하지 않았는데 그래프 20건 전에 훅 | 몇 건이 모든 질의에 걸려 지연만 남는다 |
| 훅·스크립트로 기록을 자동 추출 | 검증 관문이 없다 — 낡은 정보를 더 빨리 쌓는다 |
| 개인 식별자를 그래프·장부에 | 공유 모드에서는 그대로 커밋된다 |
| 묻지 않고 공유 모드 · scan-shared 를 끄거나 `--no-verify` 로 건너뛰기 | 기록에 쌓인 사번·실명·이슈 번호가 저장소 밖으로 나간다 |
| 검사를 pre-push 에 전부 걸기 | 진행도 게이트를 correctness 게이트로 쓰면 급한 수정이 막힌다 |
| ponytail 모드를 켜 두기 | superpowers 의 설계·질문 단계와 충돌한다. final-gate 에서 `/ponytail-review` 로만 |
| 커밋 | 사용자가 diff 를 보고 결정한다 |

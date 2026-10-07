# harness-kit 구현 계획

> **구현자에게:** 이 계획은 구현을 넘기기 위한 것이다(설계서 §3 의 「인계」). 설계서 `docs/design.md` 가 정본이다 — 계획과 설계가 어긋나면 설계를 따르고 어긋남을 보고에 적는다. 각 태스크는 TDD 다: 테스트를 먼저 쓰고 → 실패를 보고 → 구현 → 통과. 체크박스를 채우며 간다.

**Goal:** agent-harness(증거·기록)와 context-graph(지식 그래프)를 한 이식용 템플릿으로 합치고, SETUP 이 신규 구축/기존 이식을 판별해 얹게 하고, 합성 대상에서 검증한다.

**출처 (읽기 전용 — ⛔ 수정 금지):** `C:\Project\agent-harness` (main `4c975f3`) · `C:\Project\context-graph` (`436712b`)
**작업 위치:** `C:\Project\harness-kit` 만.
**실행 상태 (2026-10-02):** Task 0~11 완료 · 지시함 1차 6건 · 2차 9건 · 3차 1건 처리. `npm test` 151 통과 · `node proof/run.mjs` 예상과 다른 행 0/29 · `--claude` 0/41(플러그인 기록 전후 같음) · SETUP 종단 run4 신규·공유 20/20 · 기존·로컬 18/20(⛔ 2행은 실험 쪽 — 질문 범위 · 정리 범위. 고친 뒤 3/3 · 기록 원복, README §실측) · 자기 verify exit 0. 테스트 · 결정론 실측이 자기 임시 폴더를 지운다(%TEMP% 개수 전후 같음) · `--test-concurrency=4` 로 spawn EPERM 불안정 5회 중 1회 → 0회(⚠️ 2026-10-07 재발 — 자기 verify 2회 중 1회. 0회는 그날 표본이다. 실패가 `spawn EPERM` 뿐이면 다시 돌려 확인한다). setup-e2e 는 run4 뒤 다시 돌리지 않았다. `/ponytail-review` · `/security-review` · 커밋은 부모 몫

## 📬 harness 지시함 — ⛔ 다음 태스크보다 먼저 처리하고, 처리한 줄은 `- [x]` 로 바꾼다

⚠️ `SendMessage` 로 보낸 지시가 실행 중인 너에게 도착하지 않는 것이 확인됐다(트랜스크립트에 흔적 0). **이 절이 부모의 지시 채널이다.** ⛔ **태스크를 시작할 때마다** `grep -A30 'harness 지시함' docs/plan.md` 로 이 절을 다시 본다 — 계획서를 처음 한 번 읽은 것으로는 새 지시를 못 본다.

**승인** — Task 0~3 의 차이 3곳(기준선 안 실패 1건 이상일 때만 exit≠0 통과 · enabledPlugins 의 명시적 false 보존 · 깨진 정규식 거부와 `--with` 이름 제한), Task 4~6 의 출력 문구 변경 · STORE 한 곳 · graph-view 출력 임시 폴더 · 전역 git 설정 격리 방식, Task 7~8 의 final-gate 테스트 문구 변경과 `graph --check` 를 exit-code 검사로 안내한 것. 모두 설계서에 반영됐다.

**⛔ Task 10 실측(`setup-e2e`)을 돌리기 전에** (Task 9 전에 처리했어야 했다 — Task 9 의 P9·P10 행 기대도 새 기본값으로 고친다):
- [x] **설계 변경 — 설치 모드 기본값은 신규·기존 모두 로컬 전용**, 공유는 사용자가 명시적으로 고른다(비대화형이면 로컬). `detect` 의 `mode: isNew ? 'share' : 'local'` → 항상 `local`. SETUP ①의 질문·⑦의 문구도 맞춘다 (design §0·§6)
- [x] `tools/scan-shared.mjs` 신규 (TDD, 작게) — `.harness/scan.json` 의 정규식 패턴으로 공유되는 기록·규칙 파일(`.harness/graph/` · 장부 · `.claude/rules/`)을 검사, 걸리면 값을 가려 보여주고 exit 1. 템플릿 `templates/scan.json` 에 기본 6종 예시(사번 형식 · 내부 도메인 · DB 접속 문자열 · 이슈 번호 · 실명이 든 파일명 · 자격증명 낱말). `install-mode share` 가 `.git/hooks/pre-commit` 에 연결(이미 훅이 있으면 덮지 않고 안내) (design §6)
- [x] graph 특성 테스트 보강 (`docs/graph-port.md` §1·§2): ③ 용어 「값」은 한글 질의에서 빠지고 식별자 질의에만 · ⑧ `--check` 대체 사슬 4종(고아 · 기록순 역행 · 자기 대체 · 중복 대체) 각각 exit 1 + 경로 무결성이 대체된 기록을 뺀다 · **훅 출력 문장 6개를 문자열로 고정**(지금 「열린 작업」만 있다 — 탈출구 · 「제거됨/바뀜」 · 「안 걸린 항목 N개(키만)」 · 2단 「억지로 고르지 않는다」 · 마지막 줄 「더 볼 것: node .harness/tools/graph-find.mjs」)
- [x] graph-measure 티켓 형식 (`graph-port.md` §4-d): `[{title}]` 도 받고, 하나도 못 읽으면 「형식을 못 읽었다」로 exit 1 — 조용한 0 금지. 테스트로
- [x] `graph.md` 판단 규칙 상위 5 (`graph-port.md` §3) 가 다 들었는지 대조 — 특히 원천 3분류 · 근거 등급(⚠️ 미확정) · 같은 주제 2건 이상이면 정본 통합 · 소급 단위(「같은 질문에서 함께 필요한가」, 커밋 기록은 terms 를 채워야 값)
- [x] 훅 조건 문구에 「⚠️ 20건은 측정된 값이 아니다 — 실제 위험은 독점률」 (design §6)

**Task 10 기대 변경:** 기존 대상은 제안값(로컬). **신규 대상은 프롬프트에 「설치 모드는 팀 공유로 고른다」를 명시**해 두 모드를 다 종단 실측한다 — 신규 기대 = 공유 · 부정 규칙 · pre-commit 스캔 훅 · `scan-shared` 통과.
- `check-install` 은 모드를 프로필에서 떼어 인자로 받는다 (`<대상> <new|existing> <local|share>`) — 지금은 `local = profile === 'existing'` 으로 묶여 있다
- 공유 판정에 더한다: `.git/hooks/pre-commit` 이 `scan-shared` 를 부른다 · 설치된 대상에서 `node .harness/tools/scan-shared.mjs` exit 0
- 실측 전·후 플러그인 기록 스냅숏 대조는 그대로

**⛔ Task 10 실측이 끝나면 — Task 11 전에** (그래프 운영 세션의 검토 반영 · 설계서 §5·§6 이 이미 고쳐져 있다 · setup-e2e 는 다시 돌리지 않는다):
- [x] `graph-measure` — 패턴마다 `상위3 점유 <n>%`(확신 질의 중 상위 3 기록이 1위인 비율)를 낸다. TDD: 한 기록이 독점하는 합성 저장소 ≥ 50% · 고루 퍼진 저장소 < 50%
- [x] 훅 켜는 조건을 **「20건 + `--check` exit 0 + 상위3 점유 < 50%」** 로 — `graph.md` §8 · SETUP ⑦ 「그래프 훅」 · `policy/graph-hook.json` 의 `_note`. 측정은 `node .harness/tools/graph-measure.mjs . --tickets <이슈 제목 json>`. 질의 집합이 없으면 앞의 둘만 보고, 보고에 「독점 미측정」을 쓴다. 「⚠️ 측정된 값이 아니다」 문구는 지우고 측정값 한 줄로 바꾼다: 20건 42% · 50건에서 재상승 → 켠 뒤에도 잰다 (design §5)
- [x] `graph.md` — 늘리는 줄은 세 곳뿐이다. 이 파일은 매 세션 로드된다
  - §4 제목: 「빈도순 — 피해는 ④가 가장 크다(거짓이 사실로 유통된다)」
  - ④에 더한다: 「⛔ 새 원천(문서 · DB 코멘트 · 담당자 답변 · 지난 세션 기록)도 단일 증거다 — 기존 기록과 어긋나면 어느 쪽도 먼저 믿지 않고 데이터로 재판정한다」
  - §1 「확인차 다시 보지 않는다」 뒤에 더한다: 「단, 새 원천이 기존 기록과 다른 값을 말하면 그때는 다시 본다」
- [x] `scan.json` 기본 패턴 보강 — TDD. 패턴마다 잡는 예 1 · 안 잡는 예 1을 테스트로 두고, ⛔ 합성 값만 쓴다
  - 패턴마다 `"놓치는 것"` 필드
  - DB 접속에 CLI 인자 형태: `psql` · `mysql` · `mongosh` · `redis-cli` · `sqlcmd` … `-h <host>`
  - 이슈 번호에 `<낱말> #<숫자 2자리+>` 형태. JIRA 형 제외 목록에 `ERR` · `HTTP` 를 더한다
  - 실명 파일명: 이름 뒤 버전 토큰 허용(`_<이름>_v1.0.pptx`)
  - 새 패턴 「하이픈 복합 번호」 `\d{2,}-\d{2,}-\d{2,}` — ISO 날짜 `\d{4}-\d{2}-\d{2}` 는 빼고, 전화번호는 잡힌다
  - 내부 도메인의 `놓치는 것`: 공개 TLD 를 쓰는 사내 호스트 — 설치 때 호스트 목록을 패턴으로 더한다
- [x] `scan.json` 에 `"reviewed": false`
  - 이 값인 동안 scan-shared 가 요약 줄 위에 「⚠️ 기본 패턴 그대로다 — 이 프로젝트의 사번 · 내부 호스트 · 이슈 형식에 맞춘 뒤 reviewed: true」를 낸다. exit 는 걸린 것으로만 정한다
  - SETUP ③ 공유 모드: 설치 때 사용자에게 그 세 형식을 묻고, 패턴을 맞춘 뒤 `true`. 비대화형이면 `false` 로 두고 「사용자가 결정해야 하는 것」에 남긴다
- [x] 실측 근거 주석 복원 — `graph-find` · `graph-hook` 에서 걷힌 수치를 **다섯 곳에 한 줄씩** 되살린다
  - 자리: 정렬 첫 키(정확일치 먼저) · 대체 기록 제외 · 용어 값은 식별자 질의에만 · 침묵 문턱 `s ≤ 2` · 정본 1장
  - 수치는 원본 `C:\Project\context-graph\tools\graph-{find,hook}.mjs` 주석에서만 가져온다. 형식: `// <규칙> — <측정 요지와 수치>. 바꾸려면 다시 잰다`
  - ⛔ 이슈 트래커 이름 · 프로젝트 이름은 옮기지 않는다
- [x] 플러그인 설치 범위를 모드에 맞춘다 — SETUP ⑥ 「없다」 행과 `harness.md` 「플러그인」 절. 공유는 `--scope project`, 로컬 전용은 `--scope local` (`plugin install` · `marketplace add` 둘 다 `local` 을 받는다 — `--help` 로 확인함). 지금은 로컬 전용에서도 `--scope project` 라서, 커밋될 `.claude/settings.json` 이 생긴다
- [x] `proof/run.mjs` 17행 주석의 8.3 단축 경로 예시를 `ABCDEF~1` 로 — 이 PC 의 사용자 이름에서 온 값이었다
- [x] ⛔ **이 레포의 템플릿이 커밋에서 빠진다** — `templates/map/AGENTS.md` · `templates/map/CLAUDE.md` 가 이 PC 의 전역 gitignore 에 걸려 무시된다. 확인은 `git check-ignore -v templates/map/AGENTS.md`. 부모가 `.git/info/exclude` 의 `CLAUDE.local.md` 를 `/CLAUDE.local.md` 로 고쳐 세 번째 파일은 이미 풀었다
  - TDD — 먼저 테스트: `git ls-files --others --ignored --exclude-standard templates` 가 비어야 한다. 지금은 2개가 나와 실패한다
  - 그다음 이 레포 `.gitignore` 에 `!templates/map/AGENTS.md` · `!templates/map/CLAUDE.md` 를 더한다. 주석은 한 줄 — 「전역 gitignore 가 이 이름을 무시해도 템플릿은 추적한다」
- 끝나면 `npm test` · `node proof/run.mjs` 를 다시 돌린다(예상과 다른 행 0). 보고에 「실측 뒤에 바뀐 파일」을 적는다

**⛔ 3차 — 보고 전에 (보안 검토 1건 · 다른 레포에 영향):**
- [x] `install-mode share` 의 pre-commit 이 **레포 밖에 써질 수 있다**
  - 원인: `git rev-parse --git-path hooks/pre-commit` 은 `core.hooksPath` 를 따라간다 — 부모가 확인함: `git -c core.hooksPath=C:/nowhere/hooks rev-parse --git-path hooks/pre-commit` → `C:/nowhere/hooks/pre-commit`
  - 피해: 전역 `core.hooksPath` 가 있으면 그 폴더에 `node .harness/tools/scan-shared.mjs || exit 1` 이 생긴다. 그러면 ① `.harness/` 가 없는 **다른 모든 레포의 커밋이 실패**하고 ② 받아 온 레포에 든 `.harness/tools/scan-shared.mjs` 가 커밋 때 실행된다
  - 고침: 해석한 경로가 `git rev-parse --git-common-dir` 안일 때만 쓴다. 밖이면 쓰지 않고 `foreign` 과 같이 「그 훅에 더할 한 줄」을 안내한다 — 전역 훅 폴더도, husky 처럼 추적되는 폴더도 마찬가지다
  - TDD: 임시 레포에 `git config core.hooksPath <레포 밖 임시 폴더>` 를 걸고 `applyMode('share')` → 그 폴더에 파일이 생기지 않고, 안내 상태로 끝나야 한다. ⛔ 전역 git 설정은 건드리지 않는다 — 테스트는 이미 쓰는 격리 방식으로
  - SETUP ③ 표에 반영한다: 「`core.hooksPath` 가 설정돼 있으면 쓰지 않고 한 줄을 안내한다」
- 끝나면 `npm test` · `node proof/run.mjs` 를 다시 돌린다

**4차 — 실전 적용 보고 (2026-10-07 · 기존 · 로컬 · Gradle+vitest 모노레포 · 설치는 통과):**
- [x] SETUP ⑤ 표에 vitest 행 — 리포터는 명령에 붙인다
- [x] SETUP ⑦ 커밋이 몇 개뿐인 기존 대상 — 커밋 소급을 건너뛰고 문서 원천으로
- [ ] `check-install` 을 실제 대상에 쓰면 ⛔ 5행이 오탐이다 — 합성 대상 전용 기대(커밋된 AGENTS.md · 「옛 반올림 규칙」 기준선 · 인수인계 용어 5개 · 「기준선 실패 1」)가 무조건 걸린다. 자리표시 정규식이 지도에 쓴 경로 패턴(`features/<기능>` 꼴)도 잡는다. 공통 · 모드 행과 합성 전용 행을 가른다
- [ ] 다른 마켓으로 켜진 플러그인의 정책 id 를 `false` 로 넣는 일이 `settings.local.json` 직접 편집이라 `policy-apply` 와 같이 Self-Modification 으로 막힌다 — 이번엔 사용자 `!` 줄에 node 한 줄을 붙였다. `policy-apply --off <id>` 같은 옵션이면 한 명령이 된다
- [ ] graph — 경로 · 식별자 안의 부분일치가 무관한 기록을 동점 1위로 올린다(파일명에 질의 어근이 들어간 경우). 채점 변경이라 그래프 운영 세션에 먼저 묻는다
- [ ] ⚠️ 로컬 전용 설치는 `git worktree` 에 따라가지 않는다 — 설치 경로가 미추적(`.git/info/exclude`)이라 새 worktree 에는 규칙 · 도구 · 그래프 · `settings.local.json` 이 없고, 새 경로는 신뢰 전이라 훅도 무시된다(그래프 운영 세션 실측: `--settings '<JSON 문자열>'` 로만 떴다). superpowers 의 worktree 흐름에서 하네스 없이 일하게 된다 — SETUP ⑨ 「새로 생기는 제약」에 적을지, worktree 용 복사 안내를 둘지 정한다
- [ ] graph — `--check` 「열린 작업 표식」이 끝난 기록의 조건문(「넓히면 … 고친다」 꼴)을 하다 만 일로 본다(경고 · exit 0). 같은 곳에 묻는다

**5차 — 훅 주입 절감 (2026-10-07 · 운영 데이터 재생 측정 · 그래프 운영 세션 검토 완료):**
근거 — 운영 저장소(살아있는 기록 146건)에 키트 훅을 겨눠 실제 사용자 프롬프트 401건을 재생했다. 전체 주입 2,408,711자 중 2단이 35%(35회 × 약 24,000자 — 기록 수에 따라 커진다)이고, 1단 카드 바이트의 61% 가 용어 줄이다. 대조 실험(2단 전체 색인 vs 침묵, n=8)은 판정 불가였다(정답 7 vs 6 · 도구 30 vs 31 · 입력 토큰 같음). 색인이 이긴 2건의 기록은 둘 다 점수가 있었다(2위 · 10위). 세 변경을 합치면 같은 재생에서 −62% 이고, 1차 실험 라벨과 색인이 이긴 기록은 그대로 남는다.
- [ ] A `graph-hook` — ① 2단 = 점수 상위 10건 ② 1단 카드 용어 선택을 채점 규칙 ③과 맞춤(한글 토큰은 키만) · 펼침 8줄 · 값 160자 ③ 2위 카드는 정본 · 사전이면 전문, 그 밖은 제목 + 함정. (import 가능한 `render` 는 쓸 곳이 보류돼 넣지 않았다 — `lib/` 의존이 새로 생기고 이식본 테스트가 깨진다)
- [ ] C 문서 — 이번 변경으로 낡는 것만: `graph-port.md`(2단 근거 · 카드 규칙 · 기각한 변형 · 측정 꼬리말 교훈) · `design.md` §5 · README §실측(「실제 프로젝트 값 없음」 정정)
- 보류: `graph-measure --hook`(훅 재생으로 주입 크기를 재는 모드) — 지금 쓸 대상이 없다. 훅을 켠 프로젝트가 비용을 재야 할 때 만든다
- 기각(같은 데이터): 확신 판정의 흔한 토큰 할인(실제 프롬프트에서 관련 기록 ~10건 손실) · 출현 빈도 자동 불용어(티켓 1단 510 → 375) · 불용어 누수 수정(자기검색 141 → 140 · 상위3 점유 32% → 35%)

처리하면 `SendMessage(to: "main")` 으로 짧게 보고한다.

## Global Constraints

- ⛔ `C:\Project\agent-harness` · `C:\Project\context-graph` 와 그것을 쓰는 프로젝트 등 기존 프로젝트를 수정하지 않는다. 사용자 전역 설정(`~/.claude/settings.json` 등)을 바꾸지 않는다
- ⛔ 실측이 사용자 전역 상태에 남긴 것은 되돌린다 — 프로젝트가 플러그인을 선언한 대상에서 세션을 열면 `~/.claude/plugins/installed_plugins.json` 에 프로젝트 범위 기록이 생긴다 → 그 대상에서 `claude plugin uninstall <id> --scope project --keep-data`
- 의존성 0 — Node 22+ 내장만. `package.json` 의 `dependencies` 는 비어 있다
- OS 무관 — 명령은 `exec` 의 플랫폼 기본 셸, 경로는 `node:path`, 줄바꿈은 `\r?\n`. 이 PC 는 Windows 이고 `tmpdir()` 가 8.3 단축 경로다
- 특정 프로젝트 이름 · 개인 식별자를 템플릿·코드·픽스처·커밋에 넣지 않는다 (픽스처는 `com.example.*`, `C:\work\app`)
- 모든 산출물 머리에 딱지 `설계안`
- 주석은 의도 한 줄. 자명한 설명·장황한 배경 금지. `console.log` 디버그 출력을 남기지 않는다 (CLI 출력은 예외)
- 커밋하지 않는다 — 이 환경에서 `git commit` 은 사용자 deny 다. `rm` 도 막혀 있다: 지울 것은 스크래치패드로 `mv`
- ⛔ 지우는 것은 **자기가 만든 정확한 경로만** — `%TEMP%`(= Git Bash `/tmp`)는 다른 세션과 공용이다. 패턴으로 훑어 지우지 않고, `fs.rmSync` 등으로 `rm` 차단을 우회하지 않는다(2026-10-07 서브에이전트가 정규식 정리로 남의 파일 3개를 영구 삭제했다)
- Bash 는 매 호출마다 작업 폴더가 초기화된다 — `cd /c/Project/harness-kit && …` 처럼 한 명령 안에서 옮긴다
- ⭐ **graph 는 다른 세션이 실제 프로젝트에서 운영 중이다** (context-graph 를 48세션 · 기록 222건). graph 모듈(Task 4·7·9·10)에서 동작·규칙 판단이 애매하면 `SendMessage(to: "<운영 세션>")` 로 묻는다. ⚠️ 답장은 부모 세션(harness)으로 가고 너에게 직접 오지 않는다 — 질문을 보내 두고 진행할 수 있는 다른 일을 하라. harness 가 답을 전달한다. ⛔ 운영 세션에게 파일 수정이나 막힌 작업을 시키지 않는다 — 묻기만 한다
- ⛔ **사용량 문턱** — 태스크를 하나 끝낼 때마다 부모 세션이 준 사용량 측정 스크립트(`usage.mjs <문턱>`)를 `0.70` 으로 돌린다. exit 3(주간 사용률 ≥ 0.70)이면 **그 자리에서 멈추고** §인계 메모를 남긴 뒤 보고한다

## 파일 구조 (이 레포)

| 경로 | 출처 · 책임 |
|---|---|
| `lib/config.mjs` · `lib/evidence.mjs` · `lib/mdtable.mjs` | agent-harness 그대로 + 기준선·`output-match` |
| `tools/verify.mjs` · `state-check` · `decision-check` · `lesson-append` · `lesson-promote` · `policy-apply` | agent-harness 그대로 + 기준선 · `--local` · `--with` |
| `tools/graph-{find,append,alias,hook,view,measure}.mjs` | context-graph 그대로 + 저장 경로만 |
| `tools/detect.mjs` · `tools/install-mode.mjs` · `tools/scan-shared.mjs` · `templates/scan.json` | ⭐ 신규 |
| `policy/settings.json` · `policy/graph-hook.json` | agent-harness 정책 + graph 도구 승인 · 훅 |
| `templates/rules/{harness,graph}.md` · `templates/skills/final-gate/SKILL.md` | 설계서 §2·§3·§5 |
| `templates/map/{AGENTS.md,CLAUDE.md,CLAUDE.local.md}` | 지도 골격 · 다리 |
| `templates/harness.json` · `templates/state/*.md` | agent-harness 그대로 (+ 프로필·모드 키) |
| `SETUP.md` · `README.md` | 설계서 §6 · 소개와 실측 |
| `proof/run.mjs` · `proof/setup-e2e.mjs` · `proof/check-install.mjs` | 설계서 §9 |
| `test/*.test.mjs` · `test/fixtures/` · `test/scene.mjs` | |

---

### Task 0: 레포 준비
- [x] `git init` (브랜치 `main`). `.gitignore`: `node_modules/` · `test-results/` · `graph/` (이 레포의 그래프 데이터)
- [x] `.git/info/exclude` 에 `CLAUDE.local.md` · `.harness/` · `.claude/settings.local.json` — 이 레포 개발용은 로컬 전용이다 (`CLAUDE.local.md` 는 이미 있다)
- [x] `package.json` — agent-harness 의 것을 이름만 바꿔 쓴다 (`pretest` 로 `test-results/` 생성, `test` 는 `"test/*.test.mjs"` glob + junit 리포터)

**완료 기준:** `npm test` 가 테스트 0개로 돌고, `git status` 에 `CLAUDE.local.md` 가 안 보인다.

### Task 1: evidence 모듈 이식
- [x] agent-harness 의 `lib/` · `tools/` · `policy/` · `templates/` · `test/` 를 복사한다 (`proof/` · `SETUP.md` · `README.md` · `docs/` 제외)
- [x] `npm test`

**완료 기준:** agent-harness 와 같은 79개 통과. 이후 태스크는 이 위에서 바꾼다.

### Task 2: verify — 알려진 실패 기준선 · `output-match`

명세 (설계서 §4):
- `judgeJunitXml(contents, { known })` — `known` 은 `Set<"classname::name">`. 반환에 `failedKeys`(기준선 밖) · `knownFailed`(기준선 안 실패 수) · `fixed`(기준선에 있는데 이번에 통과한 키) 를 더한다. `ok` = 실행된 testcase ≥ 1 && 기준선 밖 실패 0
- 이유 문자열: `테스트 20 · 실패 0 · 기준선 실패 14` / `테스트 20 · 실패 2 (기준선 밖) · 기준선 실패 14` / 통과한 기준선 항목이 있으면 끝에 ` · 기준선에서 통과 3 — 기준선을 줄인다 (verify --baseline)`
- 기준선 파일: `.harness/baseline/<id>.txt` (`<id>` 의 `\/:*?"<>|` 는 `_`), `#` 주석·빈 줄 무시. 파일이 없으면 빈 기준선
- `junit-xml` 은 명령이 exit 0 이 아니어도 **실패가 전부 기준선 안이고 실행된 testcase ≥ 1 이면** 통과
- `verify --baseline` — 각 `junit-xml` 검사를 돌려 지금의 실패 키를 기준선 파일에 쓴다. 실행된 testcase 가 0 이면 쓰지 않고 이유를 낸다. exit 0
- `output-match` — `expect` 필수(로더가 거부), 명령 exit 0 이고 stdout 이 `new RegExp(expect, 'm')` 에 맞으면 통과. 이유: `출력이 기대와 맞는다` / `출력이 /<expect>/ 와 맞지 않는다`

테스트 (최소): 기준선 안 실패만 → 통과 · 기준선 밖 실패 → 실패 · 통과한 기준선 항목 → 통과 + 안내 · exit 1 이어도 전부 기준선 안 → 통과 · `--baseline` 이 키를 쓰고 다음 실행이 통과 · 테스트 0개면 `--baseline` 이 쓰지 않음 · `output-match` 맞음/안 맞음/명령 실패 · 로더가 `expect` 없는 `output-match` 를 거부.

**완료 기준:** 위 테스트 + 기존 79개 통과.

### Task 3: policy-apply — `--local` · `--with`
- `--local` → `.claude/settings.local.json` 에 병합 (로컬 전용 모드)
- `--with <이름>` → `policy/<이름>.json` 도 병합 (여러 번 가능). `mergeSettings` 가 `hooks` 를 병합한다: 이벤트별 배열에, 같은 `command` 를 가진 훅이 없을 때만 그룹을 더한다 — 멱등, 기존 훅 보존
- `policy/graph-hook.json` — context-graph `SETUP.md §3-e` 의 형식, 명령만 `node "$CLAUDE_PROJECT_DIR/.harness/tools/graph-hook.mjs"`, `timeout` 30
- `policy/settings.json` allow 에 graph 의 **읽기 전용** 도구를 더한다: `Bash(node .harness/tools/graph-find.mjs *)` · `Bash(node .harness/tools/graph-find.mjs)`. ⛔ 쓰기 도구(append · alias)는 승인 목록에 두지 않는다
- 보안 회귀 테스트를 고친다: allow 의 모든 `Bash(node …)` 항목이 `^Bash\(node \.harness\/tools\/[\w-]+\.mjs( \*)?\)$` 에 맞아야 한다 (디렉터리 와일드카드·`.mjs*` 금지) — 기존의 find·sort·git diff/log/show 금지는 그대로

**완료 기준:** `--local` · `--with` · hooks 멱등 · 보안 회귀 테스트 통과.

### Task 4: graph 모듈 이식
1. [x] **특성 테스트를 먼저** — context-graph 의 도구를 이 레포 `tools/` 에 복사만 한 상태에서, 원본 동작을 잡는 테스트를 쓴다. 저장 경로를 바꾸기 전이라 테스트는 `load(store)` · `appendRecord(rec, { store })` 처럼 경로를 인자로 받는 내보내기를 쓴다. 최소:
   - append → find 왕복, 정확일치 우선 정렬, `supersedes` 된 기록은 기본 조회에서 빠지고 `--all` 에만
   - alias 가 같은 JSONL 에 쌓이고 용어로 찾힌다
   - `check` — 경로 무결성(없는 파일) · 대체 사슬 · 용어 선점 · `⏸`
   - 훅 — 최고점수 ≤ 2 면 **침묵**, 1단 출력에 탈출구 문장, 상위 2건 상한, 1위가 `정본: ` 이면 1건만, `⏸` 기록은 랭킹과 무관하게 붙는다, 대체된 기록·사무 기록 제외
2. [x] 저장 경로를 바꾼다: 모든 graph 도구가 `HARNESS_GRAPH_STORE` 가 있으면 그것을, 없으면 `fileURLToPath(new URL('../graph/requests.jsonl', import.meta.url))` 를 쓴다 (대상에서는 `.harness/graph/requests.jsonl`). cwd 에 의존하지 않는다
3. [x] 같은 특성 테스트가 통과한다. ⛔ 채점·토크나이저·문턱·출력 형식은 바꾸지 않는다
4. [x] `db-guard` · `sql-template-check` · `commit-index` · `spec-toc` 는 가져오지 않는다

**완료 기준:** 특성 테스트가 이식 전후 모두 통과. graph 도구 어디에도 `tools/graph/` 하드코딩이 없다.

### Task 5: `tools/detect.mjs`

`node tools/detect.mjs <대상> [--json]` — 설계서 §6 의 사실과 제안값. ⛔ 대상을 바꾸지 않는다 (읽기만).

- 사실: git 저장소인가 · 미커밋 변경 · 커밋 수 · 추적 파일 수 · 추적 소스 파일 수(확장자 목록으로) · 지시 파일 각각의 존재·추적 여부·`@AGENTS.md` import 여부 · 다른 도구 규칙 · 테스트 단서 · 설치 경로(`.claude/rules/harness.md` · `.harness/harness.json` · `AGENTS.md` · `CLAUDE.md`)가 `git check-ignore` 에 걸리는가 · 기존 `.harness/` · 기존 context-graph(`tools/graph/requests.jsonl`) · Node 버전
- 제안: `profile` = 커밋 < 20 이고 소스 < 50 이면 `new`, 아니면 `existing` (이유를 함께). `mode` = 둘 다 `local` (공유는 사용자가 명시적으로 고른다 — 지시함). `stop` 사유(저장소 아님 · 미커밋 변경 · 이미 설치됨)
- 테스트는 합성 저장소로. ⛔ 이 PC 의 전역 gitignore 에 흔들리지 않게 — 자식 git 에 `GIT_CONFIG_GLOBAL` 을 임시 파일로 주어 「전역 무시 있음/없음」을 둘 다 만든다

**완료 기준:** 신규·기존·이미 설치됨·저장소 아님·전역 무시 있음/없음 테스트 통과.

### Task 6: `tools/install-mode.mjs`

`node .harness/tools/install-mode.mjs share|local [대상]` — 설계서 §6 의 모드 표. 멱등(표식 줄로 블록을 한 번만).

- `share`: 설치 경로 중 지금 무시되는 것만 대상 `.gitignore` 에 부정 규칙으로, 그 뒤 `.claude/settings.local.json` 을 다시 무시. 끝에 `git check-ignore` 로 모든 설치 경로가 추적 가능한지 확인해 출력, 아니면 exit 1
- `local`: 설치 경로를 `.git/info/exclude` 에. 끝에 모두 무시되는지 확인, 아니면 exit 1
- 테스트는 Task 5 처럼 `GIT_CONFIG_GLOBAL` 로 모의 전역 무시를 만든다 — 공유가 그것을 이기는가 · 로컬이 숨기는가 · 두 번 돌려도 같은가

**완료 기준:** 위 테스트 통과.

### Task 7: 템플릿
- [x] `templates/rules/harness.md` — 설계서 §2(장부 분담·승격 방향) · §3(계획 표·관문·착수 전 승인) · §4(완료 증거 표) · 플러그인·ponytail off. 자리표시 `<decisions>` · `<lessons>`. 짧게 — 매 세션 로드된다
- [x] `templates/rules/graph.md` — context-graph `templates/AGENTS.snippet.md` 에서: 탐색 순서(그래프 먼저 → 답이 아니면 코드), 학습 루프(사용자의 말이 0건이면 알아낸 뒤 alias), 작업 끝 기록(→ final-gate 의 기록 단계로), `⏸`, 무효화(`supersedes`), 주기 검사, 훅을 켜는 조건, ⛔ 개인 식별자 금지. ⛔ 빼는 것: PostgreSQL DB 코멘트 절 · 「작업 흐름 — writing-plans 를 쓰지 않는다」 절(흐름은 harness.md 가 정한다) · 운영 프로젝트 사례. 120줄 안
- [x] `templates/skills/final-gate/SKILL.md` — 설계서 §3 의 관문 4단계. `description` 은 「작업을 끝냈다고 보고하기 직전에 매번」
- [x] `templates/map/AGENTS.md` (지도 골격: 목적 · 빌드·테스트 명령 · 구조 · 용어 — `<…>`), `templates/map/CLAUDE.md` (`@AGENTS.md` 한 줄 + 한 줄 설명), `templates/map/CLAUDE.local.md` (로컬 전용 지도 골격)
- [x] `templates/harness.json` 에 `profile` · `mode` 키, 장부 경로는 모드에 따라 SETUP 이 채운다

**완료 기준:** 규칙·스킬이 가리키는 도구가 실재한다(템플릿 참조 테스트가 graph 도구까지 덮는다).

### Task 8: SETUP.md · README.md
- [x] `SETUP.md` — Claude 에게 주는 지시서. 순서: ① 안전 확인 + `detect` → 프로필·모드 제안을 사용자에게 **한 번에** 확인 (비대화형이면 제안값으로 진행하고 보고에 남긴다) ② 복사 ③ `install-mode` ④ 지시 파일(설계서 §6 표) ⑤ `harness.json`(검사 명령 표 — agent-harness SETUP 의 표 + `output-match` 예시) ⑥ `policy-apply [--local]` + 플러그인 중복 처리(agent-harness SETUP §5 그대로) ⑦ 프로필별 — 기존: 이미 있는 것 쓰기 표 · 소급 원천 순서 · 기준선(사용자 확인 뒤 `verify --baseline`) · 그래프 20건이면 `--check` 뒤 `policy-apply --with graph-hook`; 신규: 지도 골격 채우기 · 스펙 용어 시드 · 「첫 테스트 전 verify 실패는 정상」; 기존 context-graph 감지 시 그래프 모듈 생략 ⑧ 검증(도구 실행 · `git check-ignore` 가 모드대로인가 · 새 세션 규칙 로드 양성 2/음성 1 · ponytail off · 플러그인 id 하나씩 · git diff) ⑨ 보고 3단
- [x] `README.md` — 무엇인가 · 두 모듈 · 신규/기존 · 정직한 값 · 도입하지 말아야 할 때 · 실측(Task 10 이 채운다) · 출처 두 레포와의 관계(⛔ 원본은 그대로 둔다)

**완료 기준:** 템플릿 참조 테스트(SETUP 이 복사하라는 것·가리키는 도구가 실재)가 통과.

### Task 9: 결정론·새 세션 실측 `proof/run.mjs`
- [x] agent-harness `proof/run.mjs` 를 옮겨 설치 배치를 이 레포에 맞춘다 (`.harness/` + rules 2개)
- [x] 더한다: 기준선(안 → 통과 · 밖 → 실패 · `npm test` 는 exit 1), `output-match`, 설정 병합(`--local` · `--with graph-hook` 멱등), 그래프(append→find · 훅 침묵 · 탈출구 · `⏸`), 설치 모드(모의 전역 무시를 공유가 이김 · 로컬이 숨김), 판별(신규·기존 합성 저장소의 제안값)
- [x] `--claude`: 규칙 로드에 `graph.md` 양성 1개 추가, ponytail off, 플러그인 기록 정리 행

**완료 기준:** `node proof/run.mjs` exit 0, `node proof/run.mjs --claude` exit 0. 예상과 다른 행이 나오면 하네스가 틀렸는지 실험이 틀렸는지 먼저 가른다.

### Task 10: ⭐ SETUP 종단 실측
- [x] `proof/setup-e2e.mjs` — 긴 경로 임시 폴더(`realpathSync.native(tmpdir())`)에 합성 대상 둘을 만든다:
  - **신규**: 커밋 1개 · `README.md`(현업 용어 2~3개가 든 소개) · `package.json`(node test + junit) · 테스트 0개 · `docs/spec.md`(브레인스토밍 스펙 — 용어 → 계획 식별자 3개)
  - **기존**: 커밋 25개 이상(그중 `fix:` 3개는 본문에 근본 원인) · `src/` 모듈 · `test/` 에 통과 6 + **원래 있던 실패 1** · `AGENTS.md`(빌드·테스트 명령 · 금지 규칙 2 · 용어 3 — 전역 무시 때문에 `git add -f`) · `docs/handover.md`(용어 사전 5) · `CLAUDE.md` 없음
- [x] 각 대상에서 새 세션이 SETUP 을 따른다:
  `claude -p --model sonnet --max-turns 150 --allowedTools "Read Write Edit Glob Grep Bash(git *) Bash(node *) Bash(npm *) Bash(mkdir *) Bash(cp *) Bash(ls *) Bash(cat *) Bash(grep *) Bash(claude --version) Bash(claude plugin list *) Bash(claude -p *)" --disallowedTools "Bash(claude plugin install *) Bash(claude plugin marketplace *) Bash(git push *) Bash(rm *)" "<harness-kit>/SETUP.md 를 읽고 이 프로젝트에 적용해줘. 비대화형 실행이다 — 사용자 확인 자리는 SETUP 이 정한 제안값으로 진행하고, 「원래 있던 실패인가」는 「예」로 보고 진행하고, 모두 보고의 「사용자가 결정해야 하는 것」에 남겨라."` — 최종 보고 텍스트를 저장한다. ⚠️ (구현 중 실측) 이 순서 그대로면 세션이 즉시 죽는다 — `--allowedTools` · `--disallowedTools` 가 가변 인자라 맨 뒤 프롬프트를 거부 규칙으로 삼킨다. 프롬프트를 `-p` 바로 뒤에 둔다 (`proof/setup-e2e.mjs`)
- [x] `proof/check-install.mjs <대상> <new|existing> <local|share>` — 프로필·모드별 기대와 대조해 표를 낸다 (e2e 는 신규=공유 명시 · 기존=로컬). 최소:
  - 공통: `.harness/` 도구·정책 · rules 2개 · final-gate 스킬 · `harness.json` 에 검사 1개 이상 · 규칙 자리표시가 남지 않음 · `policy` 반영(ponytail off · 플러그인 선언) · 플러그인 id 하나씩
  - 신규(공유 명시): 설치 경로가 추적 가능 · pre-commit 이 scan-shared 를 부르고 scan-shared exit 0 · `AGENTS.md` + `CLAUDE.md`(`@AGENTS.md`) 생성 · 장부 `docs/harness/` · lessons 소급 없음 · 그래프 시드(스펙 용어, 「설계 용어」 표기) · 훅 없음 · verify 가 「실행된 테스트가 0개」로 실패
  - 기존: 모드 로컬(설치 경로가 무시됨, 설정은 `settings.local.json`) · `AGENTS.md` 내용 그대로(해시) · `CLAUDE.local.md` 에 `@AGENTS.md` · 장부 `.harness/state/` · 기준선에 원래 실패 1 · verify exit 0 · lessons 소급 ≥ 2(근본 원인 있음) · 그래프 ≥ 3 주제 기록 · 인수인계 용어 ≥ 4/5 · terms 채움 (⚠️ 구현 중 고침 — 「≥ 5」는 용어당 alias 를 전제했다. design §6 의 기록 단위 「같은 질문에서 함께 필요한가」와 「커밋 유래는 기여가 낮다」 아래에서는 건수가 아니라 덮는 용어로 잰다) · 훅 없음(20건 미만)
- [x] 설치된 각 대상에서 새 세션 규칙 로드(양성: verify 명령 · 그래프 조회 명령 / 음성 1)
- [x] 정리 — 각 대상의 프로젝트 범위 플러그인 기록을 되돌리고, 남은 것(`~/.claude/projects/` 의 빈 폴더 등)을 보고에 적는다
- [x] 결과가 기대와 다르면: SETUP 이 모호한가(→ SETUP 을 고친다) 기대가 틀렸나(→ 근거와 함께 기대를 고친다). ⛔ 재실행은 대상마다 2회까지 — 비용이 크다

**완료 기준:** 두 대상의 `check-install` 표와 규칙 로드 결과가 README §실측에 들어간다. 다르게 나온 항목은 고쳤거나 이유가 적혀 있다.

### Task 11: 마무리
- [x] `npm test` · `node proof/run.mjs` 를 다시 돌린다
- [x] 이 레포를 자기 verify 로 판정한다 — 로컬 전용 `.harness/harness.json` 에 `npm test` 를 `junit-xml` 로
- [x] 계획서 체크박스와 머리의 「실행 상태」를 채운다
- [x] 보고 — 태스크별 결과 · 실측 표 · 설계와 다르게 간 곳과 이유 · 남은 위험 · 작업 파일 목록
- ⛔ `/ponytail-review` · `/security-review` · 커밋은 하지 않는다 — 판단하는 세션이 한다

## 인계 메모 (멈출 때)
사용량 문턱이나 막힘으로 멈추면 여기에: 끝난 태스크 · 진행 중이던 태스크와 그 상태 · 다음에 할 첫 행동 · 깨진 것.

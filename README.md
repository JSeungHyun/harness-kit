# harness-kit

Claude Code 가 「테스트 통과, 끝났습니다」라고 보고해도 실행된 테스트가 0개였거나 직전 실행의 결과를 읽은 것일 수 있다.
이 키트는 완료 판정을 모델이 아니라 도구에 맡긴다 — **`verify` 가 이번 실행이 쓴 결과 XML 의 testcase 를 직접 센다.**
그리고 사용자의 말과 코드의 이름 사이 다리(그래프)를 프로젝트에 남겨 같은 조사를 두 번 하지 않게 한다.

> 상태: **설계안** — 실제 프로젝트 여러 곳(두 PC)에 얹어 쓰고 있지만, 하네스 없을 때와 대조해 효과를 잰 것은 graph 모듈의 운영 데이터뿐이다. [§실측](#실측)

어느 프로젝트에나 얹는 템플릿이다. **흐름은 superpowers 가, 과설계 점검은 키트가 가진 ponytail 리뷰 지시문(`/ponytail-review`)** 이 맡고,
둘이 못 하는 것을 두 모듈이 맡는다. 대상이 **신규 구축인지 기존 이식인지 판별해** 그에 맞게 얹는다.

## 설치

대상 프로젝트에서 Claude Code 에게:

```
<이 레포 경로>/SETUP.md 를 읽고 이 프로젝트에 적용해줘
```

Node 22+ · Claude Code 2.1.277+ · git 저장소. 의존성 0.
플러그인은 키트 마켓(`.claude-plugin/marketplace.json`)이 실측한 커밋으로 고정한다 — superpowers 7.0.2. 공식 마켓은 자동 업데이트가 켜져 있고, 출처에 sha 가 없으면 설치한 날의 최신이 들어오기 때문이다. **플러그인은 PC(사용자 범위)에 두고 프로젝트에는 선언하지 않는다** — 켜고 끄기 · 판 올리기가 PC 에서 한 번으로 끝난다. ponytail 은 플러그인이 아니다 — 리뷰 지시문 한 장(MIT 원본에서 앞머리 한 줄만 다름)을 `templates/user-skills/ponytail-review` 에 두고 `plugin-plan --review-skill` 이 사용자 스킬로 깐다(모드 없음 · 스킬 목록에 안 실림). 규칙이 기대는 superpowers 동작은 brainstorming 의 종료 조건이다.

**구현 사이클 `/exec-cycle`(26차)** 은 키트 기본 스킬이다 — 사용자가 부를 때만 쓰이고, 설계 → 계획 → 구현 → verify → `/ponytail-review` → 보고를 종료 훅이 강제한다. 검증만 하는 `/exec-review`(verify → 과설계 리뷰 → 보고 · 수정이 없어도 같은 훅이 증거를 요구)도 같이 깔린다. superpowers · ponytail 스킬은 자동 주입이 아니라 `tools/cycle-skill.mjs` 가 낸 경로의 파일로 읽는다 — 그래서 superpowers 는 PC 에 설치하되 꺼 두는 것이 기본이다(켜 두면 세션마다 시작 글이 붙는다 → 이식 검사 ⑥ · `--all` 「사이클」 칸이 ⚠️). 그래프 무결성 검사는 모든 설치가 같고, 이식 때 verify 에 넣을 검사는 프로젝트 성격(코드 영역 — Java · JS/TS · Python)대로 고른다: 감지한 영역마다 그 소스를 덮는 `covers` 검사가 없으면 갱신 · 이식 검사가 ⛔ 와 처방을 낸다.

### 플러그인을 올릴 때 — 이 레포에서

1. `node tools/plugin-plan.mjs --upstream` — 고정 커밋과 각 플러그인 저장소의 최신 커밋을 비교하고, 새 버전과 바뀐 것 링크를 낸다
2. 바뀐 것을 읽고 판단한다 — 키트가 기대는 것(brainstorming 종료 조건 · 규칙이 부르는 `/code-review` 스킬 이름)이 그대로인가, 이득이 있나. 사전 시험은 `--plugin-dir` 로 새 판을 싣고 `--settings` 로 설치본을 끈 세션
3. 올리면 `marketplace.json` 의 `sha` · `version` 을 바꾸고 `node proof/run.mjs --claude` → 커밋 · push
4. 각 PC 에서 `git pull` 뒤 `node tools/plugin-plan.mjs` 가 `marketplace update` · `plugin update … --scope user` 명령을 낸다(사용자 스킬 `ponytail-review` 가 키트 판과 다르면 키트 파일을 까는 `--review-skill` 도) — 사용자 범위라 PC 마다 한 번이면 그 PC 의 모든 프로젝트에 퍼진다

### 이미 얹은 프로젝트를 새 버전으로 — 다른 PC 포함

그 PC 에서 키트를 받고(`git -C <이 레포 경로> pull`), 그 프로젝트의 Claude Code 에게:

```
<이 레포 경로>/SETUP.md 의 「갱신」을 따라 이 프로젝트를 갱신해줘
```

- `tools/plugin-plan.mjs` 가 그 PC 의 플러그인을 읽어 키트 마켓에 맞출 명령을 낸다. 세션이 사용자에게 묻고 실행한다 — PC 마다 한 번이고, 다음 프로젝트부터는 「옮길 것 없다」
- `tools/upgrade.mjs` 가 도구 · 정책 · 손대지 않은 규칙을 올리고, 설정에 넣을 명령(권한 · 그래프 훅 — 옛 플러그인 선언 · 키트에서 지운 도구의 훅 등록은 걷는다)을 낸다. 프로젝트가 키트 규칙을 고쳤으면 ⛔ 로 멈추고, `--own-rules` 가 고친 줄을 `.claude/rules/project-<이름>.md` 로 옮긴 뒤 키트 판을 다시 깐다 — 키트 파일은 키트 판 그대로 둔다
- 끝에 `tools/install-check.mjs` 가 키트와 같은지 ①~⑨ 표로 판정한다 — 그래프 데이터 · 검사 명령 같은 프로젝트 고유 내용만 다를 수 있고, 하나라도 ⛔ 면 exit 1 이라 「이식 성공」이 아니다
- 키트가 플러그인 구성을 바꿨으면 그 PC 에서 먼저 SETUP 「PC 맞추기」를 한 번 한다 — 그 PC 의 Claude Code 에게 `<이 레포 경로>/SETUP.md 의 「PC 맞추기」를 따라 이 PC 를 맞춰줘`

## 두 모듈

| 모듈 | 막는 실패 | 도구 (`.harness/tools/`) |
|---|---|---|
| **evidence** | 완료를 거짓 보고한다 | `verify` · `policy-apply` |
| **graph** | 같은 것을 두 번 조사한다 · 사용자의 말과 코드의 이름 사이 다리가 없다 | `graph-find` · `graph-append` · `graph-alias` · `graph-hook` · `graph-measure` |
| 설치 | 설치 · 갱신이 키트와 달라진 채 「끝」으로 보고된다 | `detect` · `install-mode` · `scan-shared` · `plugin-plan` · `upgrade` · `install-check` |

자동 로드되는 층은 `.claude/rules/harness.md` · `.claude/rules/graph.md` 둘뿐이다(22차에 두 파일을 측정한 묶음으로 덜어내고 관문 훅을 걷었다 — 근거 `docs/proof.md` 「23차」). 관문 스킬(`final-gate`)은 25차에 걷었다 — 완료 증거는 규칙의 verify · `/code-review` 한 줄이다.

## 신규 구축 / 기존 이식 · 설치 모드

| | 신규 (커밋 < 20 · 소스 < 50) | 기존 |
|---|---|---|
| 지시 파일 | 없으면 지도 골격을 만든다 — 공유면 `AGENTS.md` + `CLAUDE.md`(`@AGENTS.md`), 로컬이면 `CLAUDE.local.md` | ⛔ 내용을 고치지 않는다 — 필요하면 import 한 줄 |
| 소급 | 없음 — 스펙 용어를 「설계 용어」로 시드 | 이슈 > 인수인계 문서 > 담당자 > 커밋 이력 순으로 그래프 3~5 |
| 테스트 | junit 검사가 있으면 첫 테스트 전 verify 실패(테스트 0개)가 정상 · 러너 전이면 타입 검사 같은 exit-code 검사로 시작 | 원래 있던 실패는 사용자 확인 뒤 기준선 (`verify --baseline`) |

설치 모드는 **둘 다 로컬 전용이 기본**이다(`.git/info/exclude` · `settings.local.json`). **팀 공유는 사용자가 명시적으로 고른다** — 기록에는 사번 · 실명 · 이슈 번호 · 내부 URL 이 쌓이기 때문이다. 공유를 고르면 `.gitignore` 부정 규칙으로 이 PC 의 전역 무시(`.claude/` · `AGENTS.md` · `CLAUDE.md`)를 이기고, `pre-commit` 이 커밋 전마다 `scan-shared` 로 민감 정보 패턴(`.harness/scan.json`)을 검사한다.

## 정직한 값 — 이미 되는 것은 넣지 않는다

| 차원 | 이미 되나 | 여기서 |
|---|---|---|
| 계획 · TDD · 검증 규율 | ✅ superpowers | 안 만든다 |
| 과설계 리뷰 | ✅ ponytail 지시문(키트 파일) | `/exec-cycle` · `/exec-review` 가 파일로 읽는다 |
| 파일 목록 · 동반변경 · 언제 바뀌었나 | ✅ git | 그래프의 값이 아니다 |
| **완료의 결정론적 증거** | ❌ 종료코드·러너 요약은 테스트 0개를 통과시킨다 | ⭐ `verify` — 이번 실행이 쓴 XML 의 testcase 를 센다 |
| **원래 있던 실패와 새 실패의 구분** | ❌ 러너는 늘 exit 1 | ⭐ 기준선 — 기준선 밖 실패만 실패 |
| **검사가 돌리지 않는 코드** | ❌ verify 녹색은 검사 목록만 증명한다(Java 를 바꿨는데 검사는 `npm test`) | ⭐ 검사의 `covers` — 덮이지 않은 코드 변경은 규칙이 `/code-review` 를 부르게 한다 |
| **현업 용어 → 코드 식별자 · 함정 한 줄** | ❌ 어디에도 없다 | ⭐ 그래프 `terms` · `note` |
| **작업 끝 기록을 미루다 빠뜨림** | ❌ 「기록해라」만 있으면 「커밋 뒤에」로 미룬다(원천 재생: 같은 지식을 4턴 내리) | ⭐ 규칙(graph.md 3절)이 시킨다 — 코드를 바꾼 턴은 그래프 기록(뒤에 `--check`) 또는 `그래프: 기록 안 함 — <이유>` 한 줄 · 되돌리던 관문 훅은 22차에 걷었다 |

## ⛔ 도입하지 말아야 할 때

| 모듈 | 이럴 땐 빼거나 하지 않는다 |
|---|---|
| 전체 | superpowers 를 쓰지 않기로 한 팀 · 수명이 몇 주인 프로젝트 |
| evidence | 결정론적 검사를 하나도 만들 수 없다 — 단, 운영 저장소도 `output-match` · `exit-code` 로 시작할 수 있다 |
| graph | 현업 용어 = 코드 식별자(영어 프로젝트 다수) · 혼자 한 도메인만 · 작업 끝 기록 규율을 지킬 수 없다(낡은 그래프는 없느니만 못하다) |

여럿이 그래프를 같이 쓰면 공유 모드가 먼저다(기록이 `merge=union` 으로 합쳐진다). 로컬 전용을 유지하면 `graph-find --gaps` 로 내 그래프에 없는 동료 커밋을 본다.

## 실측

상세는 [docs/proof.md](docs/proof.md) — 합성 대상 세 층(결정론 · 새 세션 · SETUP 종단), 운영 데이터 한 층, 실제 설치의 관문 사용. 요지:

| 층 | 무엇이 나왔나 | 한계 |
|---|---|---|
| 결정론 (`node proof/run.mjs`) | 하네스 없이는 통과로 보이는 거짓 완료(테스트 0개 · 직전 XML · 기준선 밖 실패)를 verify 가 모두 막는다 | 합성 저장소 |
| graph 운영 데이터 (이슈 8건) | 그래프 · 훅이 있으면 도구 호출 −91% · 정답 8/8 vs 4/8 | 표본 8건 · 라벨을 기록에서 뽑았다 |
| 실제 설치 3곳 (6세션) | 코드를 바꾼 턴 7개 중 5개에 verify 가 돌았다 — 나머지 2개는 검사 밖 시안 파일. final-gate 스킬은 코드 변경 뒤 0/7 | 표본 작음 · 대조군 없음 |
| 실제 설치 2곳 — 관문 훅 뒤 | 파일을 바꾼 작업 12개 중 10개가 final-gate 를 거쳤다(스스로 7 · 훅이 되돌린 뒤 3) — 되돌림 문구를 고친 뒤 8/8 · 헛울림 1 | 한 PC · 한 사용자 · 원인 분리 안 함 · 이 훅은 22차에 걷었다(`docs/proof.md` 「23차」) |
| 실제 설치 4곳 사본 — 이식 동일성 | 「갱신 끝」으로 보고됐던 설치가 이식 검사 ⛔ 7~8/9 → 갱신 뒤 1~3/9. 남은 것은 `covers`(사람이 정함) · PC 리뷰 스킬 기록(사용자 승인) · 사본 탓 1 | 사본 · 한 PC |
| 발표 측정 (그래프 켬 · 끔 A/B · 틀은 `node proof/ab.mjs`) | 그래프에 있는 질문 20건: 도구 호출 0.57 · 시간 0.75 · 적중 27 대 29 — 「효과 있음」 기준 미달(정확도는 같고 더 빨리) · 없는 질문 19건: 손해 없음 | 그 설치의 규칙 판 · 표본 작음 |

## 출처

두 레포를 읽어 새로 만들었다 — ⛔ 원본은 그대로 둔다. 옮긴 것은 도구·템플릿·규칙이고, 프로젝트의 기록(그래프 데이터)은 그 프로젝트에 남는다.

| 출처 | 가져온 것 |
|---|---|
| `agent-harness` | evidence 모듈 — 완료 증거 · 가정 · 교훈 · 설정 병합 + 기준선 · `output-match` · `--local` · `--with` |
| `context-graph` | graph 모듈 — 채점 · 토크나이저 · 문턱 · 출력을 그대로, 저장 경로만 `.harness/graph/` 로. DB 가드 · SQL 템플릿 검사 · 커밋 색인 · 절 목차는 범용 값이 없어 뺐다. 13차(2026-11-10)부터 그래프 정본은 키트이고 context-graph 는 보관 — 따라가지 않는다(`docs/graph-port.md`) |

## 개발

```bash
npm test                    # 결과 XML 은 test-results/
node proof/run.mjs          # 결정론 실측 (LLM 없음)
node proof/run.mjs --claude # + 새 세션 실측 (토큰을 쓴다)
npm run bench -- --run      # 상시 측정 묶음 — 얼린 입력을 지금 도구로 돌려 기준 숫자와 견준다 (LLM 없음 · 처음은 --snapshot)
node proof/ab.mjs prereg|run|agg <계획.json>   # 그래프 있이 · 없이 A/B 틀 (run 은 토큰을 쓴다 — 사람 승인 뒤)
```

설계: `docs/design.md` · 계획: `docs/plan.md` · 구조(큰 그림 · 훅 · 검증 · 구성 · 그래프 저장과 탐색): `docs/structure.md`

# harness-kit

Claude Code 가 「테스트 통과, 끝났습니다」라고 보고해도 실행된 테스트가 0개였거나 직전 실행의 결과를 읽은 것일 수 있다.
이 키트는 완료 판정을 모델이 아니라 도구에 맡긴다 — **`verify` 가 이번 실행이 쓴 결과 XML 의 testcase 를 직접 센다.**
그리고 사용자의 말과 코드의 이름 사이 다리(그래프)를 프로젝트에 남겨 같은 조사를 두 번 하지 않게 한다.

> 상태: **설계안** — 실제 프로젝트 여러 곳(두 PC)에 얹어 쓰고 있지만, 하네스 없을 때와 대조해 효과를 잰 것은 graph 모듈의 운영 데이터뿐이다. [§실측](#실측)

어느 프로젝트에나 얹는 템플릿이다. **흐름은 superpowers, 과설계 점검은 ponytail** 이 맡고,
둘이 못 하는 것을 두 모듈이 맡는다. 대상이 **신규 구축인지 기존 이식인지 판별해** 그에 맞게 얹는다.

## 설치

대상 프로젝트에서 Claude Code 에게:

```
<이 레포 경로>/SETUP.md 를 읽고 이 프로젝트에 적용해줘
```

Node 22+ · Claude Code 2.1.277+ · git 저장소. 의존성 0.
플러그인은 키트 마켓(`.claude-plugin/marketplace.json`)이 실측한 커밋으로 고정한다 — superpowers 7.0.1 · ponytail 4.13.0(5.x 는 보류 — docs/plan.md 7차). 공식 마켓은 자동 업데이트가 켜져 있고, 출처에 sha 가 없으면 설치한 날의 최신이 들어오기 때문이다. 규칙이 기대는 동작은 두 가지다. 하나는 brainstorming 의 종료 조건이고, 다른 하나는 `PONYTAIL_DEFAULT_MODE=off` 다.

### 플러그인을 올릴 때 — 이 레포에서

1. `node tools/plugin-plan.mjs --upstream` — 고정 커밋과 각 플러그인 저장소의 최신 커밋을 비교하고, 새 버전과 바뀐 것 링크를 낸다
2. 바뀐 것을 읽고 판단한다 — 키트가 기대는 것(brainstorming 종료 조건 · `PONYTAIL_DEFAULT_MODE` · `ponytail-review` · final-gate 가 부르는 스킬 이름)이 그대로인가, 이득이 있나
3. 올리면 `marketplace.json` 의 `sha` · `version` 을 바꾸고 `node proof/run.mjs --claude`(P3 가 ponytail 끄기를 잰다) → 커밋 · push
4. 각 PC 에서 `git pull` 뒤 `node tools/plugin-plan.mjs` 가 `marketplace update` · `plugin update` 명령을 낸다 — 사용자 범위라 PC 마다 한 번이면 그 PC 의 모든 프로젝트에 퍼진다

### 이미 얹은 프로젝트를 새 버전으로 — 다른 PC 포함

그 PC 에서 키트를 받고(`git -C <이 레포 경로> pull`), 그 프로젝트의 Claude Code 에게:

```
<이 레포 경로>/SETUP.md 의 「갱신」을 따라 이 프로젝트를 갱신해줘
```

- `tools/plugin-plan.mjs` 가 그 PC 의 플러그인을 읽어 키트 마켓으로 옮길 명령을 낸다. 세션이 사용자에게 묻고 실행한다 — PC 마다 한 번이고, 다음 프로젝트부터는 「옮길 것 없다」
- `tools/upgrade.mjs` 가 도구 · 정책 · 손대지 않은 규칙을 올리고, 설정에 넣을 명령(관문 훅 · 옛 플러그인 id 끄기)을 낸다. 프로젝트가 고친 규칙은 덮어쓰지 않는다

## 두 모듈

| 모듈 | 막는 실패 | 도구 (`.harness/tools/`) |
|---|---|---|
| **evidence** | 완료를 거짓 보고한다 · 묻지 않고 넘어간 가정이 묵는다 · 같은 실패를 반복한다 | `verify` · `gate-hook` · `decision-check` · `lesson-append` · `lesson-promote` · `state-check` · `policy-apply` |
| **graph** | 같은 것을 두 번 조사한다 · 사용자의 말과 코드의 이름 사이 다리가 없다 | `graph-find` · `graph-append` · `graph-alias` · `graph-hook` · `graph-view` · `graph-measure` |
| 설치 | — | `detect` · `install-mode` · `scan-shared` · `plugin-plan` · `upgrade` |

자동 로드되는 층은 `.claude/rules/harness.md` · `.claude/rules/graph.md` 둘뿐이다. 관문은 `final-gate` 스킬 — **작업을 끝냈다고 보고하기 직전에 매번** 돈다(계획 유무와 무관).

## 신규 구축 / 기존 이식 · 설치 모드

| | 신규 (커밋 < 20 · 소스 < 50) | 기존 |
|---|---|---|
| 지시 파일 | 없으면 지도 골격을 만든다 — 공유면 `AGENTS.md` + `CLAUDE.md`(`@AGENTS.md`), 로컬이면 `CLAUDE.local.md` | ⛔ 내용을 고치지 않는다 — 필요하면 import 한 줄 |
| 소급 | 없음 — 스펙 용어를 「설계 용어」로 시드 | 이슈 > 인수인계 문서 > 담당자 > 커밋 이력 순으로 lessons 2~3 · 그래프 3~5 |
| 테스트 | junit 검사가 있으면 첫 테스트 전 verify 실패(테스트 0개)가 정상 · 러너 전이면 타입 검사 같은 exit-code 검사로 시작 | 원래 있던 실패는 사용자 확인 뒤 기준선 (`verify --baseline`) |

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

상세는 [docs/proof.md](docs/proof.md) — 합성 대상 세 층(결정론 · 새 세션 · SETUP 종단), 운영 데이터 한 층, 실제 설치의 관문 사용. 요지:

| 층 | 무엇이 나왔나 | 한계 |
|---|---|---|
| 결정론 (`node proof/run.mjs`) | 하네스 없이는 통과로 보이는 거짓 완료(테스트 0개 · 직전 XML · 기준선 밖 실패)를 verify 가 모두 막는다 | 합성 저장소 |
| graph 운영 데이터 (이슈 8건) | 그래프 · 훅이 있으면 도구 호출 −91% · 정답 8/8 vs 4/8 | 표본 8건 · 라벨을 기록에서 뽑았다 |
| 실제 설치 3곳 (6세션) | 코드를 바꾼 턴 7개 중 5개에 verify 가 돌았다 — 나머지 2개는 검사 밖 시안 파일. final-gate 스킬은 코드 변경 뒤 0/7 | 표본 작음 · 대조군 없음 |

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

설계: `docs/design.md` · 계획: `docs/plan.md` · 구조(언제 무엇이 도는가 · 그래프 저장과 탐색): `docs/structure.md`

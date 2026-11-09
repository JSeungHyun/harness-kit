# 구조 — 큰 그림 · 훅 · 검증 · 구성

> 상태: **설계안** · 대상에 설치된 모습 기준이다. 왜 그렇게 정했나는 [design.md](design.md), 그래프가 깨지면 안 되는 동작은 [graph-port.md](graph-port.md)

## 0. 큰 그림

키트는 **두 모듈**이다. **증거**는 「끝났다」를 모델이 아니라 도구가 판정하게 하고, **그래프**는 사용자의 말 → 코드 위치 · 함정을 기록해 같은 조사를 두 번 하지 않게 한다.
일의 흐름(설계 · TDD · 서브에이전트)은 키트가 아니라 **superpowers** 플러그인이, 과설계 점검은 **ponytail** 플러그인의 `/ponytail-review` 가 맡는다.

| 모듈 | 하는 일 | 구성 |
|---|---|---|
| 증거 | 완료를 도구로 판정 · 보고 직전 관문 | `verify` · `final-gate` 스킬 · 관문 훅 · 장부 |
| 그래프 | 요구 → 용어 · 파일 · 함정 기록과 조회 | `graph-*` 도구 · 기록 파일 · 그래프 훅(조건부) |

**한 턴의 흐름**

```
사용자 질문
  └ [그래프 훅] 관련 기록을 찾아 붙인다 (기록이 쌓인 뒤에만 켠다)
작업 — 흐름은 superpowers (설계 → TDD · 서브에이전트 → 디버깅)
  └ verify           「끝났다」를 도구가 판정
  └ final-gate 스킬   범위 검토 · 과설계 리뷰 · 증거 · 파일 목록 · 기록
턴 종료
  └ [관문 훅] 이번 턴의 증거 세트(과설계 리뷰 · code-review · 마지막 변경 뒤 verify · final-gate)에서 빠진 것이 있으면 한 번 되돌린다
```

**키트가 아닌 것** — superpowers · ponytail 의 훅과 스킬, 프로젝트가 더한 훅은 §8 에 따로 둔다. §1~§4 는 키트 것만 다룬다.

## 1. 훅 — 키트가 거는 것은 둘

| 훅 | 언제 | 하는 일 | 켜는 때 |
|---|---|---|---|
| 관문 훅 `gate-hook.mjs` (10초) | `Stop` — 턴이 끝날 때 | 이번 턴(사람 입력 이후)의 증거 세트에서 빠진 것만 이유에 적어 한 번 되돌려 보낸다(아래 표). 결과를 기다리는 작업(서브에이전트 · 백그라운드 verify)이 도는 멈춤 · 되돌린 뒤의 멈춤은 통과 — 상주 개발 서버만 떠 있으면 통과가 아니다 | 설치 때 기본(SETUP ⑥) |
| 그래프 훅 `graph-hook.mjs` (30초) | `UserPromptSubmit` — 질문을 칠 때 | 프롬프트로 그래프를 조회해 카드 1~2장 · 후보 색인 · 침묵 중 하나를 넣는다 (§6.4) | ⛔ 조건부 — 기록이 쌓인 뒤 (§6.4) |

**관문 훅의 증거 세트** — 코드 변경 = 이번 턴의 Edit · Write · NotebookEdit 중 프로젝트 안 · 문서(`*.md` 등) · `.harness/` · `.claude/` 밖의 파일. 서브에이전트가 바꾼 파일은 메인 기록에 없어 보지 못한다

| 이번 턴에 | 있어야 하는 것 |
|---|---|
| 코드를 바꿨다 | `ponytail-review` 호출(플러그인 접두어 `…:ponytail-review` 도) |
| 바꾼 코드가 `harness.json` 검사의 `covers`(glob) 어디에도 안 든다 | `code-review` 호출 |
| 바꾼 코드를 덮는 검사가 있다 | 마지막 코드 변경 뒤의 `verify` — 과설계 리뷰로 걷어낸 뒤의 회귀를 잡는다 |
| `verify` 를 돌렸다 | `final-gate` 호출 |

- 백그라운드 판정은 Stop 입력 `background_tasks` 원소의 `type` 이다(2.1.319 덤프: `shell` 은 `command` · `subagent` 는 `agent_type` 을 가진다). `shell` 은 `command` 가 verify 일 때만 기다림으로 친다
- 이 밖에 git `pre-commit` 훅이 하나 있다 — `scan-shared.mjs`, **공유 모드만**. 커밋되는 기록 · 장부 · 규칙에 민감 정보 패턴이 있으면 막는다
- 나머지는 훅이 아니라 규칙이 「언제 무엇을 부르라」고 시킨다. 관문(`final-gate`)은 규칙과 스킬 설명이 부르고, 건너뛰면 관문 훅이 한 번 되돌린다(design §3)
- 설정은 `policy-apply` 가 `.claude/settings.json`(공유) 또는 `settings.local.json`(로컬)에 병합한다 — ⛔ 덮어쓰지 않는다. 권한은 합집합이고 프로젝트가 더한 훅은 그대로 둔다(예: §8.2)
- 둘 다 셸 없이 node 를 바로 띄운다(exec 형식 `"command": "node", "args": ["${CLAUDE_PROJECT_DIR}/.harness/tools/…"]`) — Windows 에서 Git Bash 를 거치지 않아 한 번에 약 0.5초 덜 든다. 옛 셸 형식 등록은 `policy-apply` 가 바꿔 끼우고, 갱신(`upgrade`)이 그 명령을 낸다
- 훅이 실패하면 조용히 통과한다 — 프롬프트와 종료를 막지 않는다

## 2. 검증 — 「끝났다」를 무엇으로 판정하나

### 2.1 `verify` — 완료 증거

`.harness/harness.json` 의 `checks[]` 를 전부 돌린다. 하나라도 실패하거나 검사가 0개면 exit 1. 검사마다 선택 필드 `covers`(그 검사가 실제로 돌리는 코드의 glob 배열)를 둔다 — 하나도 없으면 출력 첫 줄이 「코드 검사 없음 — 코드 변경의 증거는 /code-review」다(exit 은 그대로). 형식이 틀리면 로더가 거부한다.

| `kind` | 통과 |
|---|---|
| `junit-xml` | 이번 실행이 쓴 XML 에 testcase 1개 이상 · 기준선 밖 실패 0 |
| `exit-code` | 명령 exit 0 — `--check` 같은 도구 자체 검사 |
| `file-unchanged` | 생성 명령 뒤 `git status --porcelain -- <evidence>` 가 비었다 |
| `output-match` | 명령 exit 0 · stdout 이 `expect` 정규식에 맞는다 |

원래 있던 테스트 실패는 기준선(`verify --baseline`, ⛔ 사용자가 확인한 뒤에만)으로 적어 두고, 그 밖의 실패만 실패로 친다.

### 2.2 `final-gate` — 끝냈다고 보고하기 직전, 매번 (계획이 있든 없든)

1. 코드를 바꿨으면 범위 검토(사용자 말 원문 + 이번 diff 만 받은 서브에이전트가 요청 밖 변경을 찾는다) → `/ponytail-review`(과설계만 본다) → 바꾼 코드를 덮는 검사(`covers`)가 없으면 `/code-review`. 걷어냈으면 2 를 그 뒤에 돈다 — 관문 훅이 이 셋과 마지막 변경 뒤 verify 를 확인한다(§1)
2. 완료 증거 — 작업 종류별

   | 작업 | 증거 |
   |---|---|
   | 코드 변경 | `verify` exit 0 (§2.1) |
   | 기록 변경 | `graph-find --check` exit 0 |
   | 운영 데이터 · 설정 | 실행 · 확인 쿼리와 전/후 결과 |
   | 조사 · 측정 | 정답 라벨 n건 대조 + 검증한 범위 |

3. 보고 한 세트 — 작업 파일 목록 · 기록(`graph-append` · decisions → `decision-check` · `lesson-append`) · 증거 출력 그대로 · 못 한 것은 `⏸`
   - 남길 게 없으면 그 판단을 한 줄로 밝힌다 · 낡은 기록은 그 자리에서 고친다(`supersedes`)
4. 브랜치를 마무리하는 보고(merge · PR 직전)면 `/security-review` 1회 → superpowers `finishing-a-development-branch`

### 2.3 `graph-find --check` — 기록의 무결성

대체 사슬 4종 · 없는 경로 · 같은 용어에서 낡은 기록이 1위 · `⏸` 표식 누락 후보 · 1위 독점(경고만). 앞의 셋이 있으면 exit 1 (§6.3).

## 3. 구성 — 프로젝트에 남는 것

| 층 | 무엇 | 언제 |
|---|---|---|
| 매 세션 로드 | 지시 파일(로컬 `CLAUDE.local.md` · 공유 `AGENTS.md` + `CLAUDE.md`) · `.claude/rules/harness.md` · `.claude/rules/graph.md` | 세션을 열 때 Claude Code 가 읽는다 |
| 스킬 | `final-gate` | 규칙과 스킬 설명이 부르게 한다 (§2.2) |
| 도구 | `.harness/tools/*.mjs` | 모델이 Bash 로 부른다 |
| 데이터 | 그래프 `.harness/graph/requests.jsonl` · 장부 · 기준선 | 도구로만 읽고 쓴다 (§6 · §7) |
| 권한 정책 | `permissions` 의 allow · deny · ask | 도구를 부를 때마다 (아래) |
| 플러그인 | superpowers 를 키트 마켓의 커밋으로 고정 · ponytail 은 그 커밋의 리뷰 스킬 `ponytail-review` 만 — 둘 다 PC(사용자 범위)에서 한 번, 로컬 설치는 프로젝트에 선언하지 않는다 | PC 맞추기 · 설치 · 갱신 때 (`plugin-plan` · SETUP) |

**권한 정책** (`policy/settings.json` — 훅이 아니다)

| | 무엇 |
|---|---|
| allow | 읽기 · 키트 점검 도구(`verify` · `decision-check` · `graph-find`) · 읽기 전용 셸 — 키트에서 지운 도구의 allow 는 `policy-apply` 가 걷는다(`policy/removed.json`) |
| deny | `git push` · `reset --hard` · `git clean` · `checkout --` · `rebase` · `curl\|bash` · `npm publish` · `find -delete` — `rm` · `rmdir` 은 두지 않는다: PC(전역)가 정한다. 프로젝트 deny 는 전역 allow 를 이긴다 |
| ask | `--force` · `git restore` · `stash drop·clear` |

⛔ 그래프 쓰기(`graph-append` · `graph-alias`)는 allow 에 없다 — 기본 모드에서는 사람이 승인한다. auto 모드에서는 사람이 아니라 분류기가 판정한다.

## 4. 설치 · 갱신 — 대상에 맞춰 얹는다

| 언제 | 무엇이 |
|---|---|
| 설치 전 판별 | `detect` — 신규 구축인지 기존 이식인지 · 멈출 것(⛔) · 확인할 것(⚠️) |
| 공유 / 로컬 | `install-mode` — 공유는 팀이 같이 커밋하고, 로컬은 설치 경로를 git 에서 숨긴다 |
| 그래프가 이미 있는 프로젝트 | 증거 모듈만 — 키트 그래프 도구를 복사하지 않고 `harness.json` 의 `graph` 가 기존 도구 · 규칙을 가리킨다. 관문 훅은 `policy-apply --only gate-hook` |
| 키트가 새 버전이 되면 | `upgrade` — 도구 · 정책 · 손대지 않은 규칙을 올린다(프로젝트가 고친 규칙은 덮어쓰지 않는다) · 키트에서 지운 것(`policy/removed.json`)을 걷는다(쓴 대장은 남긴다) · 지운 경로를 가리키는 그래프 기록을 알린다 · 빌드 · 테스트 단서가 있는데 `covers` 검사가 없으면 ⛔ exit 1 · `plugin-plan` — PC 마다 한 번 플러그인을 키트 마켓으로 옮기는 명령 |

절차는 SETUP.md 가 정본이다.

## 5. 작업 한 번 — 어떤 스킬 · 도구를 언제

| 단계 | 무엇을 | 시키는 곳 |
|---|---|---|
| ① 요구가 오면 | 그래프부터. 훅이 켜졌으면 카드가 이미 들어와 있고, 아니면 `graph-find <어근…>`. 빈손이면 새 영역 — 평소대로 코드를 본다 | graph.md §1 |
| ② 사용자의 말이 0건 | 실체를 알아낸 그 턴에 `graph-alias <사용자의 말> "<실체>"` | graph.md §2 |
| ③ 설계 · 계획 | 새 기능은 superpowers `brainstorming`. 계획 문서는 인계 · 여러 세션일 때만 `writing-plans` — 작은 변경은 없이, 여러 파일은 `TodoWrite` 로 단계만 | harness.md 흐름 |
| ④ 구현 | superpowers 의 TDD · 서브에이전트 주도 개발 · 디버깅. ⛔ 되돌리기 어려운 작업(삭제 · 이력 재작성 · 운영 반영 · 레포 밖 · 비밀값)은 착수 전에 승인 | harness.md 흐름 |
| ⑤ 묻지 않고 정했다 | decisions 1절에 가정을 적고 진행 | harness.md |
| ⑥ 실패를 고쳤다 | `lesson-append` — 근본 원인이 없으면 거부한다 | harness.md 장부 |
| ⑦ 끝냈다고 보고하기 직전 | ⭐ `final-gate` 스킬 (§2.2) | harness.md 관문 · 스킬 설명 |
| ⑧ 브랜치를 마무리 | `/security-review` 1회 → superpowers `finishing-a-development-branch` | final-gate 4 |

## 6. 그래프 상세

### 6.1 저장

`.harness/graph/requests.jsonl` — 한 줄이 기록 하나인 append-only 파일이다. 도구는 자기 파일 위치 기준(`../graph/`)으로 찾는다 — 훅이 어느 cwd 에서 돌아도 같은 파일을 읽는다. ⛔ 자동 로드되지 않는다 — 도구와 훅으로만 읽으므로 무한히 쌓여도 세션 비용이 0 이다.

| 필드 | 뜻 | 비고 |
|---|---|---|
| `req` | 사용자 요구 한 줄 — 기록의 이름 | 필수. id 가 없고 다른 기록이 이 문자열로 가리킨다 |
| `terms` | `{"<현업 용어>": "<시스템의 실체>"}` | 키는 사용자의 말, 값은 테이블 · URL · 컬럼 · 서비스 |
| `files` | 실제로 만진 파일 | 줄번호는 떼고 저장한다 |
| `tables` | DB 테이블 | 선택 |
| `note` | 함정 · 기각한 대안 한 줄 | `⏸` 로 시작하면 하다 만 것. 줄바꿈 · 800자 초과는 `graph-append` 가 거부한다(exit 1 · 한 건이라도 거부되면 아무것도 쓰지 않는다) |
| `supersedes` | 이 기록이 무효화하는 이전 `req` — 1개 또는 배열 | 한 글자만 달라도 사슬이 끊긴다 → `--check` 가 잡는다 |
| `date` · `recorded` | 일이 일어난 날 · 적은 날 | 둘 다 오늘이 기본, 소급할 때만 `date` 를 준다 |

```json
{"date":"<YYYY-MM-DD>","recorded":"<YYYY-MM-DD>","req":"<요구 한 줄>","terms":{"<현업 용어>":"<실체>"},"files":["<경로>"],"note":"<함정 한 줄>"}
```

- `req` 머리말: `정본: `(같은 주제의 통합본 — 훅이 1장만 낸다) · `용어 학습: `(`graph-alias` 가 붙인다) · `용어 사전: `
- 저장은 평평한 줄 목록이다. 기록 순서(줄 순서) · 대체됨 · 언제부터 낡았나는 읽을 때 `supersedes` 로 만든다

### 6.2 쓰기

| 언제 | 무엇으로 |
|---|---|
| 대화 중 사용자의 말 → 실체를 알아낸 그 턴 | `graph-alias <말> "<실체>" [--file 경로]… [--note 함정]` — ⛔ 알아내기 전에는 적지 않는다 |
| 작업 끝 — `final-gate` 의 기록 단계 | `graph-append` (stdin JSON). ⛔ 첫째 문 「이 저장소의 지식인가」 — 도구 · 훅 · 하네스 사용법이면 적지 않고 그 판단을 한 줄로 |
| 기록이 낡았다 | 전체면 새 기록에 `supersedes` · 같은 주제 2건 이상이면 `정본: ` 1건으로 통합 · 한 대목만이면 그 문장을 직접 고친다 |
| 하다 만 것 | `note` 를 `⏸` 로 시작한다 — 끝내면 `supersedes` 로 무효화 |
| 적은 뒤 | `graph-find --check` exit 0 + 방금 넣은 용어로 조회해 엉뚱한 게 1위가 아닌지 |

⛔ 예시 낱말을 어느 필드에도 넣지 않는다 — 전 필드가 색인된다. ⛔ 개인 식별자 · 비밀값을 적지 않는다. 판단 규칙 전부는 `.claude/rules/graph.md` §4.

### 6.3 탐색 — `graph-find`

| 명령 | 답하는 물음 |
|---|---|
| `graph-find <어근…>` | 이 말과 비슷한 과거 요구와 그때의 용어 · 파일 · 함정 |
| `--files <경로조각>` | 이 파일을 만진 요구 (1홉) |
| `--with <경로조각>` | 이 파일을 고치면 같이 움직이는 파일 (2홉 — `⛔항상` · `⭐자주`) |
| `--open` | 하다 만 것(`⏸`) 전부 |
| `--check` | 무결성 — 대체 사슬 4종 · 없는 경로 · 같은 용어에서 낡은 기록이 1위 · `⏸` 표식 누락 후보 · 1위 독점(살아있는 기록 20건부터 — 기록마다 그 `req` 로 묻되 자기를 뺀 1위의 상위3 점유가 50% 이상이면 ⚠️, exit 0). 앞의 셋이 있으면 exit 1 |
| `--promote [정본문서]` | 자주 나오는 용어 → 정본 문서로 올릴 후보 |
| `--all` | 대체된 기록까지 본다 |

**찾는 법**

1. **질의를 토큰으로** — 한글은 2자 이상 낱말에서 흔한 말(수정 · 추가 · 확인 …)을 빼고, 조사를 뗀 형태 · 띄어쓰기만 다른 형태(2~3어절을 붙인 것) · 3자 이상이면 앞 2자 어근까지 만든다. 식별자는 대문자 약어 2자 이상, 그 밖은 5자 이상
2. **토큰마다 점수** — 처음 맞는 규칙 하나만 친다

   | 규칙 | 점수 |
   |---|---|
   | 용어 키와 같다(공백 무시) · 제목 머리와 같다 — 정확일치 | +3 |
   | 파일 경로에 들어 있다 | +2 |
   | 요구 · 용어 키 · 테이블에 들어 있다 — 용어 값은 식별자 토큰일 때만 본다 | +1 |
   | `note` 에 들어 있다 | +1 |

3. **정렬** — 정확일치가 있는 기록 먼저 → 점수 → 최신. 대체된 기록은 뺀다
4. 문장을 통째로 줘서 0건이면 같은 토크나이저로 쪼개 다시 찾는다
5. **출력** — 카드(점수 · 날짜 · 요구 · `용어 → 실체` · 테이블 · 파일 · ⚠️ 함정) + 같은 용어의 이력(최신순, 낡은 것 표시) + 상위 결과에 자주 나온 파일

### 6.4 훅 — 질문마다 대신 조회 (`graph-hook`)

**켜는 조건** — 살아있는 기록 20건 이상 + `--check` exit 0 + 상위 3 기록 점유 < 50%(`graph-measure` 로 잰다. 질의 집합이 없으면 보고에 「독점 미측정」). 켜기: `policy-apply --local --with graph-hook`(공유는 `--local` 없이).

프롬프트마다 `graph-find` 와 같은 토크나이저 · 채점으로 조회한다. 대체된 기록과 사무 기록(`TODO 갱신`)은 뺀다.

| 판정 | 조건 | 넣는 것 |
|---|---|---|
| 1단 — 확신 | 1위가 정확일치 · 식별자 적중 · 5점 이상 중 하나 | 카드 2장(1위가 `정본: ` 이면 1장) — 함정을 맨 앞에, 질의에 걸린 용어 8줄까지, 파일 6개. 2위는 정본 · 사전일 때만 전문이고 그 밖은 제목 + 함정. 끝에 「걸린 것이 답이라는 뜻은 아니다」 탈출구 |
| 2단 — 약함 | 1단이 아니고 최고점수 3~4 | 점수 상위 10건 색인(날짜 · 요구 · 용어 키 5개) + 「맞는 게 있으면 `graph-find` 로 판다」 |
| 침묵 | 최고점수 ≤ 2 — 「계속 진행」 같은 발화 | 아무것도 |
| `⏸` | 하다 만 기록이 이 질의에 5점 이상 | 순위와 무관하게 「열린 작업」 줄을 붙인다 |

숫자는 `tools/graph-hook.mjs` 의 상수이고 근거는 graph-port.md §1 · §5.

### 6.5 재기 · 보기

| 명령 | 언제 |
|---|---|
| `graph-measure --self` | 기록의 `req` 로 조회해 그 기록이 1위인가 — 회귀 |
| `graph-measure . --tickets <json>` | 이슈 제목을 질의로 — 확신율 · 상위 3 점유. 훅을 켜기 전후 |
| `graph-view [출력경로]` | 기록 전체를 HTML 한 장으로 (기본은 임시 폴더) |

## 7. 장부 — 성격마다 하나

| 장부 | 무엇 | 도구 | 위치 — 공유 / 로컬 |
|---|---|---|---|
| 그래프 | 사실 · 함정 · 용어 · 기각한 대안 · 하다 만 것 | `graph-*` | `.harness/graph/requests.jsonl` |
| decisions | 묻지 않고 정한 가정 | `decision-check` — 답을 기다리는 1절 목록, exit 0 고정 | `docs/harness/` / `.harness/state/` |
| lessons | 반복 실패 + 근본 원인 | `lesson-append` — 근본 원인이 없으면 거부한다 | 같음 |
| 기준선 | 원래 있던 테스트 실패 | `verify --baseline` — ⛔ 사용자가 확인한 뒤에만 | `.harness/baseline/<검사 id>.txt` |
| 규칙 · 지도 | 행동을 바꿔야 하는 것 | — 매 세션 로드 | `.claude/rules/` · 지시 파일 |

**승격은 한 방향 — 그래프 · lessons → 규칙.** 「다음 세션이 이걸 안 읽으면 같은 실수를 하나」 → 그러면 규칙이다.

## 8. 키트 밖에서 같이 도는 것

### 8.1 플러그인 훅 — superpowers · ponytail

| 이벤트 | 무엇이 | 출처 | 하는 일 |
|---|---|---|---|
| `SessionStart` (startup · clear · compact) | `session-start` | superpowers | 스킬 사용 규칙(using-superpowers)을 넣는다 — 「관련 스킬이 있으면 먼저 부른다」 |
| `SessionStart` | `ponytail-activate.js` | ponytail | 모드를 켠다 — **키트 기본(리뷰 스킬만)에서는 플러그인이 꺼져 있어 돌지 않는다** |
| `UserPromptSubmit` | `ponytail-mode-tracker.js` | ponytail | `/ponytail <모드>` 전환을 기억한다 — 같음 |
| `SubagentStart` | `ponytail-subagent.js` | ponytail | 모드가 켜져 있을 때만 서브에이전트에 규칙을 넣는다 — 같음 |

- 키트 기본은 ponytail 플러그인을 사용자 범위에서 끄고 사용자 스킬 `ponytail-review` 만 둔다(SETUP ⑥ · `plugin-plan`) — 위 ponytail 훅 세 줄이 돌지 않아 프롬프트 · 서브에이전트마다 node 를 띄우지 않는다. 지시 파일이 ponytail 모드를 쓰는 프로젝트만 자기 설정에서 플러그인을 켜고, 그 프로젝트에서만 세 줄이 돈다
- ponytail 훅은 제한이 5초다. 프로세스 기동이 느린 PC(보안 프로그램이 새 프로세스마다 검사하는 경우)에서는 가끔 「timed out after 5s」로 결과가 버려진다 — 그 프롬프트의 모드 추적만 빠지고 작업에는 영향이 없다. 키트 훅은 10초 · 30초다

### 8.2 프로젝트가 더한 훅 — 예: 화면 디자인 스킬 게이트

키트 밖의 예다. Impeccable 4.5.0(화면 디자인 스킬)과 그 스킬을 먼저 부르게 하는 게이트를 들인 프로젝트에서는 아래가 §1 · §8.1 에 더해진다.

| 이벤트 | 무엇이 | 하는 일 |
|---|---|---|
| `SessionStart` | `impeccable hook` | 세션을 준비한다 |
| `PreToolUse` (`Write\|Edit\|MultiEdit\|Bash`) | `.claude/hooks/impeccable-gate.mjs` — 그 프로젝트의 파일 | 에이전트마다 처음 화면 파일을 쓸 때, `impeccable` 스킬을 안 불렀으면 막고 작업 설명과 함께 부르게 한다. Impeccable 자기 에이전트(`impeccable-*`)는 통과 |
| `PostToolUse` (`Edit\|Write`) | `impeccable hook` | 화면 파일을 고친 뒤 디자인 검출기(즉시 단계) |
| `Stop` | `impeccable hook` | 응답이 끝날 때 전체 규칙 검사 |

화면 작업 요청 → 모델이 대개 스스로 `impeccable` 을 부른다 → 안 불렀으면 게이트가 첫 화면 파일 쓰기를 막아 부르게 한다 → 새 화면은 Impeccable 흐름(질문 → 방향 → 화면 브리프 → 구현 → 스크린샷 검토) → 고칠 때마다 검출기. 서브에이전트는 사용자에게 물을 수 없어 방향 단계를 건너뛴다 — 새 화면의 방향은 메인 세션에서 정한다.

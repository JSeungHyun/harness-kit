# 구조 — 언제 무엇이 도는가

> 상태: **설계안** · 대상에 설치된 모습 기준이다. 왜 그렇게 정했나는 [design.md](design.md), 그래프가 깨지면 안 되는 동작은 [graph-port.md](graph-port.md)

## 0. 한눈에

| 층 | 무엇 | 언제 |
|---|---|---|
| 매 세션 로드 | 지시 파일(로컬 `CLAUDE.local.md` · 공유 `AGENTS.md` + `CLAUDE.md`) · `.claude/rules/harness.md` · `.claude/rules/graph.md` | 세션을 열 때 Claude Code 가 읽는다 |
| 훅 | 플러그인 훅 · 그래프 훅(조건부) · 프로젝트가 더한 훅 | 이벤트마다 자동 (§1) |
| 권한 정책 | `permissions` 의 allow · deny · ask | 도구를 부를 때마다 |
| 스킬 | `final-gate` · superpowers 흐름 · `/ponytail-review` · 프로젝트 스킬 | 규칙과 스킬 설명이 부르게 한다 (§2) |
| 도구 | `.harness/tools/*.mjs` | 모델이 Bash 로 부른다 |
| 데이터 | 그래프 `.harness/graph/requests.jsonl` · 장부 · 기준선 | 도구로만 읽고 쓴다 (§3 · §4) |

⭐ **키트가 직접 거는 Claude Code 훅은 둘이다.** 하나는 관문 훅(설치 때)이고, 다른 하나는 그래프 훅(기록이 쌓인 뒤)이다. 나머지는 규칙이 「언제 무엇을 부르라」고 시킨다. 관문(`final-gate`)은 규칙과 스킬 설명이 부르고, verify 를 돌린 턴에 건너뛰면 관문 훅이 한 번 되돌려 보낸다(design §3).

## 1. 이벤트마다 자동으로 도는 것

| 이벤트 | 무엇이 | 출처 | 하는 일 |
|---|---|---|---|
| `SessionStart` (startup · clear · compact) | `session-start` | superpowers | 스킬 사용 규칙(using-superpowers)을 넣는다 — 「관련 스킬이 있으면 먼저 부른다」 |
| `SessionStart` | `ponytail-activate.js` | ponytail | 정책이 `PONYTAIL_DEFAULT_MODE=off` 라 아무것도 넣지 않는다 |
| `UserPromptSubmit` | `graph-hook.mjs` | 키트 · ⛔ 조건부 | 프롬프트로 그래프를 조회해 카드 1~2장 · 후보 색인 · 침묵 중 하나를 넣는다 (§3.4) |
| `UserPromptSubmit` | `ponytail-mode-tracker.js` | ponytail | `/ponytail <모드>` 전환을 기억한다 |
| `SubagentStart` | `ponytail-subagent.js` | ponytail | 모드가 켜져 있을 때만 서브에이전트에 규칙을 넣는다 — off 면 없음 |
| `Stop` | `gate-hook.mjs` | 키트 | 이번 턴에 verify 를 돌리고 final-gate 를 안 거쳤으면 한 번 되돌려 보낸다. 백그라운드 작업을 기다리는 멈춤 · 되돌린 뒤의 멈춤은 통과 |
| 도구 호출마다 | 권한 정책 (훅이 아니다) | 키트 `policy/settings.json` | allow — 읽기 · 키트 점검 도구(`verify` · `decision-check` · `lesson-promote` · `state-check` · `graph-find`) · 읽기 전용 셸 / deny — `rm` · `rmdir` · `git push` · `reset --hard` · `git clean` · `checkout --` · `rebase` · `curl\|bash` · `npm publish` · `find -delete` / ask — `--force` · `git restore` · `stash drop·clear` |
| git `pre-commit` | `scan-shared.mjs` | 키트 · 공유 모드만 | 커밋되는 기록 · 장부 · 규칙에 민감 정보 패턴이 있으면 막는다 |

- ponytail 을 플러그인 없이 사용자 스킬 `ponytail-review` 로만 둔 PC 에는 위 ponytail 훅 세 줄이 없다 — 로컬 전용 `policy-apply` 가 그 플러그인을 선언하지 않는다(SETUP ⑥)
- 설정은 `policy-apply` 가 `.claude/settings.json`(공유) 또는 `settings.local.json`(로컬)에 병합한다 — ⛔ 덮어쓰지 않는다. 권한은 합집합이고 프로젝트가 더한 훅은 그대로 둔다(예: §6)
- ⛔ 그래프 쓰기(`graph-append` · `graph-alias`)는 allow 에 없다 — 사람이 보고 승인한다

## 2. 작업 한 번 — 어떤 스킬 · 도구를 언제

| 단계 | 무엇을 | 시키는 곳 |
|---|---|---|
| ① 요구가 오면 | 그래프부터. 훅이 켜졌으면 카드가 이미 들어와 있고, 아니면 `graph-find <어근…>`. 빈손이면 새 영역 — 평소대로 코드를 본다 | graph.md §1 |
| ② 사용자의 말이 0건 | 실체를 알아낸 그 턴에 `graph-alias <사용자의 말> "<실체>"` | graph.md §2 |
| ③ 설계 · 계획 | 새 기능은 superpowers `brainstorming`. 계획 문서는 인계 · 여러 세션일 때만 `writing-plans` — 작은 변경은 없이, 여러 파일은 `TodoWrite` 로 단계만 | harness.md 흐름 |
| ④ 구현 | superpowers 의 TDD · 서브에이전트 주도 개발 · 디버깅. ⛔ 되돌리기 어려운 작업(삭제 · 이력 재작성 · 운영 반영 · 레포 밖 · 비밀값)은 착수 전에 승인 | harness.md 흐름 |
| ⑤ 묻지 않고 정했다 | decisions 1절에 가정을 적고 진행 | harness.md |
| ⑥ 실패를 고쳤다 | `lesson-append` — 근본 원인이 없으면 거부한다 | harness.md 장부 |
| ⑦ 끝냈다고 보고하기 직전 | ⭐ `final-gate` 스킬 — 아래 | harness.md 관문 · 스킬 설명 |
| ⑧ 브랜치를 마무리 | `/security-review` 1회 → superpowers `finishing-a-development-branch` | final-gate 4 |

**`final-gate` — 매번, 계획이 있든 없든**

1. 코드를 바꿨으면 `/ponytail-review` — 과설계만 본다. 걷어냈으면 2 를 그 뒤에 돈다
2. 완료 증거 — 작업 종류별

   | 작업 | 증거 |
   |---|---|
   | 코드 변경 | `verify` exit 0 (§5) |
   | 기록 변경 | `graph-find --check` exit 0 |
   | 운영 데이터 · 설정 | 실행 · 확인 쿼리와 전/후 결과 |
   | 조사 · 측정 | 정답 라벨 n건 대조 + 검증한 범위 |

3. 보고 한 세트 — 작업 파일 목록 · 기록(`graph-append` · decisions → `decision-check` · `lesson-append` → `lesson-promote`) · 증거 출력 그대로 · 못 한 것은 `⏸`
   - 남길 게 없으면 그 판단을 한 줄로 밝힌다 · 낡은 기록은 그 자리에서 고친다(`supersedes`)

## 3. 그래프

### 3.1 저장

`.harness/graph/requests.jsonl` — 한 줄이 기록 하나인 append-only 파일이다. 도구는 자기 파일 위치 기준(`../graph/`)으로 찾는다 — 훅이 어느 cwd 에서 돌아도 같은 파일을 읽는다. ⛔ 자동 로드되지 않는다 — 도구와 훅으로만 읽으므로 무한히 쌓여도 세션 비용이 0 이다.

| 필드 | 뜻 | 비고 |
|---|---|---|
| `req` | 사용자 요구 한 줄 — 기록의 이름 | 필수. id 가 없고 다른 기록이 이 문자열로 가리킨다 |
| `terms` | `{"<현업 용어>": "<시스템의 실체>"}` | 키는 사용자의 말, 값은 테이블 · URL · 컬럼 · 서비스 |
| `files` | 실제로 만진 파일 | 줄번호는 떼고 저장한다 |
| `tables` | DB 테이블 | 선택 |
| `note` | 함정 · 기각한 대안 한 줄 | `⏸` 로 시작하면 하다 만 것 |
| `supersedes` | 이 기록이 무효화하는 이전 `req` — 1개 또는 배열 | 한 글자만 달라도 사슬이 끊긴다 → `--check` 가 잡는다 |
| `date` · `recorded` | 일이 일어난 날 · 적은 날 | 둘 다 오늘이 기본, 소급할 때만 `date` 를 준다 |

```json
{"date":"<YYYY-MM-DD>","recorded":"<YYYY-MM-DD>","req":"<요구 한 줄>","terms":{"<현업 용어>":"<실체>"},"files":["<경로>"],"note":"<함정 한 줄>"}
```

- `req` 머리말: `정본: `(같은 주제의 통합본 — 훅이 1장만 낸다) · `용어 학습: `(`graph-alias` 가 붙인다) · `용어 사전: `
- 저장은 평평한 줄 목록이다. 기록 순서(줄 순서) · 대체됨 · 언제부터 낡았나는 읽을 때 `supersedes` 로 만든다

### 3.2 쓰기

| 언제 | 무엇으로 |
|---|---|
| 대화 중 사용자의 말 → 실체를 알아낸 그 턴 | `graph-alias <말> "<실체>" [--file 경로]… [--note 함정]` — ⛔ 알아내기 전에는 적지 않는다 |
| 작업 끝 — `final-gate` 의 기록 단계 | `graph-append` (stdin JSON). ⛔ 첫째 문 「이 저장소의 지식인가」 — 도구 · 훅 · 하네스 사용법이면 적지 않고 그 판단을 한 줄로 |
| 기록이 낡았다 | 전체면 새 기록에 `supersedes` · 같은 주제 2건 이상이면 `정본: ` 1건으로 통합 · 한 대목만이면 그 문장을 직접 고친다 |
| 하다 만 것 | `note` 를 `⏸` 로 시작한다 — 끝내면 `supersedes` 로 무효화 |
| 적은 뒤 | `graph-find --check` exit 0 + 방금 넣은 용어로 조회해 엉뚱한 게 1위가 아닌지 |

⛔ 예시 낱말을 어느 필드에도 넣지 않는다 — 전 필드가 색인된다. ⛔ 개인 식별자 · 비밀값을 적지 않는다. 판단 규칙 전부는 `.claude/rules/graph.md` §4.

### 3.3 탐색 — `graph-find`

| 명령 | 답하는 물음 |
|---|---|
| `graph-find <어근…>` | 이 말과 비슷한 과거 요구와 그때의 용어 · 파일 · 함정 |
| `--files <경로조각>` | 이 파일을 만진 요구 (1홉) |
| `--with <경로조각>` | 이 파일을 고치면 같이 움직이는 파일 (2홉 — `⛔항상` · `⭐자주`) |
| `--open` | 하다 만 것(`⏸`) 전부 |
| `--check` | 무결성 — 대체 사슬 4종 · 없는 경로 · 같은 용어에서 낡은 기록이 1위 · `⏸` 표식 누락 후보. 앞의 셋이 있으면 exit 1 |
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

### 3.4 훅 — 질문마다 대신 조회 (`graph-hook`)

**켜는 조건** — 살아있는 기록 20건 이상 + `--check` exit 0 + 상위 3 기록 점유 < 50%(`graph-measure` 로 잰다. 질의 집합이 없으면 보고에 「독점 미측정」). 켜기: `policy-apply --local --with graph-hook`(공유는 `--local` 없이).

프롬프트마다 `graph-find` 와 같은 토크나이저 · 채점으로 조회한다. 대체된 기록과 사무 기록(`TODO 갱신`)은 뺀다.

| 판정 | 조건 | 넣는 것 |
|---|---|---|
| 1단 — 확신 | 1위가 정확일치 · 식별자 적중 · 5점 이상 중 하나 | 카드 2장(1위가 `정본: ` 이면 1장) — 함정을 맨 앞에, 질의에 걸린 용어 8줄까지, 파일 6개. 2위는 정본 · 사전일 때만 전문이고 그 밖은 제목 + 함정. 끝에 「걸린 것이 답이라는 뜻은 아니다」 탈출구 |
| 2단 — 약함 | 1단이 아니고 최고점수 3~4 | 점수 상위 10건 색인(날짜 · 요구 · 용어 키 5개) + 「맞는 게 있으면 `graph-find` 로 판다」 |
| 침묵 | 최고점수 ≤ 2 — 「계속 진행」 같은 발화 | 아무것도 |
| `⏸` | 하다 만 기록이 이 질의에 5점 이상 | 순위와 무관하게 「열린 작업」 줄을 붙인다 |

훅이 실패하면 조용히 통과한다 — 프롬프트를 막지 않는다. 숫자는 `tools/graph-hook.mjs` 의 상수이고 근거는 graph-port.md §1 · §5.

### 3.5 재기 · 보기

| 명령 | 언제 |
|---|---|
| `graph-measure --self` | 기록의 `req` 로 조회해 그 기록이 1위인가 — 회귀 |
| `graph-measure . --tickets <json>` | 이슈 제목을 질의로 — 확신율 · 상위 3 점유. 훅을 켜기 전후 |
| `graph-view [출력경로]` | 기록 전체를 HTML 한 장으로 (기본은 임시 폴더) |

## 4. 장부 — 성격마다 하나

| 장부 | 무엇 | 도구 | 위치 — 공유 / 로컬 |
|---|---|---|---|
| 그래프 | 사실 · 함정 · 용어 · 기각한 대안 · 하다 만 것 | `graph-*` | `.harness/graph/requests.jsonl` |
| decisions | 묻지 않고 정한 가정 | `decision-check` — 14일 묵으면 경고, exit 0 고정 | `docs/harness/` / `.harness/state/` |
| lessons | 반복 실패 + 근본 원인 | `lesson-append` · `lesson-promote` — 같은 분류 2회 이상 + 막는 것 없음 → 규칙 승격 후보 | 같음 |
| 진행 대장 (선택) | 파일 · 상태 · 해시 | `state-check` — 해시가 바뀐 행을 재작업으로 돌린다. `harness.json` 의 `state.current` 가 있을 때만 | 같음 |
| 기준선 | 원래 있던 테스트 실패 | `verify --baseline` — ⛔ 사용자가 확인한 뒤에만 | `.harness/baseline/<검사 id>.txt` |
| 규칙 · 지도 | 행동을 바꿔야 하는 것 | — 매 세션 로드 | `.claude/rules/` · 지시 파일 |

**승격은 한 방향 — 그래프 · lessons → 규칙.** 「다음 세션이 이걸 안 읽으면 같은 실수를 하나」 → 그러면 규칙이다.

## 5. 완료 증거 — `verify`

`.harness/harness.json` 의 `checks[]` 를 전부 돌린다. 하나라도 실패하거나 검사가 0개면 exit 1.

| `kind` | 통과 |
|---|---|
| `junit-xml` | 이번 실행이 쓴 XML 에 testcase 1개 이상 · 기준선 밖 실패 0 |
| `exit-code` | 명령 exit 0 — `--check` 같은 도구 자체 검사 |
| `file-unchanged` | 생성 명령 뒤 `git status --porcelain -- <evidence>` 가 비었다 |
| `output-match` | 명령 exit 0 · stdout 이 `expect` 정규식에 맞는다 |

## 6. 프로젝트가 더한 훅과 같이 돌 때 — 예: 화면 디자인 스킬 게이트

키트 밖의 예다. Impeccable 4.5.0(화면 디자인 스킬)과 그 스킬을 먼저 부르게 하는 게이트를 들인 프로젝트에서는 아래가 §1 에 더해진다.

| 이벤트 | 무엇이 | 하는 일 |
|---|---|---|
| `SessionStart` | `impeccable hook` | 세션을 준비한다 |
| `PreToolUse` (`Write\|Edit\|MultiEdit\|Bash`) | `.claude/hooks/impeccable-gate.mjs` — 그 프로젝트의 파일 | 에이전트마다 처음 화면 파일을 쓸 때, `impeccable` 스킬을 안 불렀으면 막고 작업 설명과 함께 부르게 한다. Impeccable 자기 에이전트(`impeccable-*`)는 통과 |
| `PostToolUse` (`Edit\|Write`) | `impeccable hook` | 화면 파일을 고친 뒤 디자인 검출기(즉시 단계) |
| `Stop` | `impeccable hook` | 응답이 끝날 때 전체 규칙 검사 |

화면 작업 요청 → 모델이 대개 스스로 `impeccable` 을 부른다 → 안 불렀으면 게이트가 첫 화면 파일 쓰기를 막아 부르게 한다 → 새 화면은 Impeccable 흐름(질문 → 방향 → 화면 브리프 → 구현 → 스크린샷 검토) → 고칠 때마다 검출기. 서브에이전트는 사용자에게 물을 수 없어 방향 단계를 건너뛴다 — 새 화면의 방향은 메인 세션에서 정한다.

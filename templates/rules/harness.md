# 하네스 — 증거와 기록

> 상태: **설계안** · harness-kit 이 설치했다. 도구는 `.harness/tools/`, 설정은 `.harness/harness.json`

⭐ **코드를 바꾼 작업은 완료를 주장하기 전에 `node .harness/tools/verify.mjs`** — 보고 직전에는 `final-gate`. 작업 종류별 증거는 아래 「완료는 증거로 주장한다」

⚠️ 이 프로젝트의 지시 파일(`AGENTS.md` · `CLAUDE.md` 등)이 흐름 · 계획 문서 · ponytail 모드 · 플러그인을 따로 정했으면 그쪽을 따른다 — 이 파일이 더하는 것은 관문 · 완료 증거 · 장부다.

## 흐름 — superpowers 가 베이스, 계획 문서는 인계·다세션일 때만

| 작업 | 계획 문서 |
|---|---|
| 작은 변경 (파일 1~3, 순서 없음) | 쓰지 않는다 |
| 여러 파일 · 순서 의존 | `TodoWrite` 로 단계만. 절차가 이미 적혀 있으면(스킬·문서) 그것을 따른다 |
| 운영 요건 (코드 변경 없음) | ⛔ 쓰지 않는다 — 실행·확인 쿼리를 본문에 먼저 |
| 다른 세션·서브에이전트에 인계 · 여러 세션 | superpowers `writing-plans`. 옮기는 코드는 출처로 가리키고 새 로직만 적는다 |

- ⛔ brainstorming 의 종료 조건(「writing-plans 호출」)보다 위 표가 우선한다
- **되돌리기 어려운 작업은 착수 전에 제안하고 승인받는다** — 데이터 삭제 · 이력 재작성 · 운영 반영 · 레포 밖으로 나가는 작업 · 비밀값
- 승인된 일을 실행하는 동안에는 묻지 않는다 — 확인할 것은 가정과 함께 `<decisions>` 1절에 적고 진행한다

## ⭐ 관문 — 작업을 끝냈다고 보고하기 직전에 매번 `final-gate` 스킬

계획이 있으면 그 마지막 태스크가 보고를 부르고, 없으면 보고가 곧 관문이다. 범위 검토 · 과설계 리뷰 · 완료 증거 · 기록이 한 세트다. Stop 훅이 이번 턴의 증거 세트를 보고 빠진 것이 있으면 한 번 되돌려 보낸다 — 코드를 바꿨으면 `/ponytail-review` · 바꾼 코드를 덮는 검사(`harness.json` 의 `covers`)가 없으면 `/code-review` · 덮는 검사가 있으면 마지막 코드 변경 뒤의 verify · verify 를 돌렸으면 final-gate.

## 완료는 증거로 주장한다

⛔ 종료코드 0 · `BUILD SUCCESSFUL` · 러너의 `pass` 요약으로 통과를 주장하지 않는다 — 테스트가 0개여도 그렇게 나온다.

| 작업 | 증거 |
|---|---|
| 코드 변경 | `node .harness/tools/verify.mjs` — exit 0 (이번 실행이 쓴 결과 파일로 판정, 알려진 실패 기준선은 개수만) |
| 운영 데이터 · 설정 | 실행·확인 쿼리와 전/후 결과를 본문에 |
| 기록 변경 | `node <graph-tools>/graph-find.mjs --check` — exit 0 |
| 조사 · 측정 | 정답 라벨 n건 대조 + 검증한 범위 |

⛔ `node .harness/tools/verify.mjs --baseline` 은 사용자가 「원래 있던 실패」라고 확인한 뒤에만 — 실패를 기준선에 넣으면 그 실패는 더 울리지 않는다.

## 장부 — 성격마다 하나

| 무엇 | 어디 |
|---|---|
| 사실 · 함정 · 인과 · 기각한 대안 한 줄 · 하다 만 것(`⏸`) | 그래프 — <graph-rules> |
| 묻지 않고 정한 가정 | `<decisions>` — `node .harness/tools/decision-check.mjs` 가 답을 기다리는 1절 목록을 낸다 |
| 반복 실패 (규칙이 되기 전) | `<lessons>` — 아래 `lesson-append` 로 적는다 |
| 행동을 바꿔야 하는 것 | 규칙 — `.claude/rules/` 의 프로젝트 파일 · 프로젝트 지도. ⛔ 키트 파일(`.harness/` 의 도구 · lib · 정책 · `harness.md` · `graph.md` · `final-gate`)은 고치지 않는다 — 갱신이 덮거나 멈추고 이식 검사가 ⛔. 키트를 바꿔야 하면 키트 관리 쪽에 제안한다: 무엇 · 왜(겪은 일) · 바꾸기 전후 결과 · 다른 설치에도 이득인가 · 확인 장치 · 비용 |

**승격은 한 방향 — 그래프·lessons → 규칙.** 기준: 「다음 세션이 이걸 안 읽으면 같은 실수를 하나」 — 그러면 규칙이다. 그래프에만 적은 행동은 다음 턴에 쓰이지 않는다.

실패를 고쳤으면 근본 원인과 함께 적는다. 분류: `누락된 컨텍스트` · `잘못된 도구` · `미흡한 권한` · `검증 부족` — ⛔ 근본 원인이 없으면 도구가 거부한다.

```bash
node .harness/tools/lesson-append.mjs <<'EOF'
{"symptom":"<무엇이 보였나>","cause":"<근본 원인>","category":"검증 부족","guard":"<막는 규칙·테스트 위치, 없으면 빈 문자열>"}
EOF
```

## 플러그인

플러그인은 **PC(사용자 범위)에서 켠다** — 이 프로젝트 설정에는 선언하지 않는다(공유 모드만 팀원 PC 용으로 superpowers 를 선언한다). superpowers 는 키트 마켓(`harness-kit`)이 실측한 커밋으로, ponytail 은 플러그인이 아니라 사용자 스킬 `ponytail-review` 하나로 둔다 — 관문이 쓰는 것은 `/ponytail-review` 뿐이다. 이 PC 가 맞지 않으면 아래가 맞출 명령을 낸다 — 이 PC 의 모든 프로젝트에 걸리므로 사용자에게 보여 주고 승인받은 뒤 실행한다:

```bash
node <harness-kit 경로>/tools/plugin-plan.mjs
```

ponytail 모드는 쓰지 않는다 — 코드를 바꾼 보고 직전 `final-gate` 에서 `/ponytail-review` 로만 부른다. 사용자가 ponytail 플러그인 끄기를 거절했으면 그 PC 의 전역 env 에 `PONYTAIL_DEFAULT_MODE=off` 를 두게 한다(모드가 superpowers 의 설계 · 질문 단계와 충돌한다).

# 하네스 — 증거와 기록

> 상태: **설계안** · harness-kit 이 설치했다. 도구는 `.harness/tools/`, 설정은 `.harness/harness.json`

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

계획이 있으면 그 마지막 태스크가 보고를 부르고, 없으면 보고가 곧 관문이다. 과설계 리뷰 · 완료 증거 · 기록이 한 세트다.

## 완료는 증거로 주장한다

⛔ 종료코드 0 · `BUILD SUCCESSFUL` · 러너의 `pass` 요약으로 통과를 주장하지 않는다 — 테스트가 0개여도 그렇게 나온다.

| 작업 | 증거 |
|---|---|
| 코드 변경 | `node .harness/tools/verify.mjs` — exit 0 (이번 실행이 쓴 결과 파일로 판정, 알려진 실패 기준선은 개수만) |
| 운영 데이터 · 설정 | 실행·확인 쿼리와 전/후 결과를 본문에 |
| 기록 변경 | `node .harness/tools/graph-find.mjs --check` — exit 0 |
| 조사 · 측정 | 정답 라벨 n건 대조 + 검증한 범위 |

⛔ `node .harness/tools/verify.mjs --baseline` 은 사용자가 「원래 있던 실패」라고 확인한 뒤에만 — 실패를 기준선에 넣으면 그 실패는 더 울리지 않는다.

## 장부 — 성격마다 하나

| 무엇 | 어디 |
|---|---|
| 사실 · 함정 · 인과 · 기각한 대안 한 줄 · 하다 만 것(`⏸`) | 그래프 — `.claude/rules/graph.md` |
| 묻지 않고 정한 가정 | `<decisions>` — `node .harness/tools/decision-check.mjs` (14일 묵으면 경고) |
| 반복 실패 (규칙이 되기 전) | `<lessons>` — `node .harness/tools/lesson-promote.mjs` 가 승격 후보를 낸다 |
| 행동을 바꿔야 하는 것 | 규칙(`.claude/rules/`) · 프로젝트 지도 |

**승격은 한 방향 — 그래프·lessons → 규칙.** 기준: 「다음 세션이 이걸 안 읽으면 같은 실수를 하나」 — 그러면 규칙이다. 그래프에만 적은 행동은 다음 턴에 쓰이지 않는다.

실패를 고쳤으면 근본 원인과 함께 적는다. 분류: `누락된 컨텍스트` · `잘못된 도구` · `미흡한 권한` · `검증 부족` — ⛔ 근본 원인이 없으면 도구가 거부한다.

```bash
node .harness/tools/lesson-append.mjs <<'EOF'
{"symptom":"<무엇이 보였나>","cause":"<근본 원인>","category":"검증 부족","guard":"<막는 규칙·테스트 위치, 없으면 빈 문자열>"}
EOF
```

진행 상태 대장을 쓰는 일이면 `node .harness/tools/state-check.mjs` 가 대장과 원본 해시를 대조한다.

## 플러그인

superpowers 와 ponytail 을 쓴다. 이 PC 에 없으면 — 범위는 설치 모드(`.harness/harness.json` 의 `mode`)를 따른다. 로컬 전용은 `--scope local`, 공유는 `--scope project`:

```bash
claude plugin install superpowers@claude-plugins-official --scope local
claude plugin marketplace add DietrichGebert/ponytail --scope local
claude plugin install ponytail@ponytail --scope local
```

다른 마켓의 같은 플러그인을 이미 쓰고 있으면 설치하지 말고 `.claude/settings.local.json` 의 `enabledPlugins` 에서 위 id 를 `false` 로 끈다.
ponytail 모드는 꺼져 있다(`PONYTAIL_DEFAULT_MODE=off`) — 코드를 바꾼 보고 직전 `final-gate` 에서 `/ponytail-review` 로만 부른다.

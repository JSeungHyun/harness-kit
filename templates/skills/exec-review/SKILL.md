---
name: exec-review
description: 검증 전용 — 지금 바뀐 코드에 verify 와 ponytail 과설계 리뷰만 돈다. 사용자가 /exec-review 로 부를 때만 쓴다
disable-model-invocation: true
hooks:
  Stop:
    - hooks:
        - type: command
          command: 'node "${CLAUDE_PROJECT_DIR}/.harness/tools/cycle-gate.mjs"'
          timeout: 30
---

# /exec-review — 검증만

대상: $ARGUMENTS (비면 작업 트리 diff, 없으면 직전 커밋)

설계 · 구현은 하지 않는다. ponytail 스킬은 **Skill 도구가 아니라 파일로 읽는다** — `node .harness/tools/cycle-skill.mjs ponytail ponytail-review` 가 낸 경로를 Read 한다(플러그인을 꺼 둬도 된다).

1. `node .harness/tools/verify.mjs` 를 exit 0 까지(실패면 고치고 다시).
2. 과설계 리뷰 — `ponytail ponytail-review` 를 대상 diff 에 적용한다. 지울 것은 반영하고 1 을 다시 한다.
3. 보고 — verify 마지막 줄 · 리뷰의 `net: -N lines possible.` 줄(또는 `Lean already.`) · 작업 파일 목록 · 그래프 기록(`graph.md` 그대로).

수정이 없어도 1 · 2 가 없으면 종료 훅(cycle-gate)이 되돌린다. 같은 이유로 막히면 사용자에게 묻는다.

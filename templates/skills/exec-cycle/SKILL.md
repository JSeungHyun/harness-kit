---
name: exec-cycle
description: 구현 사이클 — 설계 → 계획 → 구현 → verify → ponytail 과설계 리뷰 → 보고. 사용자가 /exec-cycle 로 부를 때만 쓴다
disable-model-invocation: true
hooks:
  Stop:
    - hooks:
        - type: command
          command: 'node "${CLAUDE_PROJECT_DIR}/.harness/tools/cycle-gate.mjs"'
          timeout: 30
---

# /exec-cycle — 구현 사이클

요청: $ARGUMENTS

단계를 건너뛰지 않는다. superpowers · ponytail 스킬은 **Skill 도구가 아니라 파일로 읽는다** — `node .harness/tools/cycle-skill.mjs <플러그인> <스킬>` 이 낸 경로를 Read 한다(플러그인을 꺼 둬도 된다). 스킬 본문이 다른 superpowers 스킬을 부르라고 하면 Skill 도구 대신 같은 도구로 그 파일을 읽는다.

1. 설계 — `superpowers brainstorming`. 사용자가 설계를 승인하기 전에는 구현하지 않는다.
2. 계획 — `superpowers writing-plans`.
3. 구현 — `superpowers executing-plans`. 이 세션이 직접 한다(서브에이전트 리뷰어 · 병렬 디스패치는 쓰지 않는다 — harness.md).
4. `node .harness/tools/verify.mjs` 를 exit 0 까지.
5. 과설계 리뷰 — `ponytail ponytail-review` 를 이번 diff 에 적용한다. 지울 것은 반영하고 4 를 다시 한다.
6. 보고 — verify 마지막 줄 · 리뷰의 `net: -N lines possible.` 줄(또는 `Lean already.`) · 작업 파일 목록 · 그래프 기록(`graph.md` 그대로).

코드를 고친 뒤 4 · 5 가 없으면 종료 훅(cycle-gate)이 되돌린다. 같은 이유로 막히면 사용자에게 묻는다.

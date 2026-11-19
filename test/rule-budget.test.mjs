import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoFile } from './scene.mjs';

// 설치가 읽는 키트 규칙은 질문마다 드는 비용이다 — harness · graph 는 세션마다, final-gate 는 불릴 때. 줄바꿈은 LF 로 세어 체크아웃마다 같게
const BUDGET = {
  'templates/rules/harness.md': 2700,
  'templates/rules/graph.md': 4750,
  'templates/skills/final-gate/SKILL.md': 2800,
};

test('키트 규칙 글자는 예산 안 — 늘리려면 plan 항목 비용: 에 이유를 적고 이 예산을 고친다', () => {
  for (const [rel, max] of Object.entries(BUDGET)) {
    const n = repoFile(rel).replace(/\r\n/g, '\n').length;
    assert.ok(n <= max, `${rel} ${n}자 > 예산 ${max} — 늘리려면 plan 항목 \`비용:\` 에 이유를 적고 이 예산을 고친다`);
  }
});

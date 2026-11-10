import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoFile } from './scene.mjs';

// ⛔ 는 되돌리기 어렵거나 파괴적인 금지(기준선 · 키트 파일 · 비밀값)에만 — 최신 모델은 과한 강조에 과민하다(14차 후보 8)
const CAP = {
  'templates/rules/harness.md': 3,
  'templates/rules/graph.md': 1,
  'templates/skills/final-gate/SKILL.md': 0,
};

test('⛔ 규칙 파일의 ⛔ 는 상한 안 — 늘리려면 되돌리기 어렵거나 파괴적인 금지인지 보고 이 상한을 고친다', () => {
  for (const [rel, cap] of Object.entries(CAP)) {
    const lines = repoFile(rel).split(/\r?\n/).filter((l) => l.includes('⛔'));
    const n = lines.join('').split('⛔').length - 1;
    assert.ok(n <= cap, `${rel} ⛔ ${n} > ${cap}\n${lines.join('\n')}`);
  }
});

test('남은 ⛔ 는 그 금지 자리에 있다 — 기준선 · 키트 파일 · 개인 식별자와 비밀값', () => {
  assert.match(repoFile('templates/rules/harness.md'), /^⛔ `node \.harness\/tools\/verify\.mjs --baseline`/m);
  assert.match(repoFile('templates/rules/harness.md'), /⛔ 키트 파일\(/);
  assert.match(repoFile('templates/rules/graph.md'), /⛔ \*\*개인 식별자/);
});

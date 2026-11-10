import { test } from 'node:test';
import assert from 'node:assert/strict';
import { target } from './scene.mjs';
import { custom } from '../tools/install-check.mjs';

test('맞춤 절의 장부 줄 수는 빈 줄을 뺀 수라고 밝힌다 — wc -l 과 헷갈리지 않게', () => {
  const dir = target({ state: { decisions: 'd.md', lessons: 'l.md' }, checks: [] },
    { 'd.md': '# 결정\n\n## Q1 · 가정\n\n\n', 'l.md': '# 교훈\n\n| L001 |\n' });
  assert.match(custom(dir), /^장부 d\.md 2줄 · l\.md 2줄 \(빈 줄 뺀 수\)$/m);
});

test('장부가 없으면 「장부 없음」 — 덧붙이지 않는다', () => {
  assert.match(custom(target({ checks: [] })), /^장부 없음$/m);
});

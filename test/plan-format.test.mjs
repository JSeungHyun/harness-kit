// 11차부터 plan.md 체크박스 항목은 확인 장치(강제:)와 결과 판정(판정(결과):)을 한 줄에 적는다 — 규칙만 둔 개선은 실제 설치에서 샜다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function missing(md, from = 11) {
  const out = [];
  let round = 0;
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^\*\*(\d+)차/);
    if (h) { round = Number(h[1]); continue; }
    if (/^## /.test(line)) round = 0;
    if (round >= from && /^- \[[ x]\]/.test(line) && !(line.includes('강제:') && line.includes('판정(결과):'))) out.push(line.slice(0, 60));
  }
  return out;
}

test('형식 검사는 확인 장치 · 결과 판정이 빠진 항목만 잡는다', () => {
  const md = '**11차 — 시험:**\n- [ ] 좋은 항목 — 강제: 훅 · 판정(결과): 대조\n- [ ] 규칙만 더함\n- 보류 체크박스 아님\n**10차 — 옛:**\n- [ ] 옛 항목';
  assert.deepEqual(missing(md), ['- [ ] 규칙만 더함']);
});

test('plan.md 11차부터 체크박스 항목은 강제: · 판정(결과): 를 적는다', () => {
  assert.deepEqual(missing(readFileSync(new URL('../docs/plan.md', import.meta.url), 'utf8')), []);
});

// 11차부터 plan.md 체크박스 항목은 확인 장치(강제:)와 결과 판정(판정(결과):)을 한 줄에 적는다 — 규칙만 둔 개선은 실제 설치에서 샜다
// 15차부터는 질문당 비용(비용: 훅 시간 · 주입 글자 · 규칙 글자 전후)도 — 차수마다 질문이 느려지고 토큰이 느는지 보이게
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
    if (round >= from && /^- \[[ x]\]/.test(line) && !(line.includes('강제:') && line.includes('판정(결과):') && (round < 15 || line.includes('비용:')))) out.push(line.slice(0, 60));
  }
  return out;
}

test('형식 검사는 확인 장치 · 결과 판정이 빠진 항목만 잡는다', () => {
  const md = '**11차 — 시험:**\n- [ ] 좋은 항목 — 강제: 훅 · 판정(결과): 대조\n- [ ] 규칙만 더함\n- 보류 체크박스 아님\n**10차 — 옛:**\n- [ ] 옛 항목';
  assert.deepEqual(missing(md), ['- [ ] 규칙만 더함']);
});

test('15차부터는 비용: 도 한 줄에 — 11~14차 항목은 그대로', () => {
  const md = '**14차 — 옛:**\n- [x] 옛 항목 — 강제: 시험 · 판정(결과): 대조\n**15차 — 시험:**\n- [ ] 비용 없음 — 강제: 시험 · 판정(결과): 대조\n- [ ] 좋은 항목 — 강제: 시험 · 판정(결과): 대조 · 비용: 훅 p90 +0ms';
  assert.deepEqual(missing(md), ['- [ ] 비용 없음 — 강제: 시험 · 판정(결과): 대조']);
});

test('plan.md 11차부터 체크박스 항목은 강제: · 판정(결과): 를(15차부터는 비용: 도) 적는다', () => {
  assert.deepEqual(missing(readFileSync(new URL('../docs/plan.md', import.meta.url), 'utf8')), []);
});

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

// 20차 — 바뀌는 「지금 값」은 그 숫자를 낸 자리 한 곳에만 둔다. 옮겨 적은 사본은 다음 차수에 낡는다
const doc = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/);
const stale = (lines, res) => lines.filter((l) => res.some((re) => re.test(l))).map((l) => l.slice(0, 80));
const TESTS = [/`npm test`\s*[\d,]+/, /[\d,]+\s*(개\s*)?통과/];
const RULE_CHARS = [/(harness\.md|graph\.md|SKILL\.md)`?\s*\(?[\d,]+자/];

test('「지금 값」 검사는 시험 수 · 규칙 파일 글자 수 꼴만 잡는다', () => {
  assert.deepEqual(stale(['`npm test` 338 통과', '시험 수는 `npm test` 로 본다', '종단 20/20 · 5회 중 1회'], TESTS), ['`npm test` 338 통과']);
  assert.deepEqual(stale(['`templates/rules/graph.md`(4,781자)로는', '`graph.md` 로는 잰 적이 없다', '세션 시작 규칙 | 3097자'], RULE_CHARS), ['`templates/rules/graph.md`(4,781자)로는']);
});

test('⛔ plan.md 실행 상태 줄에 시험 수 · 규칙 글자를 적지 않는다 — `npm test` · 장부로 본다', () => {
  const status = doc('docs/plan.md').filter((l) => l.startsWith('**실행 상태'));
  assert.equal(status.length, 1);
  assert.deepEqual(stale(status, [...TESTS, ...RULE_CHARS]), []);
});

test('⛔ 문서가 키트 규칙 파일의 글자 수를 옮겨 적지 않는다 — 낸 자리는 장부(devices.md)와 bench 표다', () => {
  for (const rel of ['README.md', 'SETUP.md', 'docs/structure.md', 'docs/design.md', 'docs/graph-port.md', 'docs/proof.md']) assert.deepEqual(stale(doc(rel), RULE_CHARS), [], rel);
});

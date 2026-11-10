// 훅 ⏸ 목록 상한 — 질의와 가장 겹치는 3건, 나머지는 건수와 --open 한 줄(14차 G1)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphInstall } from './scene.mjs';

const scene = (recs = []) => graphInstall(undefined, recs);
const lines = (s, prompt) => s.run('graph-hook', [], JSON.stringify({ prompt })).stdout.split(/\r?\n/);

const MAIN = { req: '정본: 배송 지연 알림 문자 발송 절차', terms: { 배송지연: 'delay_rule', 알림문자: 'sms_rule', 문자발송: 'sms_send' } };
const QUERY = '배송 지연 알림 문자 발송';

test('⭐ ⏸ 목록 — 4건 이상이면 질의와 가장 겹치는 3건만, 나머지는 건수와 --open 한 줄', () => {
  const strong = [1, 2, 3].map((i) => ({ req: `재시도 설계 ${i} — 배송 지연 알림 문자 발송`, date: `2026-09-0${i}`, terms: { 배송: `retry_${i}` }, note: `⏸ 강한 겹침 ${i}` }));
  // 약하게 겹치는 쪽이 더 최근이다 — 날짜가 아니라 겹침으로 고른다
  const weak = [1, 2].map((i) => ({ req: `보류 ${i} — 배송 지연 알림 문자 발송`, date: `2026-10-0${i}`, note: `⏸ 약한 겹침 ${i}` }));
  const out = lines(scene([MAIN, ...strong, ...weak]), QUERY);
  assert.ok(out.includes('⏸ 열린 작업 5건 — 이 주제에 **하다 만 기록**이 있다. 다시 조사하기 전에 이것부터 편다.'));
  const shown = out.filter((l) => l.startsWith('  ⏸ '));
  assert.equal(shown.length, 3);
  for (const r of strong) assert.ok(shown.includes(`  ⏸ ${r.date} ${r.req}`), r.req);
  assert.ok(!out.some((l) => l.includes('약한 겹침')));
  assert.ok(out.includes('  … 나머지 2건: node .harness/tools/graph-find.mjs --open'));
});

test('⏸ 목록 — 3건까지는 전부 내고 나머지 줄이 없다', () => {
  const open = [1, 2, 3].map((i) => ({ req: `재시도 설계 ${i} — 배송 지연 알림 문자 발송`, note: `⏸ 겹침 ${i}` }));
  const out = lines(scene([MAIN, ...open]), QUERY);
  assert.equal(out.filter((l) => l.startsWith('  ⏸ ')).length, 3);
  assert.ok(!out.some((l) => l.includes('… 나머지')));
});

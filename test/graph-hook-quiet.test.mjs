// 훅 「모르면 침묵 · 단서로 말하기」(21차) — 흔한 낱말 정확일치 · 제목 안 닿는 본문 합은 1단이 아니다 · 머리말은 단서
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { graphInstall } from './scene.mjs';

const hook = (recs, prompt) => graphInstall(undefined, recs).run('graph-hook', [], JSON.stringify({ prompt })).stdout;
const cards = (out) => out.split(/\r?\n/).filter((l) => l.startsWith('· ['));
const WEAK = /^\[그래프 자동조회\] 키워드로는 약하게만/;

const DICT = { req: '용어 사전: 평가 용어', terms: { 평가: 'eval_main' }, files: ['docs/eval.md'] };
const evalNotes = (n) => Array.from({ length: n }, (_, i) => ({ req: `평가 ${i + 1}차 회의 메모`, files: [`docs/m${i}.md`] }));
const filler = (n) => Array.from({ length: n }, (_, i) => ({ req: `배송 정리 ${i + 1}`, terms: { [`배송${i}`]: `ship_${i}` }, files: [`src/s${i}.mjs`] }));

test('⭐ 기록의 10% 넘게(최소 5건 초과) 걸리는 한글 낱말의 정확일치만으로는 1단 카드를 내지 않는다 — 색인으로', () => {
  const out = hook([DICT, ...evalNotes(9), ...filler(20)], '평가 업로드');
  assert.deepEqual(cards(out), []);
  assert.match(out, WEAK);
});

test('graph-measure 주제 측정의 「확신」은 훅 출력으로 센다 — 판정 규칙이 훅과 갈라지지 않는다', () => {
  const s = graphInstall(undefined, [DICT, ...evalNotes(9), ...filler(20)]);
  writeFileSync(join(s.dir, 'tickets.json'), JSON.stringify([{ title: '평가 업로드' }, { title: '배송3 문의' }]));
  assert.match(s.run('graph-measure', ['.']).stdout, /질의 2 · 확신 1 /);
});

test('흔한 낱말 하한 — 걸린 기록이 5건 이하면 비율이 커도 흔한 낱말이 아니다(작은 기록 보호)', () => {
  assert.ok(cards(hook([DICT, ...evalNotes(3), ...filler(4)], '평가 업로드')).length >= 1);
});

test('식별자 정확일치는 흔해도 1단이다', () => {
  const recs = [...evalNotes(12).map((r) => ({ ...r, terms: { 평가표: 'eval_data' } })), ...filler(10)];
  assert.ok(cards(hook(recs, 'eval_data 컬럼 확인')).length >= 1);
});

test('⭐ 본문 합 5점 이상이어도 제목에 질문 낱말이 2개 이상 닿아야 1단', () => {
  const note = '문자 발송 재시도 · 환불 지연 건';
  const off = { req: '정산 배치 점검', note, files: ['src/batch.mjs'] };
  const on = { req: '정산: 환불처리와 지연건 점검', note, files: ['src/batch.mjs'] };
  const q = '환불 지연 문자 발송 재시도';
  assert.deepEqual(cards(hook([off, ...filler(3)], q)), []);
  assert.equal(cards(hook([on, ...filler(3)], q)).length, 1);
});

test('제목에 닿은 낱말은 겹치는 토큰을 하나로 센다 — 「환불처리」와 그 어근 「환불」은 1개', () => {
  const rec = { req: '정산: 환불처리건 점검', note: '문자 발송 재시도 환불처리', files: ['src/batch.mjs'] };
  assert.deepEqual(cards(hook([rec, ...filler(3)], '환불처리 문자 발송 재시도')), []);
});

test('⭐ 1단 머리말은 「단서」다 — 「실측 · 추측으로 대체하지 않는다」 단정을 쓰지 않는다', () => {
  const out = hook([{ req: '정본: 환불 절차', terms: { 환불: 'refund_flow' }, files: ['src/refund.mjs'] }], '환불 절차');
  assert.match(out, /지난 작업의 단서다/);
  assert.match(out, /근거 위치를 한 번 열어 확인한다/);
  assert.doesNotMatch(out, /실측한 것이다|추측으로 대체하지 않는다/);
});

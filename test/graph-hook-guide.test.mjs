// 훅 길잡이형(25차) — 카드는 제목 · 핵심 파일 · 전문 명령뿐. 허브 파일 · 저장소에 없는 파일은 뺀다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphInstall, put } from './scene.mjs';

const GF = 'node .harness/tools/graph-find.mjs';
const run = (s, prompt) => s.run('graph-hook', [], JSON.stringify({ prompt })).stdout;
const lines = (out) => out.split(/\r?\n/);
const cards = (out) => lines(out).filter((l) => l.startsWith('· ['));
// 카드 i 의 제목 줄 밑 4칸 들여쓴 몸통
function body(out, i) {
  const ls = lines(out);
  const at = ls.flatMap((l, n) => (l.startsWith('· [') ? [n] : []))[i];
  assert.notEqual(at, undefined, `카드 ${i} 가 없다:\n${out}`);
  const b = [];
  for (let n = at + 1; /^ {4}\S/.test(ls[n] ?? ''); n++) b.push(ls[n]);
  return b;
}
const scene = (recs, files = []) => {
  const s = graphInstall(undefined, recs);
  for (const f of files) put(s.dir, f, '');
  return s;
};
const filler = (n, file) => Array.from({ length: n }, (_, i) => ({ req: `배송 정리 ${i + 1}`, terms: { [`배송${i}`]: `ship_${i}` }, files: [file ?? `src/s${i}.mjs`] }));

const TOP = { req: '환불 절차 수정', terms: { 환불: 'refund_flow', 반품: 'return_flag' }, note: '재시도는 3회까지다', files: ['src/a.mjs', 'src/b.mjs'] };

test('⭐ 카드 = 제목 · 핵심 파일 · 전문 명령 — 용어 · 함정 · 접은 키 줄이 없다', () => {
  const out = run(scene([TOP, ...filler(3)], ['src/a.mjs', 'src/b.mjs']), '환불 절차');
  assert.equal(cards(out).length, 1);
  assert.match(cards(out)[0], /^· \[이력 · \d+점\] 2026-09-01 환불 절차 수정$/);
  assert.deepEqual(body(out, 0), ['    src/a.mjs · src/b.mjs', '    전문: graph-find 환불']);
  assert.doesNotMatch(lines(out).slice(2).join('\n'), /refund_flow|함정|재시도는 3회|안 걸린 항목/);
});

test('⭐ 머리말은 두 줄 — 「기록으로 답하면 날짜와 볼까요」 · 「이름만 보이면 되묻지 말고 조회」', () => {
  const out = run(scene([TOP, ...filler(3)], ['src/a.mjs']), '환불 절차');
  const head = lines(out).filter((l) => l && !l.startsWith('·') && !l.startsWith('    '));
  assert.equal(head.length, 2, head.join('\n'));
  assert.match(head[0], /^\[그래프 자동조회\] 유사 기록 1건/);
  assert.ok(head[0].includes(`\`${GF} <키>\``), head[0]);
  assert.match(head[0], /되묻지 말고 조회/);
  assert.equal(head[1], '기록으로 답하면 답 끝에 기록 날짜와 「○○까지 볼까요?」를 붙인다.');
  assert.doesNotMatch(out, /탈출구|제거됨|평소대로 코드를 탐색한다|더 볼 것/);
});

test('⭐ 카드 파일은 3개까지 — 상한 · 카드는 2장까지', () => {
  const files = ['a', 'b', 'c', 'd', 'e'].map((x) => `src/${x}.mjs`);
  const recs = [1, 2, 3].map((i) => ({ req: `환불 절차 수정 ${i}`, terms: { 환불: `r${i}` }, files }));
  const out = run(scene([...recs, ...filler(4)], files), '환불 절차');
  assert.equal(cards(out).length, 2);
  for (const i of [0, 1]) assert.equal(body(out, i)[0], '    src/a.mjs · src/b.mjs · src/c.mjs');
});

test('⭐ 저장소에 없는 파일은 빼고 개수를 붙인다 — 남는 파일이 없으면 파일 줄 없이 안내만', () => {
  const rec = { ...TOP, files: ['src/gone1.mjs', 'src/a.mjs', 'src/gone2.mjs'] };
  const out = run(scene([rec, ...filler(3)], ['src/a.mjs']), '환불 절차');
  assert.deepEqual(body(out, 0), ['    src/a.mjs', '    (저장소에 없는 파일 2개 뺌)', '    전문: graph-find 환불']);
  assert.doesNotMatch(out, /gone/);
  const none = run(scene([{ ...TOP, files: ['src/gone1.mjs'] }, ...filler(3)]), '환불 절차');
  assert.deepEqual(body(none, 0), ['    (저장소에 없는 파일 1개 뺌)', '    전문: graph-find 환불']);
});

test('저장소에 없는 파일 판정은 줄번호를 떼고 본다', () => {
  const rec = { ...TOP, files: ['src/a.mjs:120', 'src/b.mjs:3-9'] };
  const out = run(scene([rec, ...filler(3)], ['src/a.mjs', 'src/b.mjs']), '환불 절차');
  assert.equal(body(out, 0)[0], '    src/a.mjs:120 · src/b.mjs:3-9');
});

test('⭐ 허브 파일 — 살아 있는 기록의 10% 넘게(최소 5건 초과) 나오는 파일은 카드에서 뺀다', () => {
  const hub = 'src/hub.mjs';
  const rec = { ...TOP, files: [hub, 'src/a.mjs'] };
  const crowd = filler(12, hub);
  const out = run(scene([rec, ...crowd], [hub, 'src/a.mjs']), '환불 절차');
  assert.deepEqual(body(out, 0), ['    src/a.mjs', '    전문: graph-find 환불']);
  assert.doesNotMatch(out, /hub\.mjs/);
});

test('허브 하한 — 5건 이하로 나오는 파일은 비율이 커도 허브가 아니다(작은 기록 보호)', () => {
  const rec = { ...TOP, files: ['src/shared.mjs', 'src/a.mjs'] };
  const out = run(scene([rec, ...filler(4, 'src/shared.mjs')], ['src/shared.mjs', 'src/a.mjs']), '환불 절차');
  assert.equal(body(out, 0)[0], '    src/shared.mjs · src/a.mjs');
});

test('허브 계산은 대체된 기록을 세지 않는다', () => {
  const hub = 'src/hub.mjs';
  const old = Array.from({ length: 12 }, (_, i) => ({ req: `옛 배송 ${i}`, files: [hub], terms: { [`옛${i}`]: 'x' } }));
  const newer = { req: '새 배송 정리', supersedes: old.map((r) => r.req), files: [] };
  const rec = { ...TOP, files: [hub, 'src/a.mjs'] };
  const out = run(scene([...old, newer, rec, ...filler(3)], [hub, 'src/a.mjs']), '환불 절차');
  assert.equal(body(out, 0)[0], '    src/hub.mjs · src/a.mjs');
});

test('⭐ 전문 키로 graph-find 를 부르면 그 기록이 나온다', () => {
  const s = scene([TOP, ...filler(3)], ['src/a.mjs', 'src/b.mjs']);
  const key = body(run(s, '환불 절차'), 0).find((l) => l.startsWith('    전문: graph-find ')).slice('    전문: graph-find '.length);
  assert.match(s.run('graph-find', [key]).stdout, /환불 절차 수정/);
});

test('정본이 1위면 1장 — 그 카드도 같은 모양이다', () => {
  const main = { req: '정본: 환불 절차', terms: { 환불: 'refund_flow' }, files: ['src/a.mjs'] };
  const out = run(scene([main, { ...TOP, req: '환불 절차 수정 이력' }, ...filler(3)], ['src/a.mjs']), '환불 절차');
  assert.equal(cards(out).length, 1);
  assert.match(cards(out)[0], /^· \[절차 · /);
  assert.deepEqual(body(out, 0), ['    src/a.mjs', '    전문: graph-find 환불']);
});

test('⭐ 용어 10개 · 긴 함정이 든 기록도 카드 두 장이 한 번에 700자 안이다', () => {
  const terms = Object.fromEntries([['환불', 'refund_main'], ...Array.from({ length: 10 }, (_, i) => [`환불${i}`, `refund_${i}_${'x'.repeat(100)}`])]);
  const recs = [1, 2].map((i) => ({ req: `환불 절차 수정 ${i}`, terms, note: '길다'.repeat(300), files: ['src/a.mjs', 'src/b.mjs', 'src/c.mjs'] }));
  const out = run(scene([...recs, ...filler(4)], ['src/a.mjs', 'src/b.mjs', 'src/c.mjs']), '환불 절차');
  assert.equal(cards(out).length, 2);
  assert.ok(out.length < 700, `${out.length}자`);
});

test('⭐ 열린 작업(⏸)은 제목 줄만 붙는다 — note 본문은 싣지 않는다', () => {
  const main = { ...TOP, req: '정본: 환불 절차 재시도 설계 보류' };
  const open = { req: '재시도 설계 — 환불 절차 재시도 설계 보류', note: '⏸ 큐까지 했다 — 재시도 횟수를 받으면 재개' };
  const out = run(scene([main, open, ...filler(3)], ['src/a.mjs']), '환불 절차 재시도 설계 보류');
  assert.equal(cards(out).length, 1);
  assert.match(out, /^⏸ 열린 작업 1건 — /m);
  assert.match(out, /^ {2}⏸ 2026-09-01 재시도 설계 — 환불 절차 재시도 설계 보류$/m);
  assert.doesNotMatch(out, /큐까지 했다|재시도 횟수를 받으면/);
});

test('전문 키 — 질문 낱말과 같은 용어 키가 부분 일치보다 먼저 · 공백이 든 키는 따옴표', () => {
  const exactLast = { req: '환불 절차 수정', terms: { 환불상태: 's', 환불: 'refund_flow' }, files: ['src/a.mjs'] };
  assert.match(run(scene([exactLast, ...filler(3)], ['src/a.mjs']), '환불 절차'), /전문: graph-find 환불$/m);
  const spaced = { req: '환불 절차 수정', terms: { '환불 정책': 'p' }, files: ['src/a.mjs'] };
  assert.match(run(scene([spaced, ...filler(3)], ['src/a.mjs']), '환불정책 절차'), /전문: graph-find "환불 정책"$/m);
});

test('전문 키 — 걸린 용어가 없으면 질문 낱말로', () => {
  const rec = { req: '환불 절차 수정', terms: { 다른것: 'x' }, files: ['src/a.mjs'] };
  assert.match(run(scene([rec, ...filler(3)], ['src/a.mjs']), '환불 절차 수정'), /전문: graph-find \S+$/m);
});

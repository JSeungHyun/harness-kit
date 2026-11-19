// proof/bench.mjs — 설치의 입력을 얼려 두고(--snapshot) 지금 키트 도구로 다시 돌려 기준 숫자와 견준다(--run). 설치 · 세션 기록은 합성
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphInstall, put, tmp } from './scene.mjs';
import { slug } from '../tools/graph-find.mjs';

const BENCH = fileURLToPath(new URL('../proof/bench.mjs', import.meta.url));
const TOOLS = fileURLToPath(new URL('../tools/', import.meta.url));

let clock = 0;
const at = () => new Date(Date.UTC(2026, 9, 1) + 60000 * clock++).toISOString();
const human = (content) => ({ type: 'user', message: { role: 'user', content }, origin: { kind: 'human' }, promptSource: 'typed', timestamp: at() });
const use = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] }, timestamp: at() });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

// 합성 설치 하나 + 그 설치의 세션 기록 + 빈 스냅숏 자리
function scene() {
  const s = graphInstall(null, [
    { req: '주문 취소 흐름', terms: { 주문취소: 'cancel_flow' }, files: ['src/order/cancel.mjs'] },
    { req: '환불 계산 규칙', terms: { 환불: 'refund_rule' }, files: ['src/order/refund.mjs'] },
  ]);
  put(s.dir, '.harness/harness.json', JSON.stringify({ checks: [{ id: 't', cmd: 'npm test', kind: 'exit-code', covers: ['src/**'] }] }));
  for (const f of ['cancel', 'refund']) put(s.dir, `src/order/${f}.mjs`, '');
  put(s.dir, '.claude/rules/harness.md', '규칙');
  const sessions = tmp('bench-sessions-');
  const folder = join(sessions, slug(resolve(s.dir)));
  // 1턴: 설치 안 파일을 고치고 끝(되돌림) · 2턴: 말만(통과) · 3턴: 침묵할 짧은 말
  put(folder, 'a.jsonl', jsonl([
    human('주문취소 어디서 막혀?'), use('e1', 'Edit', { file_path: join(s.dir, 'src', 'order', 'cancel.mjs') }),
    human('환불 규칙 설명해줘'), use('r1', 'Read', { file_path: 'src/order/refund.mjs' }),
    human('응'),
  ]));
  const home = tmp('bench-home-');
  const bench = (...args) => spawnSync(process.execPath, [BENCH, ...args, '--home', home, '--sessions', sessions], { encoding: 'utf8' });
  const snap = () => join(home, readdirSync(home)[0]);
  return { ...s, sessions, home, bench, snap };
}
// 표의 「지금」 칸 — 시간(ms) 줄은 뺀다
const rows = (out) => out.split('\n').filter((l) => /^\| /.test(l) && !/^\| 지표 /.test(l)).map((l) => l.split('|').map((c) => c.trim()));
const now = (out) => Object.fromEntries(rows(out).filter((c) => !/ms$/.test(c[3])).map((c) => [c[1], c[3]]));
const mutated = () => {
  const dir = join(tmp('bench-tools-'), 'tools');
  cpSync(TOOLS, dir, { recursive: true });
  const hook = readFileSync(join(dir, 'graph-hook.mjs'), 'utf8'), more = hook.replace('if (out) console.log(out);', 'if (out) console.log(out + out);');
  assert.notEqual(more, hook, '주입을 늘릴 자리를 못 찾았다');
  writeFileSync(join(dir, 'graph-hook.mjs'), more);
  return dir;
};

test('⭐ --snapshot 뒤 --run 은 원본(설치 · 세션 기록)을 다시 읽지 않는다 · 첫 --run 이 기준 숫자를 쓴다 · 두 번 돌려도 시간을 뺀 결과가 같다', () => {
  const s = scene();
  const snap = s.bench('--snapshot', s.dir);
  assert.equal(snap.status, 0, snap.stdout + snap.stderr);
  rmSync(s.dir, { recursive: true, force: true });
  rmSync(s.sessions, { recursive: true, force: true });
  const a = s.bench('--run');
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.match(a.stdout, /기준 숫자를 썼다/);
  const base = JSON.parse(readFileSync(join(s.snap(), 'baseline.json'), 'utf8'));
  assert.equal(base.metrics.promptSame.length, 3);
  assert.equal(base.metrics.check, 0, '얼릴 때 있던 경로는 원본이 사라져도 있다');
  assert.equal(base.metrics.rules, readFileSync(new URL('../templates/rules/harness.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n').length);
  // 설치 경로를 가리키던 편집이 얼린 자리에서도 그 설치의 코드로 읽힌다 — 되돌린 턴과 통과한 턴의 판정이 갈린다
  assert.equal(new Set(base.metrics.gateSame.map((x) => x.hash)).size, 2, JSON.stringify(base.metrics.gateSame));
  const b = s.bench('--run');
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.doesNotMatch(b.stdout, /기준 숫자를 썼다/);
  assert.deepEqual(now(b.stdout), now(a.stdout));
  assert.equal(now(b.stdout)['훅 출력 같음'], '3/3');
  assert.deepEqual(JSON.parse(readFileSync(join(s.snap(), 'baseline.json'), 'utf8')), base, '기준 숫자는 --accept 없이 덮이지 않는다');
});

test('⭐ 얼린 자리를 복사해 기록 파일 시각이 바뀌어도 --run 이 얼릴 때 시각으로 되돌린다 — 관문 훅이 그 시각을 턴 시각과 견준다(20차 복사본에서 관문 판정 93/100)', () => {
  const s = scene();
  const old = new Date(Date.UTC(2026, 8, 1));
  utimesSync(join(s.dir, '.harness/graph/requests.jsonl'), old, old);
  assert.equal(s.bench('--snapshot', s.dir).status, 0);
  const a = s.bench('--run');
  assert.equal(a.status, 0, a.stdout + a.stderr);
  utimesSync(join(s.snap(), 'install', '.harness/graph/requests.jsonl'), new Date(), new Date());
  const b = s.bench('--run');
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.equal(now(b.stdout)['관문 판정 같음'], '3/3');
});

test('⭐ 주입을 늘린 도구 폴더(--tools)면 exit 1 이고 다른 입력 id 를 낸다 · --accept 뒤에는 통과한다', () => {
  const s = scene();
  assert.equal(s.bench('--snapshot', s.dir).status, 0);
  assert.equal(s.bench('--run').status, 0);
  const worse = mutated();
  const bad = s.bench('--run', '--tools', worse);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /^\| 주입 평균 \|.*⛔/m);
  assert.match(bad.stdout, /^훅 출력 같음 — 다른 입력 2개: [0-9a-f]{10}, [0-9a-f]{10}$/m);
  const accept = s.bench('--run', '--tools', worse, '--accept');
  assert.equal(accept.status, 0, accept.stdout + accept.stderr);
  const after = s.bench('--run', '--tools', worse);
  assert.equal(after.status, 0, after.stdout + after.stderr);
  assert.equal(now(after.stdout)['훅 출력 같음'], '3/3');
});

test('--snapshot — 이미 얼린 설치는 --force 없이 덮지 않는다(기준 숫자가 같이 사라진다) · 사본이 상한을 넘으면 큰 세션 기록부터 빼고 그렇게 적는다', () => {
  const s = scene();
  assert.equal(s.bench('--snapshot', s.dir).status, 0);
  const again = s.bench('--snapshot', s.dir);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /--force/);
  const folder = join(s.sessions, readdirSync(s.sessions)[0]);
  put(folder, 'big.jsonl', jsonl([human('큰 기록'), use('r9', 'Read', { file_path: 'x'.repeat(2 << 20) })]));
  const small = s.bench('--snapshot', s.dir, '--force', '--max-mb', '1');
  assert.equal(small.status, 0, small.stdout + small.stderr);
  assert.match(small.stdout, /상한 1MB 를 넘어 뺀 세션 기록 1개/);
  assert.deepEqual(readdirSync(join(s.snap(), 'gate')), ['a.jsonl']);
  assert.equal(JSON.parse(readFileSync(join(s.snap(), 'meta.json'), 'utf8')).dropped, 1);
});

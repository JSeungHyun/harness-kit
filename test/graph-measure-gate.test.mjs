// graph-measure --gate — 사람 턴이 끝날 때마다 그때까지 잘린 세션 기록으로 관문 훅을 실제로 띄워 시간 · 되돌림을 잰다. 기록 줄은 실제 세션 기록 모양을 본뜬 합성
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, put, repoFile } from './scene.mjs';

const human = (text) => ({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } });
const use = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, content, more = {}) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] }, ...more });
const edit = (id) => use(id, 'Edit', { file_path: 'src/a.mjs' });
const skill = (id, name) => use(id, 'Skill', { skill: name });
const verify = (id) => use(id, 'Bash', { command: 'node .harness/tools/verify.mjs' });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

// 설치본처럼 <대상>/.harness/tools/ 에 둔다 — 관문 훅은 자기 위치로 harness.json 을 찾는다
function install() {
  const dir = tmp('gate-measure-');
  for (const f of ['graph-measure', 'graph-find', 'gate-hook']) put(dir, `.harness/tools/${f}.mjs`, repoFile(`tools/${f}.mjs`));
  put(dir, '.harness/harness.json', JSON.stringify({ checks: [{ id: 't', cmd: 'npm test', kind: 'junit-xml', evidence: 'r', covers: ['src/**'] }] }));
  const run = (...args) => spawnSync(process.execPath, [join(dir, '.harness', 'tools', 'graph-measure.mjs'), ...args], { cwd: dir, encoding: 'utf8' });
  return { dir, run };
}
const row = (out, name) => out.split('\n').find((l) => l.startsWith(`| ${name} |`))?.split('|').map((c) => c.trim());

// 1턴: 고치고 verify 만(되돌림) · 2턴: 말만 + 1.2MB 도구 결과(통과) · 3턴: 증거 세트를 다 채움(통과)
const THREE = [
  human('고쳐줘'), edit('e1'), skill('p1', 'ponytail-review'), verify('v1'),
  human('설명해줘'), use('r1', 'Read', { file_path: 'src/a.mjs' }), result('r1', 'x'.repeat(1_200_000)),
  human('다시 고쳐줘'), edit('e2'), skill('g1', 'final-gate'), skill('p2', 'ponytail-review'), verify('v2'),
];

test('⭐ --gate — 턴 끝마다 그때까지의 기록만 훅에 준다: 되돌림은 1턴뿐이고, 크기 구간은 잘린 크기로 나뉜다', () => {
  const s = install();
  put(s.dir, 'sessions/a.jsonl', jsonl(THREE));
  for (const path of ['sessions', 'sessions/a.jsonl']) {
    const r = s.run('--gate', path);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    // 전체 기록을 세 번 주면 마지막 턴만 판정돼 되돌림이 0 이다
    assert.deepEqual(row(r.stdout, '전체')?.slice(2, 3).concat(row(r.stdout, '전체')?.[5]), ['3', '1'], r.stdout);
    assert.deepEqual([row(r.stdout, '<1MB')?.[2], row(r.stdout, '<1MB')?.[5]], ['1', '1'], r.stdout);
    assert.deepEqual([row(r.stdout, '1~4MB')?.[2], row(r.stdout, '1~4MB')?.[5]], ['2', '0'], r.stdout);
    assert.match(row(r.stdout, '전체')?.[3] ?? '', /^\d+ms$/);
    assert.match(row(r.stdout, '전체')?.[4] ?? '', /^\d+ms$/);
  }
});

test('--gate — 서브에이전트 기록(<기록 이름>/subagents/)도 훅에 보인다', () => {
  const s = install();
  put(s.dir, 'sessions/a.jsonl', jsonl([human('맡겨줘'), use('a1', 'Agent', { prompt: '고쳐' }), result('a1', '끝', { toolUseResult: { status: 'completed', agentId: 'x1' } })]));
  put(s.dir, 'sessions/a/subagents/agent-x1.jsonl', jsonl([edit('e1')]));
  const r = s.run('--gate', 'sessions/a.jsonl');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(row(r.stdout, '전체')?.[5], '1', r.stdout);
  // 잇기만 한 원본 폴더는 재생 뒤에도 그대로다
  assert.equal(existsSync(join(s.dir, 'sessions/a/subagents/agent-x1.jsonl')), true);
});

test('--gate --baseline — 두 판을 같은 잘린 기록에 띄워 판정 같음 n/N 을 낸다', () => {
  const s = install();
  put(s.dir, 'sessions/a.jsonl', jsonl(THREE));
  // 기준선: 늘 통과하는 훅 — 같은 harness.json 옆에 둔다
  put(s.dir, '.harness/base/gate-hook.mjs', "process.stdin.resume().on('end', () => process.exit(0));\n");
  const r = s.run('--gate', 'sessions/a.jsonl', '--baseline', '.harness/base');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const all = row(r.stdout, '전체');
  assert.equal(all?.[5], '0 → 1', r.stdout);
  assert.equal(all?.[6], '2/3', r.stdout);
});

test('--gate --limit — 턴 끝을 고르게 N개만 잰다', () => {
  const s = install();
  put(s.dir, 'sessions/a.jsonl', jsonl(Array.from({ length: 9 }, (_, i) => [human(`질문 ${i}`), use(`r${i}`, 'Read', { file_path: 'src/a.mjs' })]).flat()));
  const r = s.run('--gate', 'sessions/a.jsonl', '--limit', '4');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(row(r.stdout, '전체')?.[2], '4', r.stdout);
  assert.match(r.stdout, /턴 끝 9/);
});

test('--gate — 사람 턴이 없는 기록이면 exit 1 (조용한 0 은 「시간 0」으로 오독된다)', () => {
  const s = install();
  put(s.dir, 'sessions/a.jsonl', jsonl([{ type: 'summary', summary: 'x' }]));
  const r = s.run('--gate', 'sessions/a.jsonl');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /⛔ 사람 턴/);
});

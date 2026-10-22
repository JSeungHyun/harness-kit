import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmp, put } from './scene.mjs';

const TOOL = fileURLToPath(new URL('../tools/gate-hook.mjs', import.meta.url));

const human = (text) => ({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } });
const use = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const verify = (id) => use(id, 'Bash', { command: 'node .harness/tools/verify.mjs' });
const gate = (id) => use(id, 'Skill', { skill: 'final-gate' });
const edit = (id) => use(id, 'Edit', { file_path: 'src/a.mjs' });

function stop(lines, extra = {}) {
  const dir = tmp('gate-');
  put(dir, 't.jsonl', lines.map((l) => JSON.stringify(l)).join('\n'));
  const input = JSON.stringify({ transcript_path: `${dir}/t.jsonl`, stop_hook_active: false, background_tasks: [], ...extra });
  return spawnSync(process.execPath, [TOOL], { input, encoding: 'utf8' });
}
const blocked = (r) => (r.stdout.trim() ? JSON.parse(r.stdout).decision === 'block' : false);

test('⭐ 이번 턴에 verify 를 돌리고 final-gate 를 거치지 않았으면 되돌려 보낸다', () => {
  const r = stop([human('고쳐줘'), edit('e1'), verify('v1')]);
  assert.equal(r.status, 0);
  assert.equal(blocked(r), true);
  assert.match(JSON.parse(r.stdout).reason, /final-gate/);
  // -p 와 옛 버전의 기록에는 origin 이 없다
  assert.equal(blocked(stop([{ type: 'user', message: { content: '고쳐줘' } }, verify('v1')])), true);
});

test('final-gate 를 거쳤으면 — 그 안에서 verify 를 돌렸어도 — 통과한다', () => {
  assert.equal(blocked(stop([human('고쳐줘'), edit('e1'), gate('g1'), verify('v1')])), false);
  assert.equal(blocked(stop([human('/final-gate'), verify('v1')])), false);
});

test('verify 가 없는 턴 · 지난 턴의 verify · --baseline 은 보지 않는다', () => {
  assert.equal(blocked(stop([human('설명해줘')])), false);
  assert.equal(blocked(stop([human('고쳐줘'), verify('v1'), human('고마워')])), false);
  assert.equal(blocked(stop([human('기준선'), use('b1', 'Bash', { command: 'node .harness/tools/verify.mjs --baseline' })])), false);
});

test('⛔ 백그라운드 작업을 기다리는 멈춤 · 이미 되돌린 멈춤은 보지 않는다 — 진행 보고마다 울리면 신호가 아니다', () => {
  assert.equal(blocked(stop([human('고쳐줘'), verify('v1')], { background_tasks: [{ id: 'a1' }] })), false);
  assert.equal(blocked(stop([human('고쳐줘'), verify('v1')], { stop_hook_active: true })), false);
});

test('깨진 입력은 조용히 통과한다 — 종료를 막지 않는다', () => {
  const r = spawnSync(process.execPath, [TOOL], { input: '{"transcript_path":"없는/파일.jsonl"}', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

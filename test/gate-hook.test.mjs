import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmp, put, repoFile } from './scene.mjs';

const TOOL = fileURLToPath(new URL('../tools/gate-hook.mjs', import.meta.url));
// 설치본처럼 <대상>/.harness/tools/ 에 두고 돌린다 — 훅은 자기 위치로 harness.json 을 찾는다
const COVERED = [{ id: 't', cmd: 'npm test', kind: 'junit-xml', evidence: 'r', covers: ['src/**'] }];

const human = (text) => ({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } });
const use = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const verify = (id) => use(id, 'Bash', { command: 'node .harness/tools/verify.mjs' });
const gate = (id) => use(id, 'Skill', { skill: 'final-gate' });
const review = (id, skill = 'ponytail-review') => use(id, 'Skill', { skill });
const edit = (id, file_path = 'src/a.mjs', name = 'Edit') => use(id, name, { file_path });

// Agent 호출의 결과 줄 — 실측 기록(2.1.31x)의 toolUseResult.agentId 모양 그대로
const agentDone = (id, agentId) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '끝' }] }, toolUseResult: { status: 'completed', agentId } });

// subs: { agentId: [기록 줄] } — 서브에이전트 기록은 <메인 기록 이름>/subagents/agent-<id>.jsonl 에 있다(메모리 실측)
function stop(lines, extra = {}, checks = COVERED, subs = {}) {
  const dir = tmp('gate-');
  put(dir, '.harness/tools/gate-hook.mjs', repoFile('tools/gate-hook.mjs'));
  put(dir, '.harness/harness.json', JSON.stringify({ checks }));
  put(dir, 't.jsonl', lines.map((l) => JSON.stringify(l)).join('\n'));
  for (const [id, sub] of Object.entries(subs)) put(dir, `t/subagents/agent-${id}.jsonl`, sub.map((l) => JSON.stringify(l)).join('\n'));
  const input = JSON.stringify({ transcript_path: `${dir}/t.jsonl`, stop_hook_active: false, background_tasks: [], ...extra });
  return spawnSync(process.execPath, [join(dir, '.harness', 'tools', 'gate-hook.mjs')], { input, encoding: 'utf8' });
}
const blocked = (r) => (r.stdout.trim() ? JSON.parse(r.stdout).decision === 'block' : false);
// 이유문 첫 줄 — 빠진 것만 나열한다
const missing = (r) => (blocked(r) ? JSON.parse(r.stdout).reason.split('\n')[0].replace(/^\[관문\] 이번 턴에 빠진 것: /, '').split(' · ').map((s) => s.split(' ')[0]) : []);

test('⭐ 이번 턴에 verify 를 돌리고 final-gate 를 거치지 않았으면 되돌려 보낸다', () => {
  const r = stop([human('고쳐줘'), edit('e1'), review('p1'), verify('v1')]);
  assert.equal(r.status, 0);
  assert.equal(blocked(r), true);
  assert.deepEqual(missing(r), ['final-gate']);
  // -p 와 옛 버전의 기록에는 origin 이 없다
  assert.equal(blocked(stop([{ type: 'user', message: { content: '고쳐줘' } }, verify('v1')])), true);
});

test('final-gate 를 거쳤으면 — 그 안에서 verify 를 돌렸어도 — 통과한다', () => {
  assert.equal(blocked(stop([human('고쳐줘'), edit('e1'), gate('g1'), review('p1'), verify('v1')])), false);
  assert.equal(blocked(stop([human('/final-gate'), verify('v1')])), false);
});

test('⭐ 코드를 바꿨으면 ponytail-review 가 증거 세트에 든다 — final-gate 만으로는 통과하지 않는다(사용자 결정 11-09)', () => {
  assert.deepEqual(missing(stop([human('고쳐줘'), edit('e1'), gate('g1'), verify('v1')])), ['/ponytail-review']);
  // 플러그인 접두어가 붙은 이름도 받는다
  assert.equal(blocked(stop([human('고쳐줘'), edit('e1'), gate('g1'), review('p1', 'ponytail:ponytail-review'), verify('v1')])), false);
  // Write · NotebookEdit 도 코드 변경이다
  assert.deepEqual(missing(stop([human('만들어줘'), edit('w1', 'src/new.mjs', 'Write'), gate('g1'), verify('v1')])), ['/ponytail-review']);
  assert.deepEqual(missing(stop([human('고쳐줘'), use('n1', 'NotebookEdit', { notebook_path: 'src/a.ipynb' }), gate('g1'), verify('v1')])), ['/ponytail-review']);
});

test('⭐ 바꾼 코드를 덮는 검사(covers)가 없으면 code-review 가 증거 세트에 든다', () => {
  const bare = [{ id: 't', cmd: 'npm test', kind: 'exit-code' }];
  const r = stop([human('고쳐줘'), edit('e1'), gate('g1'), review('p1'), verify('v1')], {}, bare);
  assert.deepEqual(missing(r), ['/code-review']);
  assert.match(JSON.parse(r.stdout).reason, /src\/a\.mjs/);
  // covers 가 있어도 그 파일을 덮지 않으면 같다 · 접두어 붙은 이름도 받는다
  assert.deepEqual(missing(stop([human('고쳐줘'), edit('e1', 'server/A.java'), gate('g1'), review('p1'), verify('v1')])), ['/code-review']);
  assert.equal(blocked(stop([human('고쳐줘'), edit('e1', 'server/A.java'), gate('g1'), review('p1'), review('c1', 'code-review:code-review'), verify('v1')])), false);
});

test('⭐ 덮는 검사가 있으면 마지막 코드 변경 뒤의 verify 가 증거 세트에 든다 — 과설계 리뷰로 걷어낸 뒤의 회귀', () => {
  assert.deepEqual(missing(stop([human('고쳐줘'), edit('e1'), verify('v1'), gate('g1'), review('p1'), edit('e2')])), ['verify']);
  assert.equal(blocked(stop([human('고쳐줘'), edit('e1'), verify('v1'), gate('g1'), review('p1'), edit('e2'), verify('v2')])), false);
  // 덮는 검사가 없는 파일만 바꿨으면 verify 를 다시 요구하지 않는다 — 그 검사는 그 코드를 돌리지 않는다
  assert.equal(blocked(stop([human('고쳐줘'), edit('e1'), verify('v1'), gate('g1'), review('p1'), edit('e2', 'web/a.jsp'), review('c1', 'code-review')])), false);
});

test('빠진 것만 한 줄에 나열한다', () => {
  const bare = [{ id: 't', cmd: 'npm test', kind: 'exit-code' }];
  assert.deepEqual(missing(stop([human('고쳐줘'), edit('e1'), verify('v1')], {}, bare)), ['/ponytail-review', '/code-review', 'final-gate']);
});

test('문서 · .harness · .claude · 프로젝트 밖 파일만 바꾼 턴은 코드 변경이 아니다', () => {
  const lines = [human('정리해줘'), edit('d1', 'docs/guide.md'), edit('d2', 'README.md'), edit('d3', '.harness/harness.json', 'Write'),
    edit('d4', '.claude/rules/harness.md'), edit('d5', join(tmp('scratch-'), 'probe.mjs'), 'Write')];
  assert.equal(blocked(stop(lines)), false);
  assert.equal(blocked(stop([...lines, verify('v1'), gate('g1')])), false);
});

test('.json 설정 파일만 바꾼 턴은 코드 변경이다 — 설정도 동작을 바꾼다', () => {
  assert.deepEqual(missing(stop([human('설정 바꿔줘'), edit('j1', 'tsconfig.json'), gate('g1'), verify('v1')])), ['/ponytail-review', '/code-review']);
});

test('verify 가 없는 턴 · 지난 턴의 verify · --baseline 은 보지 않는다', () => {
  assert.equal(blocked(stop([human('설명해줘')])), false);
  assert.equal(blocked(stop([human('고쳐줘'), verify('v1'), human('고마워')])), false);
  assert.equal(blocked(stop([human('고쳐줘'), edit('e1'), review('p1'), verify('v1'), gate('g1'), human('고마워')])), false);
  assert.equal(blocked(stop([human('기준선'), use('b1', 'Bash', { command: 'node .harness/tools/verify.mjs --baseline' })])), false);
});

// Stop 입력의 background_tasks 원소 — 2.1.319 실측 덤프의 모양 그대로
const agentTask = { id: 'a59917971ae060e7f', type: 'subagent', status: 'running', description: '조사', agent_type: 'general-purpose' };
const shellTask = (command) => ({ id: 'bmovat4zq', type: 'shell', status: 'running', description: '백그라운드 명령', command });

test('⛔ 결과를 기다리는 멈춤 · 이미 되돌린 멈춤은 보지 않는다 — 진행 보고마다 울리면 신호가 아니다', () => {
  assert.equal(blocked(stop([human('고쳐줘'), verify('v1')], { background_tasks: [agentTask] })), false);
  assert.equal(blocked(stop([human('고쳐줘'), verify('v1')], { background_tasks: [shellTask('node .harness/tools/verify.mjs')] })), false);
  assert.equal(blocked(stop([human('고쳐줘'), verify('v1')], { stop_hook_active: true })), false);
});

test('⛔ 코드 변경으로 빠진 것이 있어도 이미 되돌린 멈춤은 울리지 않는다 — 한 번만 되돌린다', () => {
  const lines = [human('고쳐줘'), edit('e1')];
  assert.equal(blocked(stop(lines)), true);
  assert.equal(blocked(stop(lines, { stop_hook_active: true })), false);
});

test('모르는 background_tasks.type 은 기다림으로 본다 — 새 작업 종류가 생겨도 진행 보고마다 울리지 않는다', () => {
  assert.equal(blocked(stop([human('고쳐줘'), verify('v1')], { background_tasks: [{ id: 'w1', type: 'workflow', status: 'running' }] })), false);
});

test('⛔ command 가 없는 shell 원소는 상주로 본다 — verify 인지 모르면 예외로 두지 않는다', () => {
  const { command, ...noCommand } = shellTask('x');
  assert.equal(blocked(stop([human('고쳐줘'), verify('v1')], { background_tasks: [noCommand] })), true);
});

test('⭐ 상주 프로세스(개발 서버)만 떠 있는 멈춤은 예외가 아니다 — 하루 멈춤 10번에 0번 울렸다(plan 11차)', () => {
  const server = shellTask('mvn spring-boot:run');
  assert.equal(blocked(stop([human('고쳐줘'), verify('v1')], { background_tasks: [server] })), true);
  // 결과를 기다리는 작업이 같이 돌면 예외다
  assert.equal(blocked(stop([human('고쳐줘'), verify('v1')], { background_tasks: [server, agentTask] })), false);
});

test('⭐ 서브에이전트가 바꾼 코드도 증거 세트에 든다 — 이번 턴 Agent 호출의 기록에서 Edit · Write · NotebookEdit 을 합친다(12차)', () => {
  const sub = { x1: [edit('s1', 'src/b.mjs'), edit('s2', 'docs/b.md', 'Write')] };
  const call = [use('a1', 'Agent', { prompt: '구현' }), agentDone('a1', 'x1')];
  assert.deepEqual(missing(stop([human('구현해줘'), ...call, gate('g1'), verify('v1')], {}, COVERED, sub)), ['/ponytail-review']);
  assert.equal(blocked(stop([human('구현해줘'), ...call, gate('g1'), review('p1'), verify('v1')], {}, COVERED, sub)), false);
  // 서브에이전트의 변경은 그 Agent 호출 자리에서 일어났다 — 그 앞의 verify 는 마지막 변경 뒤가 아니다
  assert.deepEqual(missing(stop([human('구현해줘'), verify('v0'), ...call, gate('g1'), review('p1')], {}, COVERED, sub)), ['verify']);
});

test('서브에이전트 기록을 못 찾으면 조용히 메인 기록만 본다 — 지난 턴의 Agent 는 보지 않는다', () => {
  const r = stop([human('구현해줘'), use('a1', 'Agent', { prompt: '구현' }), agentDone('a1', 'x9'), gate('g1'), verify('v1')]);
  assert.equal(r.status, 0);
  assert.equal(blocked(r), false);
  const sub = { x1: [edit('s1', 'src/b.mjs')] };
  assert.equal(blocked(stop([human('구현해줘'), use('a1', 'Agent', { prompt: '구현' }), agentDone('a1', 'x1'), human('고마워')], {}, COVERED, sub)), false);
});

test('깨진 입력은 조용히 통과한다 — 종료를 막지 않는다', () => {
  const r = spawnSync(process.execPath, [TOOL], { input: '{"transcript_path":"없는/파일.jsonl"}', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

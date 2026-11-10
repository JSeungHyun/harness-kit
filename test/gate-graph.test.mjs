import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, put, repoFile } from './scene.mjs';

// 관문 훅의 그래프 칸(14차 G3) — 코드를 바꾼 턴은 기록(기록 파일이 이 턴에 바뀌었고 그 뒤에 끝난 --check) 또는 「그래프: 기록 안 함 — <이유>」 한 줄
const COVERED = [{ id: 't', cmd: 'npm test', kind: 'junit-xml', evidence: 'r', covers: ['src/**'] }];
const T = Date.parse('2026-11-10T01:00:00Z');
const at = (s) => new Date(T + s * 1000).toISOString();
const human = (text) => ({ type: 'user', origin: { kind: 'human' }, timestamp: at(0), message: { role: 'user', content: text } });
const use = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
// 도구 결과 줄 — 시각은 그 명령이 끝난 때
const result = (id, s) => ({ type: 'user', timestamp: at(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const bash = (id, command) => use(id, 'Bash', { command });
const edit = (id, file_path = 'src/a.mjs') => use(id, 'Edit', { file_path });
const check = (id, s) => [bash(id, 'node .harness/tools/graph-find.mjs --check; echo "exit=$?"'), result(id, s)];
// 그래프 칸 밖의 증거는 다 갖춘 턴
const done = [edit('e1'), use('p1', 'Skill', { skill: 'ponytail-review' }), bash('v1', 'node .harness/tools/verify.mjs'), use('g1', 'Skill', { skill: 'final-gate' })];
const MARK = '그래프: 기록 안 함 — 화면 문구만 바꿨다';

// store: 기록 파일 경로(null 이면 그래프를 쓰지 않는 설치) · wrote: 기록 파일을 고친 시각(턴 시작 기준 초 — 음수면 지난 턴) · graph: harness.json graph 칸
function stop(lines, { store = '.harness/graph/requests.jsonl', wrote = -60, graph, extra = {} } = {}) {
  const dir = tmp('gate-graph-');
  put(dir, '.harness/tools/gate-hook.mjs', repoFile('tools/gate-hook.mjs'));
  put(dir, '.harness/harness.json', JSON.stringify({ checks: COVERED, ...(graph ? { graph } : {}) }));
  if (store) {
    put(dir, store, '{"req":"주문 취소"}\n');
    utimesSync(join(dir, store), (T + wrote * 1000) / 1000, (T + wrote * 1000) / 1000);
  }
  put(dir, 't.jsonl', lines.map((l) => JSON.stringify(l)).join('\n'));
  const input = JSON.stringify({ transcript_path: `${dir}/t.jsonl`, stop_hook_active: false, background_tasks: [], ...extra });
  return spawnSync(process.execPath, [join(dir, '.harness', 'tools', 'gate-hook.mjs')], { input, encoding: 'utf8' });
}
const reason = (r) => (r.stdout.trim() ? JSON.parse(r.stdout).reason.split('\n')[0] : '');

test('⭐ 코드를 바꾸고 기록도 표식도 없으면 되돌린다 — 다른 증거를 다 갖춰도', () => {
  const r = stop([human('고쳐줘'), ...done, say('끝났다')]);
  assert.equal(r.status, 0);
  assert.equal(reason(r), '[관문] 이번 턴에 빠진 것: 그래프 기록 또는 「그래프: 기록 안 함 — <이유>」 한 줄');
});

test('⭐ 마지막 답에 「그래프: 기록 안 함 — <이유>」 한 줄이 있으면 통과한다 — 머리말만 본다', () => {
  assert.equal(stop([human('고쳐줘'), ...done, say(`보고\n${MARK}`)]).stdout, '');
  assert.equal(stop([human('고쳐줘'), ...done, say(`- ${MARK}`)]).stdout, '');
  // 기록 파일이 늦게 쓰여도 Stop 입력의 마지막 답으로 본다
  assert.equal(stop([human('고쳐줘'), ...done], { extra: { last_assistant_message: `보고\n${MARK}` } }).stdout, '');
});

test('⛔ 이유가 없는 표식 · 줄 가운데의 표식 · 앞선 답의 표식은 표식이 아니다', () => {
  assert.match(reason(stop([human('고쳐줘'), ...done, say('그래프: 기록 안 함')])), /그래프 기록 또는/);
  assert.match(reason(stop([human('고쳐줘'), ...done, say(`이번에는 ${MARK}`)])), /그래프 기록 또는/);
  assert.match(reason(stop([human('고쳐줘'), say(MARK), ...done, say('끝났다')])), /그래프 기록 또는/);
});

test('⭐ 이번 턴에 기록 파일이 바뀌었고 그 뒤에 끝난 --check 가 있으면 통과한다 — 쓰는 길(append · alias · 스크립트 · 서브에이전트)은 가리지 않는다', () => {
  assert.equal(stop([human('고쳐줘'), ...done, ...check('c1', 20), say('끝났다')], { wrote: 10 }).stdout, '');
  // 고치고 같은 명령에서 --check — 결과 줄 시각이 고친 뒤다
  assert.equal(stop([human('고쳐줘'), ...done, bash('c1', 'node prog.mjs && node .harness/tools/graph-find.mjs --check'), result('c1', 20)], { wrote: 15 }).stdout, '');
});

test('⛔ 기록 파일이 바뀌었는데 그 뒤에 끝난 --check 가 없으면 되돌린다 — 표식으로 갈음하지 않는다', () => {
  assert.equal(reason(stop([human('고쳐줘'), ...done, say(MARK)], { wrote: 10 })), '[관문] 이번 턴에 빠진 것: graph-find --check (그래프 기록 뒤)');
  assert.match(reason(stop([human('고쳐줘'), ...done, ...check('c1', 5)], { wrote: 10 })), /graph-find --check/);
  // 그래프 검색은 --check 가 아니다
  assert.match(reason(stop([human('고쳐줘'), ...done, bash('f1', 'node .harness/tools/graph-find.mjs 취소'), result('f1', 20)], { wrote: 10 })), /graph-find --check/);
});

test('그래프 기록이 없는 설치는 이 칸을 건너뛴다 · graph.store 가 있으면 그 기록을 본다', () => {
  assert.equal(stop([human('고쳐줘'), ...done], { store: null }).stdout, '');
  assert.equal(stop([human('고쳐줘'), ...done], { store: null, graph: { store: 'data/graph.jsonl' } }).stdout, '');
  assert.match(reason(stop([human('고쳐줘'), ...done], { store: 'data/graph.jsonl', graph: { store: 'data/graph.jsonl' } })), /그래프 기록 또는/);
});

test('코드를 바꾸지 않은 턴에는 그래프 칸이 없다', () => {
  assert.equal(stop([human('설명해줘'), say('답')]).stdout, '');
  assert.equal(stop([human('정리해줘'), edit('d1', 'docs/guide.md'), bash('v1', 'node .harness/tools/verify.mjs'), use('g1', 'Skill', { skill: 'final-gate' })]).stdout, '');
});

test('⭐ 기록 위치를 따로 둔 설치에서도 기록 파일을 직접 고친 것은 코드 변경이 아니다 — 기본 위치(.harness/)와 같다', () => {
  const graph = { store: 'data/graph.jsonl' };
  assert.equal(stop([human('기록 고쳐줘'), edit('s1', 'data/graph.jsonl')], { store: graph.store, graph, wrote: 10 }).stdout, '');
});

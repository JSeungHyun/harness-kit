// 서브에이전트 동시 상한 2 — 훅을 입력 JSON 으로 직접 부른다(24차)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmp, target } from './scene.mjs';
import { applyPolicy, readJson } from '../tools/policy-apply.mjs';

const HOOK = fileURLToPath(new URL('../tools/agent-cap.mjs', import.meta.url));
const MIN = 60_000;
const HOUR = 60 * MIN;

// 임시 상태 폴더(os.tmpdir 를 돌려 쓴다) — 세션마다 따로
function scene() {
  const tempDir = tmp('cap-');
  const env = { ...process.env, TMPDIR: tempDir, TEMP: tempDir, TMP: tempDir };
  const stateFile = (sid) => join(tempDir, 'harness-agent-cap', `${sid}.json`);
  const run = (input) => {
    const r = spawnSync(process.execPath, [HOOK], { input: typeof input === 'string' ? input : JSON.stringify(input), env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  };
  const runAsync = (input) => new Promise((resolve) => {
    const p = spawn(process.execPath, [HOOK], { env });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => resolve(out.trim() ? JSON.parse(out) : null));
    p.stdin.end(JSON.stringify(input));
  });
  const seed = (sid, state) => {
    mkdirSync(join(tempDir, 'harness-agent-cap'), { recursive: true });
    writeFileSync(stateFile(sid), typeof state === 'string' ? state : JSON.stringify(state));
  };
  return { run, runAsync, seed, stateFile };
}

const pre = (o = {}) => ({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Agent', tool_use_id: 'tu', tool_input: { subagent_type: 'general-purpose', prompt: 'x' }, ...o });
const start = (id, o = {}) => ({ hook_event_name: 'SubagentStart', session_id: 's1', agent_id: id, agent_type: 'general-purpose', ...o });
const stop = (id, o = {}) => ({ hook_event_name: 'SubagentStop', session_id: 's1', agent_id: id, agent_type: 'general-purpose', ...o });
const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';

test('⭐ 둘째까지 통과 · 셋째는 거부 — 이유에 지금 도는 수와 「끝난 뒤 다시」가 있다', () => {
  const s = scene();
  assert.equal(denied(s.run(pre())), false);
  assert.equal(denied(s.run(pre())), false);
  const out = s.run(pre());
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  const why = out.hookSpecificOutput.permissionDecisionReason;
  assert.match(why, /2/);
  assert.match(why, /끝난 뒤.*다시/);
  assert.ok(!why.includes('\n'));
});

test('⭐ 예약이 시작으로 바뀌어도 셈은 같다 — 시작한 둘이 도는 중이면 셋째 거부', () => {
  const s = scene();
  s.run(pre()); s.run(pre());
  s.run(start('a1')); s.run(start('a2'));
  assert.equal(denied(s.run(pre())), true);
});

test('⭐ 같은 메시지에서 병렬로 셋을 불러도(동시 기동) 셋째만 거부된다', async () => {
  const s = scene();
  const outs = await Promise.all([1, 2, 3, 4].map((i) => s.runAsync(pre({ tool_use_id: `tu${i}` }))));
  assert.equal(outs.filter(denied).length, 2);
});

test('⭐ 하나 끝난 뒤에는 다시 통과 — 끝난 agent_id 를 지운다', () => {
  const s = scene();
  s.run(pre()); s.run(pre());
  s.run(start('a1')); s.run(start('a2'));
  assert.equal(denied(s.run(pre())), true);
  s.run(stop('a1'));
  assert.equal(denied(s.run(pre())), false);
  assert.equal(denied(s.run(pre())), true);
});

test('끝 소식에 agent_id 가 없으면 같은 종류의 가장 오래된 것을 지운다', () => {
  const s = scene();
  s.run(pre()); s.run(pre());
  s.run(start('a1')); s.run(start('a2'));
  s.run(stop(undefined));
  assert.equal(denied(s.run(pre())), false);
});

test('⭐ 기록에 없는 agent_id 의 끝 소식은 아무것도 지우지 않는다 — 도는 둘이 그대로 남아 셋째는 거부', () => {
  const s = scene();
  s.run(pre()); s.run(pre());
  s.run(start('a1')); s.run(start('a2'));
  s.run(stop('모르는-id'));
  const st = JSON.parse(readFileSync(s.stateFile('s1'), 'utf8'));
  assert.deepEqual(st.running.map((x) => x.id), ['a1', 'a2']);
  assert.equal(denied(s.run(pre())), true);
});

test('⭐ web-fetch 는 세지 않는다 — 시작 · 끝도 상태를 건드리지 않는다', () => {
  const s = scene();
  const web = (o) => ({ ...o, agent_type: 'web-fetch' });
  for (let i = 0; i < 5; i++) assert.equal(denied(s.run(pre({ tool_input: { subagent_type: 'web-fetch' } }))), false);
  s.run(start('w1', web({}))); s.run(stop('w1', web({})));
  s.run(pre()); s.run(pre());
  assert.equal(denied(s.run(pre({ tool_input: { subagent_type: 'web-fetch' } }))), false);
  assert.equal(denied(s.run(pre())), true);
  // web-fetch 시작이 일반 예약을 먹지 않는다
  s.run(start('w2', web({})));
  assert.equal(denied(s.run(pre())), true);
});

test('Task 도구 · subagent_type 이 없는 호출도 센다', () => {
  const s = scene();
  s.run(pre({ tool_name: 'Task', tool_input: { prompt: 'x' } }));
  s.run(pre({ tool_input: { prompt: 'x' } }));
  assert.equal(denied(s.run(pre({ tool_name: 'Task' }))), true);
});

test('⭐ 끝 소식이 없는 기록은 3시간 뒤 잊는다(세션이 죽은 경우)', () => {
  const s = scene();
  const now = Date.now();
  s.seed('s1', { running: [{ id: 'old1', type: 'general-purpose', t: now - 3 * HOUR - MIN }, { id: 'old2', type: 'general-purpose', t: now - 4 * HOUR }], reserved: [] });
  assert.equal(denied(s.run(pre())), false);
  assert.equal(denied(s.run(pre())), false);
  assert.equal(denied(s.run(pre())), true);
  // 3시간 안이면 아직 센다
  s.seed('s2', { running: [{ id: 'x', type: 'general-purpose', t: now - 2 * HOUR }, { id: 'y', type: 'general-purpose', t: now - HOUR }], reserved: [] });
  assert.equal(denied(s.run(pre({ session_id: 's2' }))), true);
});

test('⭐ 미래 시각의 기록은 버린다 — 시계가 어긋나 남은 기록이 자리를 영영 차지하지 않는다', () => {
  const s = scene();
  const future = Date.now() + 10 * HOUR;
  s.seed('s1', { running: [{ id: 'f1', type: 'general-purpose', t: future }], reserved: [{ type: 'general-purpose', t: future }] });
  assert.equal(denied(s.run(pre())), false);
  assert.equal(denied(s.run(pre())), false);
  assert.equal(denied(s.run(pre())), true);
});

test('⭐ 시작하지 않은 예약은 60초 뒤 사라진다 — 다른 훅 · 권한이 거부한 호출이 자리를 오래 차지하지 않는다', () => {
  const s = scene();
  const now = Date.now();
  s.seed('s1', { running: [], reserved: [{ type: 'general-purpose', t: now - 61_000 }, { type: 'general-purpose', t: now - 90_000 }] });
  assert.equal(denied(s.run(pre())), false);
  assert.equal(denied(s.run(pre())), false);
  assert.equal(denied(s.run(pre())), true);
  // 60초 안이면 아직 자리를 찬다
  s.seed('s2', { running: [], reserved: [{ type: 'general-purpose', t: now - 30_000 }, { type: 'general-purpose', t: now - 10_000 }] });
  assert.equal(denied(s.run(pre({ session_id: 's2' }))), true);
});

test('⭐ 상태 파일이 깨졌으면 통과하고 새로 쓴다', () => {
  const s = scene();
  for (const bad of ['{ 깨짐', '[]', '{"running":"x","reserved":5}', '']) {
    s.seed('s1', bad);
    assert.equal(denied(s.run(pre())), false, bad);
    const st = JSON.parse(readFileSync(s.stateFile('s1'), 'utf8'));
    assert.equal(st.reserved.length, 1, bad);
    assert.deepEqual(st.running, [], bad);
  }
});

test('입력이 깨졌거나 session_id 가 없으면 조용히 통과 — 막지 않는다', () => {
  const s = scene();
  assert.equal(s.run('not json'), null);
  assert.equal(s.run(''), null);
  assert.equal(s.run({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: {} }), null);
  assert.equal(s.run({ hook_event_name: 'Nope', session_id: 's1' }), null);
  assert.equal(s.run(pre({ tool_name: 'Bash' })), null);
  assert.equal(existsSync(s.stateFile('s1')), false);
});

test('⭐ 다른 세션은 따로 센다 — session_id 가 경로를 벗어나도 상태 폴더 안에 쓴다', () => {
  const s = scene();
  s.run(pre()); s.run(pre());
  assert.equal(denied(s.run(pre())), true);
  assert.equal(denied(s.run(pre({ session_id: 's2' }))), false);
  assert.equal(denied(s.run(pre({ session_id: '../../evil' }))), false);
  assert.ok(existsSync(s.stateFile('______evil')));
});

test('거부된 호출은 예약하지 않는다 — 셋째를 거부해도 하나 끝나면 곧 둘이 돈다', () => {
  const s = scene();
  s.run(pre()); s.run(pre());
  for (let i = 0; i < 5; i++) assert.equal(denied(s.run(pre())), true);
  s.run(start('a1')); s.run(start('a2')); s.run(stop('a1')); s.run(stop('a2'));
  assert.equal(denied(s.run(pre())), false);
  assert.equal(denied(s.run(pre())), false);
});

test('시작 소식의 종류가 예약과 달라도(예약이 하나 남는 일 없이) 가장 오래된 예약을 먹는다', () => {
  const s = scene();
  s.run(pre({ tool_input: { subagent_type: 'Explore' } })); s.run(pre());
  s.run(start('a1', { agent_type: 'fork' })); s.run(start('a2'));
  const st = JSON.parse(readFileSync(s.stateFile('s1'), 'utf8'));
  assert.equal(st.reserved.length, 0);
  assert.equal(st.running.length, 2);
});

// ── 설치 — 모든 설치에 건다(그래프 훅 · 키트 정책을 받지 않은 설치도)
const POLICY_FILE = fileURLToPath(new URL('../policy/agent-cap.json', import.meta.url));
const capHooks = (settings) => Object.entries(settings.hooks ?? {}).flatMap(([event, gs]) => gs.flatMap((g) => (g.hooks ?? []).filter((h) => JSON.stringify(h).includes('agent-cap.mjs')).map((h) => ({ event, matcher: g.matcher, h }))));

test('⭐ 정책 파일 — Pre(Agent|Task) · SubagentStart · SubagentStop 을 셸 없이 node 로, 30초 안', () => {
  const p = readJson(POLICY_FILE);
  assert.deepEqual(Object.keys(p.hooks).sort(), ['PreToolUse', 'SubagentStart', 'SubagentStop']);
  assert.equal(p.hooks.PreToolUse[0].matcher, 'Agent|Task');
  for (const groups of Object.values(p.hooks)) {
    const h = groups[0].hooks[0];
    assert.equal(h.command, 'node');
    assert.deepEqual(h.args, ['${CLAUDE_PROJECT_DIR}/.harness/tools/agent-cap.mjs']);
    assert.ok(h.timeout <= 30);
  }
  assert.equal(p.permissions, undefined);
});

test('⭐ 세 갈래(정책 전체 · --only graph-hook · --clean) 모두에 훅이 들어간다 — 다시 돌려도 같다(중복 없음)', () => {
  for (const opts of [{ local: true }, { local: false }, { local: true, only: true, extra: ['graph-hook'] }, { local: true, only: true }]) {
    const once = applyPolicy({}, opts).settings;
    const hooks = capHooks(once);
    assert.deepEqual(hooks.map((x) => x.event).sort(), ['PreToolUse', 'SubagentStart', 'SubagentStop'], JSON.stringify(opts));
    assert.deepEqual(applyPolicy(once, opts).settings, once, JSON.stringify(opts));
  }
});

test('⛔ 키트 정책을 받지 않은 설치(--clean)는 이 훅 말고 다른 정책(권한 · 플러그인 · env · 그래프 훅)을 새로 받지 않는다', () => {
  const before = { permissions: { allow: ['Read'] }, env: { MINE: '1' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node mine.mjs' }] }] } };
  const { settings } = applyPolicy(before, { local: true, only: true });
  assert.deepEqual(settings.permissions, before.permissions);
  assert.deepEqual(settings.env, before.env);
  assert.equal(settings.enabledPlugins, undefined);
  assert.equal(settings.hooks.UserPromptSubmit, undefined);
  assert.deepEqual(settings.hooks.Stop, before.hooks.Stop);
  assert.equal(capHooks(settings).length, 3);
});

test('⭐ CLI --clean · --only graph-hook · 기본 — 세 갈래 모두 훅을 건다', () => {
  const APPLY = fileURLToPath(new URL('../tools/policy-apply.mjs', import.meta.url));
  for (const flags of [['--local', '--clean'], ['--local', '--only', 'graph-hook'], ['--local']]) {
    const dir = target(null, {});
    const r = spawnSync(process.execPath, [APPLY, dir, ...flags], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const s = readJson(join(dir, '.claude', 'settings.local.json'));
    assert.equal(capHooks(s).length, 3, flags.join(' '));
  }
});

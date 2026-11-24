// A/B 틀(proof/ab.mjs) 21차 — 계획에서 받는 금지 도구 · 권한 모드 · 사본을 바꾸는 과제(채점 → 초기화 → 대조) · 관문 훅 오염 · 세션 기록 · N팔 · 사람 채점. 가짜 claude 로만 돈다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRepo, put, tmp } from './scene.mjs';
import { gateCheck, inClaudeTemp, parseRun } from '../proof/ab.mjs';

const AB = fileURLToPath(new URL('../proof/ab.mjs', import.meta.url));
const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const SCORE = fileURLToPath(new URL('./fixtures/ab-score.mjs', import.meta.url));
const long = (d) => realpathSync.native(d).replace(/\\/g, '/');
const SRC = 'export const a = 1;\n';
const FIX = 'export const a = 2;\n';

// 팔마다 합성 사본 하나(graph 팔에만 기록 파일 · 훅 설정). scenario(경로) → { '<질문>|<팔 이름>': 가짜 claude 동작 }
function scene(armDefs, questions, scenario = () => ({}), extra = {}) {
  const p = { work: long(tmp('ab-work-')), home: long(tmp('ab-plan-')), config: long(tmp('ab-conf-')), dirs: {} };
  for (const a of armDefs) p.dirs[a.name] = long(gitRepo({ 'src/a.js': SRC, ...(a.graph ? { '.harness/graph/requests.jsonl': '{"req":"합성 기록"}\n' } : {}) }).dir);
  const keyed = Object.fromEntries(Object.entries(scenario(p)).map(([k, v]) => { const [q, arm] = k.split('|'); return [`${q}|${basename(p.dirs[arm])}`, v]; }));
  put(p.home, 'scenario.json', JSON.stringify(keyed));
  put(p.home, 'questions.json', JSON.stringify(questions));
  put(p.home, 'settings.json', '{}');
  const plan = { work: p.work, questions: 'questions.json', reps: 1, seed: 3, cap: 5,
    arms: armDefs.map((a) => ({ ...a, copies: [p.dirs[a.name]], ...(a.graph ? { settings: 'settings.json' } : {}) })), ...extra };
  p.plan = join(p.home, 'plan.json');
  writeFileSync(p.plan, JSON.stringify(plan));
  const ab = (...args) => spawnSync(process.execPath, [AB, ...args], { encoding: 'utf8', env: { ...process.env, FAKE_CLAUDE: join(p.home, 'scenario.json'), CLAUDE_CONFIG_DIR: p.config } });
  const log = (name = 'log.jsonl') => (existsSync(join(p.work, name)) ? readFileSync(join(p.work, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  // 그 실행이 가짜 claude 에 넘긴 인자
  const argv = (run) => JSON.parse(readFileSync(join(p.work, run), 'utf8').split('\n')[0]).argv;
  return { ...p, ab, log, argv, planObj: plan };
}
const ON_OFF = [{ name: 'on', graph: true, gate: true }, { name: 'off', graph: true, gate: false }];
const gold = (id, set = 'R') => ({ id, set, q: id, gold: ['src/a.js'] });
const task = (id, set = 'C') => ({ id, set, q: id });

const line = (o) => JSON.stringify(o);
const stopHook = { type: 'system', subtype: 'hook_started', hook_name: 'Stop', hook_event: 'Stop' };
const RESULT = { type: 'result', subtype: 'success', usage: {}, result: '답', permission_denials: [{ tool_name: 'Bash' }] };

test('parseRun — Stop 한 번에 돈 훅 수 · 관문 되돌림 줄 · 권한 거부 · 답 본문', () => {
  const block = { type: 'system', subtype: 'hook_response', hook_name: 'Stop', hook_event: 'Stop', stdout: '{"decision":"block","reason":"[관문] 이번 턴에 빠진 것: verify"}' };
  const text = { type: 'assistant', message: { content: [{ type: 'text', text: '채움' }] } };
  // Stop 두 번 — 첫 번은 훅 둘(하나가 되돌림), 둘째 번은 훅 둘
  const r = parseRun([stopHook, stopHook, block, text, stopHook, stopHook, RESULT].map(line).join('\n'));
  assert.deepEqual([r.stopBatch, r.gateBlocks, r.denials, r.answer], [2, 1, 1, '답']);
  // 도구 결과에 실린 훅 소스의 「[관문]」 은 되돌림 줄이 아니다
  const read = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'reason: `[관문] 이번 턴에 빠진 것`' }] } };
  const quiet = parseRun([stopHook, read, RESULT].map(line).join('\n'));
  assert.deepEqual([quiet.stopBatch, quiet.gateBlocks], [1, 0]);
  // 다른 이벤트의 훅은 세지 않는다
  assert.equal(parseRun([{ ...stopHook, hook_event: 'SessionStart' }, RESULT].map(line).join('\n')).stopBatch, 0);
});

test('gateCheck — 끈 팔의 되돌림 줄은 오염 · 켠 팔에 흔적이 없으면 무효 · gate 를 안 적은 팔은 보지 않는다', () => {
  const on = (o) => ({ gate: true, gateBlocks: 0, stopBatch: 0, ...o }), off = (o) => ({ gate: false, gateBlocks: 0, stopBatch: 0, ...o });
  // 전역 Stop 훅 하나 — 켠 팔은 관문 훅까지 둘
  assert.deepEqual(gateCheck([on({ stopBatch: 2 }), off({ stopBatch: 1 })]), [[], []]);
  // Stop 이벤트가 있어도 끈 팔과 수가 같으면 관문 훅이 돈 흔적이 아니다
  assert.deepEqual(gateCheck([on({ stopBatch: 1 }), off({ stopBatch: 1 })]), [['관문 훅 흔적 없음'], []]);
  assert.deepEqual(gateCheck([on({ stopBatch: 1, gateBlocks: 1 }), off({ stopBatch: 1 })]), [[], []]);
  assert.deepEqual(gateCheck([on({ stopBatch: 2 }), off({ stopBatch: 1, gateBlocks: 1 })]), [[], ['관문 훅']]);
  // 세 팔 — 끈 팔이 여럿이면 그중 큰 수가 기준이다
  assert.deepEqual(gateCheck([on({ stopBatch: 2 }), off({ stopBatch: 1 }), off({ stopBatch: 2 })]), [['관문 훅 흔적 없음'], [], []]);
  assert.deepEqual(gateCheck([{ gate: null, gateBlocks: 1, stopBatch: 0 }, { gate: null, gateBlocks: 0, stopBatch: 0 }]), [[], []]);
});

test('⛔ (23차) Claude 임시 폴더 안 사본은 등록하지 않는다 — 그 안에서는 프로젝트 CLAUDE.md · 규칙이 안 실린다', () => {
  const T = 'C:/Users/u/AppData/Local/Temp';
  assert.equal(inClaudeTemp(`${T}/claude/ab12/86ab/scratchpad/k23/copy/h-1`, T), true);
  assert.equal(inClaudeTemp('c:\\users\\u\\appdata\\local\\temp\\Claude\\x', T), true);
  assert.equal(inClaudeTemp('/tmp/claude-1000/s/copy', '/tmp'), true);
  // 일반 임시 폴더 · 이름만 비슷한 폴더 · 임시 폴더 밖은 괜찮다
  for (const d of [`${T}/talk-m-PUNKLf/copy`, `${T}/k-claude/copy`, 'C:/Project/some-clean', `${T}x/claude/a`]) assert.equal(inClaudeTemp(d, T), false, d);
  // 등록에서 exit 1 — 실제 임시 폴더의 claude… 폴더
  const s = scene(ON_OFF, [gold('q1')]);
  writeFileSync(s.plan, JSON.stringify({ ...s.planObj, arms: s.planObj.arms.map((a) => ({ ...a, copies: [long(tmp('claude-abtest-'))] })) }));
  const r = s.ab('prereg', s.plan);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Claude 임시 폴더/);
});

test('기본값 — 새 칸을 안 쓴 계획은 금지 도구 · 권한 모드 · 세션 기록 끔이 그대로다', () => {
  const s = scene([{ name: 'on', graph: true }, { name: 'off' }], [gold('Q1')]);
  assert.equal(s.ab('prereg', s.plan).status, 0);
  const run = s.ab('run', s.plan, '--claude', FAKE);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  for (const r of s.log()) {
    const a = s.argv(r.run).join(' ');
    assert.ok(a.includes('--no-session-persistence --strict-mcp-config --max-turns 60 --permission-mode default --disallowedTools Edit Write NotebookEdit WebFetch WebSearch Agent Task'), a);
    assert.deepEqual([r.metrics, r.answer], [undefined, undefined]);
  }
  assert.deepEqual(readdirSync(s.config), [], '세션 기록을 남기지 않는다');
});

const DB_DENY = ['mysql', 'mariadb', 'psql', 'sqlplus', 'sqlcmd', 'mongo', 'mongosh', 'redis-cli'].flatMap((c) => [`Bash(${c})`, `Bash(${c} *)`]);

test('⛔ (25차) DB 접속 명령은 항상 막는다 — 기본 · 계획 deny · 빈 deny · 묶음 deny 어디서도 빠지지 않는다', () => {
  const cases = [[{}, ['Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task']], [{ deny: ['WebFetch'] }, ['WebFetch']], [{ deny: [] }, []],
    [{ sets: { R: { deny: ['Edit'] } } }, ['Edit']]];
  for (const [extra, base] of cases) {
    const s = scene([{ name: 'on', graph: true }, { name: 'off' }], [gold('Q1')], () => ({}), extra);
    assert.equal(s.ab('prereg', s.plan).status, 0);
    assert.equal(s.ab('run', s.plan, '--claude', FAKE).status, 0);
    // settings 가 없는 팔의 인자 — --disallowedTools 뒤 끝까지가 금지 목록이다
    const a = s.argv(s.log().find((r) => !s.argv(r.run).includes('--settings')).run);
    assert.deepEqual(a.slice(a.indexOf('--disallowedTools') + 1), [...base, ...DB_DENY], JSON.stringify(extra));
  }
});

test('⭐ (25차) 팔 칸 hook — 그래프 도구는 있고 훅은 없는 팔이 유효로 나온다', () => {
  const s = scene([{ name: 'on', graph: true }, { name: 'tool', graph: true, hook: false }], [gold('Q1')], () => ({}));
  // tool 팔은 훅 등록(settings) 없이 돈다 — 가짜 claude 는 settings 를 받은 팔에만 훅 이벤트를 낸다
  writeFileSync(s.plan, JSON.stringify({ ...s.planObj, arms: s.planObj.arms.map((a) => (a.name === 'tool' ? { ...a, settings: undefined } : a)) }));
  assert.equal(s.ab('prereg', s.plan).status, 0);
  const run = s.ab('run', s.plan, '--claude', FAKE);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(s.log().map((r) => [r.arm, r.valid, r.bad]).sort(), [['on', true, []], ['tool', true, []]]);
});

test('사본을 바꾸는 과제 — 채점 → 초기화 → 대조 · 지표별 판정 · 계획의 금지 도구 · 권한 모드 · 세션 기록은 실행 뒤 지운다', () => {
  const judge = [{ set: 'C', pass: '덜어낸 판으로', fail: '되돌린다', metrics: { 거짓완료: { better: 'lower', slack: 0 }, 성공: { better: 'higher', slack: 1 } } },
    { set: 'C', pass: '범위 통과', fail: '범위 미달', metrics: { 요청밖: { better: 'lower', slack: 0 } } },
    { set: 'R', pass: '손해 없음', fail: '손해 있음', hitSlack: 0 }];
  const s = scene(ON_OFF, [task('C1'), task('C2'), gold('R1'), task('BAD1'), gold('G1'), gold('G2'), gold('S1'), gold('R2')], () => ({
    // 켠 팔: 고치고 요청 밖 새 파일도 만든다 · 관문이 한 번 되돌린다 / 끈 팔: 안 고치고 끝냈다고 한다
    'C1|on': { write: { 'src/a.js': FIX, 'extra.txt': 'x', '.harness/graph/requests.jsonl': '{"req":"새 기록"}\n' }, result: 'STATUS: DONE', stop: 2, gateBlock: true },
    'C1|off': { result: 'STATUS: DONE', stop: 1 },
    'C2|on': { write: { 'src/a.js': FIX }, result: 'STATUS: DONE', stop: 2 }, 'C2|off': { write: { 'src/a.js': FIX }, result: 'STATUS: DONE', stop: 1 },
    'R1|on': { stop: 2 }, 'R1|off': { stop: 1 },
    'BAD1|on': { stop: 2 }, 'BAD1|off': { stop: 1 },
    'G1|on': { stop: 2 }, 'G1|off': { stop: 1, gateBlock: true },
    'G2|on': { stop: 1 }, 'G2|off': { stop: 1 },
    'S1|on': { stop: 2, noSession: true }, 'S1|off': { stop: 1 },
    // 읽기 전용 묶음에서 추적 파일을 바꾸면 여전히 오염이다
    'R2|on': { stop: 2 }, 'R2|off': { stop: 1, touch: 'src/a.js' },
  }), { deny: ['WebFetch', 'WebSearch'], sessionPersistence: true, judge, sets: { C: { mutates: true, score: ['node', SCORE], permissionMode: 'acceptEdits' } } });
  const reg = s.ab('prereg', s.plan);
  assert.equal(reg.status, 0, reg.stderr);
  const run = s.ab('run', s.plan, '--claude', FAKE);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /뺀 쌍 5\(/);
  const log = s.log();
  const row = (id, arm) => log.filter((r) => r.id === id && r.arm === arm);

  // 채점은 초기화 전에 돈다 — 바뀐 사본을 본 값이다
  assert.deepEqual(row('C1', 'on').map((r) => [r.bad, r.metrics, r.gateBlocks]), [[[], { 성공: 1, 거짓완료: 0, 요청밖: 1 }, 1]]);
  assert.deepEqual(row('C1', 'off').map((r) => [r.bad, r.metrics]), [[[], { 성공: 0, 거짓완료: 1, 요청밖: 0 }]]);
  // 초기화 — 추적 파일 · 새 파일 · 기록 파일이 등록 때로 돌아왔다
  for (const d of Object.values(s.dirs)) {
    assert.equal(readFileSync(join(d, 'src/a.js'), 'utf8'), SRC);
    assert.ok(!existsSync(join(d, 'extra.txt')));
    assert.equal(readFileSync(join(d, '.harness/graph/requests.jsonl'), 'utf8'), '{"req":"합성 기록"}\n');
  }
  // 무효 · 오염은 한 번 다시 돌리고 이름을 남긴다
  const kinds = { BAD1: ['on', '채점 실패'], G1: ['off', '관문 훅'], G2: ['on', '관문 훅 흔적 없음'], S1: ['on', '세션 기록 못 찾음'], R2: ['off', '사본 변경'] };
  for (const [id, [arm, name]] of Object.entries(kinds)) assert.deepEqual(row(id, arm).map((r) => r.bad.includes(name)), [true, true], `${id}: ${JSON.stringify(row(id, arm).map((r) => r.bad))}`);
  assert.deepEqual(row('G2', 'off').map((r) => r.bad), [[], []], '오염 이름이 옆 팔로 새지 않는다');

  // 계획의 금지 도구 · 묶음의 권한 모드 · 세션 기록
  const c = s.argv(row('C1', 'on')[0].run).join(' '), r = s.argv(row('R1', 'on')[0].run).join(' ');
  assert.ok(c.includes(`--permission-mode acceptEdits --disallowedTools WebFetch WebSearch ${DB_DENY.join(' ')} --settings`), c);
  assert.ok(r.includes(`--permission-mode default --disallowedTools WebFetch WebSearch ${DB_DENY.join(' ')} --settings`), r);
  assert.ok(!c.includes('--no-session-persistence'));
  assert.deepEqual(readdirSync(join(s.config, 'projects')), [], '그 실행의 세션 기록 파일 · 폴더를 지운다');

  const agg = s.ab('agg', s.plan);
  assert.equal(agg.status, 0, agg.stdout + agg.stderr);
  const cBlock = agg.stdout.split('### C (2건)')[1].split('### R')[0];
  assert.match(cBlock, /\| 성공\(실행\) \| 2\/2 \| 1\/2 \|/);
  assert.match(cBlock, /\| 거짓완료\(실행\) \| 0\/2 \| 1\/2 \|/);
  assert.ok(!cBlock.includes('정답 적중'), '정답 파일이 없는 묶음에는 적중 줄이 없다');
  assert.match(cBlock, /거짓완료 on 0 ≤ off 1 \+ 0 ✅ · 성공 on 2 ≥ off 1 − 1 ✅ → \*\*덜어낸 판으로\*\*/);
  assert.match(cBlock, /요청밖 on 1 ≤ off 0 \+ 0 ❌ → \*\*범위 미달\*\*/);
  assert.match(agg.stdout, /### R \(1건\)[\s\S]*\| 정답 적중\(실행\) \| 1\/1 \| 1\/1 \|[\s\S]*적중 실행 on 1 ≥ off 1 − 0 ✅ → \*\*손해 없음\*\*/);
  assert.match(agg.stdout, /\| C1 \| C \| 1\/1 \| 0\/1 \| 0\/1 \| 1\/1 \| 1\/1 \| 0\/1 \|/);

  // 채점 명령도 사전 등록 지문에 든다
  const body = readFileSync(SCORE, 'utf8');
  try {
    writeFileSync(SCORE, `${body}// 고침\n`);
    const changed = s.ab('agg', s.plan);
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /사전 등록 지문이 어긋난다.*score/);
  } finally { writeFileSync(SCORE, body); }
});

test('⛔ 초기화가 안 되는 사본은 무효로 적고 새 쌍을 멈춘다 · 미추적 파일이 있는 사본은 등록하지 않는다 · 채점 명령 없는 mutates 는 거절', () => {
  // git clean 은 안에 든 다른 저장소를 지우지 않는다 — 초기화 뒤에도 남는다
  const nested = { 'sub/.git/HEAD': 'ref: refs/heads/main\n', 'sub/.git/objects/x': '', 'sub/.git/refs/x': '' };
  const s = scene(ON_OFF.map((a) => ({ name: a.name })), [task('C1'), task('C2'), task('C3')], () => ({ 'C1|on': { write: nested }, 'C2|on': { write: nested }, 'C3|on': { write: nested } }),
    { mutates: true, score: ['node', SCORE] });
  assert.equal(s.ab('prereg', s.plan).status, 0);
  const run = s.ab('run', s.plan, '--claude', FAKE);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /⛔ 사본이 초기화 뒤에도 등록 때와 다르다 — 새 쌍을 멈췄다/);
  assert.deepEqual(s.log().map((r) => [r.arm, r.bad]), [['on', ['초기화 어긋남']], ['off', []]], '첫 쌍 뒤로는 띄우지 않는다');

  const dirty = scene(ON_OFF.map((a) => ({ name: a.name })), [task('C1')], () => ({}), { mutates: true, score: ['node', SCORE] });
  writeFileSync(join(dirty.dirs.on, 'left.txt'), '남은 파일\n');
  const reg = dirty.ab('prereg', dirty.plan);
  assert.equal(reg.status, 1);
  assert.match(reg.stderr, /미추적 · 무시 파일이 있다/);
  const pilot = dirty.ab('run', dirty.plan, '--claude', FAKE, '--pilot');
  assert.equal(pilot.status, 1, '파일럿도 지워질 파일이 있으면 띄우지 않는다');
  assert.equal(dirty.log('pilot-log.jsonl').length, 0);

  const bare = scene(ON_OFF.map((a) => ({ name: a.name })), [task('C1')], () => ({}), { mutates: true });
  const no = bare.ab('prereg', bare.plan);
  assert.equal(no.status, 1);
  assert.match(no.stderr, /채점 명령 score 를 적는다/);
});

test('N팔 — 같은 질문의 세 팔을 한 번에 띄우고 기준 팔 대 각 팔로 판정한다 · 사람 채점 질문은 답 본문 경로만 표에 낸다', () => {
  const arms = [{ name: 'new', graph: true }, { name: 'old', graph: true }, { name: 'bare', graph: true }];
  const judge = [{ set: 'A', pass: '효과 있음', fail: '미달', ratioMax: { tools: 0.8 }, hitSlack: 0 }, { set: 'A', arm: 'bare', pass: '손해 없음', fail: '손해 있음', ratioMax: { sec: 1.1 } }];
  const two = [{ pattern: 'a' }, { pattern: 'b' }];
  const s = scene(arms, [gold('Q1', 'A'), { id: 'M1', set: 'M', q: 'M1', grade: 'manual' }, gold('Q2', 'A')], () => ({
    'Q1|new': {}, 'Q1|old': { tools: two }, 'Q1|bare': { tools: two },
    'M1|new': { result: '새 머리말의 답' }, 'M1|old': { result: '옛 머리말의 답' }, 'M1|bare': { result: '지시문 없는 답' },
    // 한 팔이 무효면 세 팔을 함께 다시 돌린다
    'Q2|bare': { noResult: true },
  }), { judge });
  const none = s.ab('prereg', s.plan);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /기준 팔 이름을 baseline 에 적는다/);
  writeFileSync(s.plan, JSON.stringify({ ...s.planObj, baseline: 'old' }));
  const reg = s.ab('prereg', s.plan);
  assert.equal(reg.status, 0, reg.stderr);
  assert.match(reg.stdout, /쌍 3\(실행 9\)/);
  const run = s.ab('run', s.plan, '--claude', FAKE);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /뺀 쌍 1\(Q2-1\)/);
  const log = s.log();
  assert.equal(log.length, 12);
  assert.deepEqual(log.filter((r) => r.id === 'Q2').map((r) => `${r.arm}${r.attempt}`).sort(), ['bare1', 'bare2', 'new1', 'new2', 'old1', 'old2']);

  const agg = s.ab('agg', s.plan);
  assert.equal(agg.status, 0, agg.stdout + agg.stderr);
  assert.match(agg.stdout, /^# A\/B 집계 — new · bare 대 old /);
  const [, vsNew, vsBare] = agg.stdout.split(/^## (?:new|bare) 대 old$/m);
  assert.match(vsNew, /\| 도구 호출 \| 1\.0 \| 2\.0 \| \*\*0\.50\*\* \| 1\/1 \|/);
  assert.match(vsNew, /→ \*\*효과 있음\*\*/);
  assert.ok(!vsNew.includes('손해'), '팔을 적은 판정은 그 팔의 짝에만 낸다');
  assert.match(vsBare, /\| 도구 호출 \| 2\.0 \| 2\.0 \| \*\*1\.00\*\* \| 0\/1 \|/);
  assert.match(vsBare, /→ \*\*미달\*\*[\s\S]*→ \*\*손해 없음\*\*/);
  // 사람 채점 — 표에는 경로, 본문은 작업 폴더 파일에만
  for (const [arm, text] of [['new', '새 머리말의 답'], ['old', '옛 머리말의 답'], ['bare', '지시문 없는 답']]) {
    assert.ok(agg.stdout.includes(`| M1 | 1 | ${arm} | answers/M1-1-${arm}-1.md |`), arm);
    assert.equal(readFileSync(join(s.work, `answers/M1-1-${arm}-1.md`), 'utf8'), text);
    assert.ok(!agg.stdout.includes(text));
  }
  assert.match(vsNew, /\| M1 \| M \|.*\| — \| — \|/);
});

test('⛔ 비용 상한 — 닿으면 새 쌍을 멈추고 exit 1 (세 팔 · 사본을 바꾸는 계획에서도)', () => {
  const s = scene([{ name: 'a' }, { name: 'b' }, { name: 'c' }], [task('C1'), task('C2'), task('C3')], () => ({}), { baseline: 'c', mutates: true, score: ['node', SCORE], cap: 0.05 });
  assert.equal(s.ab('prereg', s.plan).status, 0);
  const run = s.ab('run', s.plan, '--claude', FAKE);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  // 쌍마다 $0.03 — 둘째 쌍 뒤 $0.06 ≥ 상한
  assert.match(run.stdout, /⛔ 누적 \$0\.06 ≥ 상한 \$0\.05 — 새 쌍을 멈췄다/);
  assert.equal(s.log().length, 6);
});

test('미리 적은 연장 — run --reps 는 등록 반복보다 큰 수만 · 앞 회차는 다시 안 돌리고 새 회차만 · 집계 머리에 연장을 적는다', () => {
  const s = scene([{ name: 'on', graph: true }, { name: 'off' }], [gold('Q1'), gold('Q2')]);
  assert.equal(s.ab('prereg', s.plan).status, 0);
  assert.equal(s.ab('run', s.plan, '--claude', FAKE).status, 0);
  for (const n of ['1', '0', 'x']) assert.equal(s.ab('run', s.plan, '--claude', FAKE, '--reps', n).status, 1, n);
  // 붙여 쓴 --reps=3 은 조용히 무시하지 않는다
  const glued = s.ab('run', s.plan, '--claude', FAKE, '--reps=3');
  assert.equal(glued.status, 1);
  assert.match(glued.stdout + glued.stderr, /옵션 값은 띄어 쓴다/);
  const ext = s.ab('run', s.plan, '--claude', FAKE, '--reps', '2');
  assert.equal(ext.status, 0, ext.stdout + ext.stderr);
  assert.match(ext.stdout, /남은 쌍 2 /);
  assert.deepEqual(s.log().map((r) => r.rep).sort(), [1, 1, 1, 1, 2, 2, 2, 2]);
  const agg = s.ab('agg', s.plan);
  assert.equal(agg.status, 0, agg.stderr);
  assert.match(agg.stdout, /반복 1 \+ 연장 1/);
});

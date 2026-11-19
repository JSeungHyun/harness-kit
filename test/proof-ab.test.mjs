// 효과 A/B 틀(proof/ab.mjs) — 가짜 claude 로만 돈다. 오염이 남거나 사전 등록 지문이 어긋나면 exit 1, 재계산은 docs/proof.md 표와 같다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRepo, put, repoFile, tmp } from './scene.mjs';
import { checkRun, median, parseRun, parseTable, render, wilcoxon } from '../proof/ab.mjs';

const AB = fileURLToPath(new URL('../proof/ab.mjs', import.meta.url));
const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
// Windows 임시 폴더는 8.3 단축 경로일 수 있다 — 틀은 긴 경로로 맞춰 본다
const long = (d) => realpathSync.native(d).replace(/\\/g, '/');
const JUDGE = [{ set: 'A', pass: '효과 있음', fail: '효과 있음 기준 미달', ratioMax: { tools: 0.8, sec: 0.9 }, hitSlack: 1 }];

// 합성 사본 둘(켠 쪽에만 기록 파일) · 원본 · 작업 폴더 · 계획 파일. scenario(경로) → { '<질문>|on' | '<질문>|off': 가짜 claude 동작 }
function scene(ids, scenario = () => ({}), extra = {}) {
  const src = { 'src/a.js': 'export const a = 1;\n' };
  const on = long(gitRepo({ ...src, '.harness/graph/requests.jsonl': '{"req":"합성 기록"}\n' }).dir);
  const off = long(gitRepo(src).dir);
  const p = { on, off, source: long(tmp('ab-src-')), work: long(tmp('ab-work-')), home: long(tmp('ab-plan-')) };
  const keyed = Object.fromEntries(Object.entries(scenario(p)).map(([k, v]) => [k.replace(/\|on$/, `|${basename(on)}`).replace(/\|off$/, `|${basename(off)}`), v]));
  put(p.home, 'scenario.json', JSON.stringify(keyed));
  put(p.home, 'questions.json', JSON.stringify(ids.map((id) => ({ id, set: 'A', q: id, gold: ['src/a.js'] }))));
  put(p.home, 'common.md', '공통 지침 한 줄');
  put(p.home, 'on-settings.json', '{}');
  const plan = { work: p.work, source: p.source, questions: 'questions.json', common: 'common.md', reps: 1, seed: 7, cap: 5, judge: JUDGE,
    arms: [{ name: 'on', copies: [on], rules: ['kit:graph'], settings: 'on-settings.json', graph: true }, { name: 'off', copies: [off], graph: false }], ...extra };
  p.plan = join(p.home, 'plan.json');
  writeFileSync(p.plan, JSON.stringify(plan));
  const ab = (...args) => spawnSync(process.execPath, [AB, ...args], { encoding: 'utf8', env: { ...process.env, FAKE_CLAUDE: join(p.home, 'scenario.json') } });
  const log = () => (existsSync(join(p.work, 'log.jsonl')) ? readFileSync(join(p.work, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { ...p, ab, log, plan: p.plan, planObj: plan };
}

test('median · wilcoxon — 정확 양측 p, 0 차는 뺀다', () => {
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([null, 5]), 5);
  assert.equal(median([]), null);
  assert.equal(wilcoxon([1, 2, 3, 4, 5]).p, 0.0625);
  assert.equal(wilcoxon(Array.from({ length: 39 }, (_, i) => i + 1)).p, 2 / 2 ** 39);
  assert.deepEqual(wilcoxon([0]), { n: 0, p: null });
});

const line = (o) => JSON.stringify(o);
const INIT = { type: 'system', subtype: 'init', session_id: 'sid-1', model: 'fake', tools: ['Bash'], mcp_servers: [], plugins: [] };

test('parseRun — result 가 둘이면 토큰 · 시간 · 턴은 합, 비용은 마지막(누적), FILES 는 마지막 답', () => {
  const u1 = { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 3 };
  const u2 = { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 30, output_tokens: 4 };
  const r = parseRun([
    line(INIT),
    line({ type: 'result', subtype: 'success', duration_ms: 1000, total_cost_usd: 0.10, num_turns: 5, usage: u1, result: 'FILES:\n- src/A.java' }),
    line({ type: 'result', subtype: 'success', duration_ms: 200, total_cost_usd: 0.12, num_turns: 1, usage: u2, result: '알림 확인.\n\nFILES:\n- src/B.java' }),
  ].join('\n'));
  assert.deepEqual(r.tokens, { input: 11, cacheCreate: 7, cacheRead: 130, output: 7, total: 155, fresh: 25 });
  assert.deepEqual([r.ms, r.cost, r.turns, r.results, r.files], [1200, 0.12, 6, 2, ['src/B.java']]);
  assert.equal(parseRun(line(INIT)).valid, false);
});

test('checkRun — 오염 종류마다 이름을 낸다 · 자기 세션 폴더의 넘친 출력만 읽은 것은 오염이 아니다', () => {
  const paths = { source: 'C:/Real/shop', self: 'C:/T/ab/off-a', others: ['C:/T/ab/on-a'], scratch: ['C:/T/work'] };
  const run = (graph, input, extra = {}) => {
    const raw = [line({ ...INIT, ...extra.init }), ...(extra.hook ?? graph ? [line({ type: 'system', subtype: 'hook_started', hook_event: 'UserPromptSubmit' })] : []),
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input }] } }), line({ type: 'result', subtype: 'success', usage: {} })].join('\n');
    return checkRun(parseRun(raw), raw, { graph }, paths);
  };
  assert.deepEqual(run(false, { pattern: 'a', path: 'src' }), []);
  assert.deepEqual(run(true, { command: 'node .harness/tools/graph-find.mjs 메일' }), []);
  assert.deepEqual(run(false, { command: 'node .harness/tools/graph-find.mjs 메일' }), ['그래프 도구']);
  assert.deepEqual(run(false, { file_path: '.harness/graph/requests.jsonl' }), ['그래프 도구']);
  assert.deepEqual(run(true, { file_path: 'C:\\Real\\shop\\src\\A.java' }), ['실제 저장소']);
  assert.deepEqual(run(false, { command: 'git -C /c/real/shop log' }), ['실제 저장소']);
  // 이름이 이어지는 다른 폴더는 그 저장소가 아니다
  assert.deepEqual(run(false, { command: 'ls C:/Real/shop-copy' }), []);
  assert.deepEqual(run(false, { command: 'ls ~/.claude/projects/' }), ['세션 기록']);
  assert.deepEqual(run(false, { file_path: 'C:/Users/u/.claude/projects/C--T-ab-off-a/sid-1/tool-results/x.txt' }), []);
  assert.deepEqual(run(false, { file_path: 'C:/Users/u/.claude/projects/C--T-ab-off-a/sid-9/x.jsonl' }), ['세션 기록']);
  assert.deepEqual(run(false, { file_path: 'C:/T/ab/on-a/src/A.java' }), ['다른 팔']);
  assert.deepEqual(run(false, { command: 'cat C:/T/work/log.jsonl' }), ['측정 자료']);
  assert.deepEqual(run(true, { pattern: 'a' }, { hook: false }), ['훅 이벤트']);
  assert.deepEqual(run(false, { pattern: 'a' }, { hook: true }), ['훅 이벤트']);
  assert.deepEqual(run(false, { pattern: 'a' }, { init: { memory_paths: { auto: 'x' }, mcp_servers: [{ name: 'm' }] } }), ['메모리', 'MCP']);
});

test('사전 등록 → 실행 → 집계 — 짝 비율 · 판정이 나오고, 켠 쪽 규칙은 키트 graph.md 다', () => {
  // 켠 쪽: 도구 1 · 0.3 + 0.2초(result 둘) / 끈 쪽: 도구 2 · 1초
  const s = scene(['Q1', 'Q2'], () => Object.fromEntries(['Q1', 'Q2'].flatMap((q) => [[`${q}|on`, { ms: [300, 200] }], [`${q}|off`, { tools: [{ pattern: 'a' }, { pattern: 'b' }] }]])), { reps: 2 });
  assert.equal(s.ab('run', s.plan).status, 1, '--claude 없이는 돌지 않는다');
  assert.equal(s.ab('run', s.plan, '--claude', FAKE).status, 1, '사전 등록 없이는 본 실행이 돌지 않는다');
  assert.equal(s.log().length, 0);
  const reg = s.ab('prereg', s.plan);
  assert.equal(reg.status, 0, reg.stderr);
  const run = s.ab('run', s.plan, '--claude', FAKE);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(s.log().length, 8);
  assert.ok(s.log().every((r) => r.valid && !r.bad.length && r.hit));
  const kitRule = repoFile('templates/rules/graph.md');
  assert.ok(readFileSync(join(s.work, 'prompt-on.md'), 'utf8').includes(kitRule));
  assert.ok(!readFileSync(join(s.work, 'prompt-off.md'), 'utf8').includes('graph-find'));
  const agg = s.ab('agg', s.plan);
  assert.equal(agg.status, 0, agg.stdout + agg.stderr);
  assert.match(agg.stdout, /\| 도구 호출 \| 1\.0 \| 2\.0 \| \*\*0\.50\*\* \| 2\/2 \|/);
  assert.match(agg.stdout, /\| 시간\(초\) \| 0\.5 \| 1\.0 \| \*\*0\.50\*\* \| 2\/2 \|/);
  assert.match(agg.stdout, /\| 정답 적중\(실행\) \| 4\/4 \| 4\/4 \|/);
  assert.match(agg.stdout, /→ \*\*효과 있음\*\*/);
  assert.equal(s.ab('prereg', s.plan).status, 1, '본 실행 뒤에는 사전 등록을 바꿀 수 없다');
});

test('⛔ 오염을 넣으면 그 쌍은 무효 — 다시 돌려도 남으면 exit 1, 집계에 들어가지 않는다', () => {
  // 도구 입력 · init 으로 잡는 여덟 종은 위 checkRun 시험이 하나씩 본다 — 여기는 실행기가 있어야 잡는 둘(사본 변경 · 결과 없음)과 실제 경로가 필요한 「다른 팔」
  const kinds = (p) => ({
    '다른 팔': ['off', { tools: [{ file_path: `${p.on}/src/a.js` }] }],
    '사본 변경': ['off', { touch: 'src/a.js' }],
    '결과 없음': ['on', { noResult: true }],
  });
  const names = Object.keys(kinds({}));
  const s = scene([...names.map((_, i) => `K${i}`), 'OK'], (p) => Object.fromEntries(Object.values(kinds(p)).map(([arm, spec], i) => [`K${i}|${arm}`, spec])));
  assert.equal(s.ab('prereg', s.plan).status, 0);
  const run = s.ab('run', s.plan, '--claude', FAKE);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  const log = s.log();
  for (const [i, name] of names.entries()) {
    const arm = Object.values(kinds(s))[i][0];
    const rows = log.filter((r) => r.id === `K${i}` && r.arm === arm);
    assert.equal(rows.length, 2, `${name} — 한 번 다시 돌린다`);
    for (const r of rows) assert.ok(name === '결과 없음' ? !r.valid : r.bad.includes(name), `${name}: ${JSON.stringify(r.bad)} valid=${r.valid}`);
    // 다른 팔은 깨끗하다 — 오염 이름이 옆 팔로 새지 않는다
    assert.ok(log.filter((r) => r.id === `K${i}` && r.arm !== arm).every((r) => r.valid && !r.bad.length), `${name} 의 다른 팔`);
  }
  assert.match(run.stdout, /뺀 쌍 3/);
  assert.equal(readFileSync(join(s.off, 'src/a.js'), 'utf8'), 'export const a = 1;\n', '바뀐 사본은 되돌린다');
  const agg = s.ab('agg', s.plan);
  assert.equal(agg.status, 0, agg.stdout + agg.stderr);
  assert.match(agg.stdout, /### A \(1건\)/);
  assert.match(agg.stdout, /뺀 쌍 3/);
});

test('⛔ 사전 등록 뒤 질문 · 판정 기준 · 사본이 바뀌면 지문이 어긋나 exit 1', () => {
  const s = scene(['Q1']);
  assert.equal(s.ab('prereg', s.plan).status, 0);
  const questions = join(s.home, 'questions.json');
  const before = readFileSync(questions, 'utf8');
  writeFileSync(questions, before.replace('"q":"Q1"', '"q":"Q1 고침"'));
  const run = s.ab('run', s.plan, '--claude', FAKE);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /사전 등록 지문이 어긋난다.*questions/);
  assert.equal(s.log().length, 0, '어긋나면 한 번도 띄우지 않는다');
  writeFileSync(questions, before);
  assert.equal(s.ab('run', s.plan, '--claude', FAKE).status, 0);

  // 결과를 본 뒤 판정 기준을 느슨하게 바꾼다
  writeFileSync(s.plan, JSON.stringify({ ...s.planObj, judge: [{ ...JUDGE[0], ratioMax: { tools: 2 } }] }));
  const agg = s.ab('agg', s.plan);
  assert.equal(agg.status, 1);
  assert.match(agg.stderr, /사전 등록 지문이 어긋난다.*plan/);
  writeFileSync(s.plan, JSON.stringify(s.planObj));
  assert.equal(s.ab('agg', s.plan).status, 0);

  writeFileSync(join(s.on, 'src/a.js'), '사본을 고침\n');
  const dirty = s.ab('agg', s.plan);
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /사전 등록 지문이 어긋난다.*copies/);
});

test('재계산 — docs/proof.md 의 질문별 표에서 다시 낸 짝 비율 · 판정이 그 문서의 요약 표와 같다', () => {
  const doc = repoFile('docs/proof.md').replace(/\r\n/g, '\n');
  const { rows, arms } = parseTable(doc);
  assert.equal(rows.length, 39);
  const out = render(rows, arms, [...JUDGE, { set: 'B', pass: '손해 없음', fail: '손해 있음', ratioMax: { sec: 1.1 }, hitSlack: 1 }]);
  const ROW = /^\| (.+?) \| .+? \| .+? \| \*\*(.+?)\*\* \| (\d+\/\d+) \| (.+?) \|$/;
  const blocks = out.split(/^### /m).slice(1);
  assert.deepEqual(blocks.map((b) => b.split('\n')[0]), ['A (20건)', 'A · 라벨 (12건)', 'A · 티켓 (8건)', 'B (19건)', '전체 (39건)']);
  let compared = 0;
  for (const b of blocks) {
    const label = b.split('\n')[0];
    const chunk = doc.split(`\n#### ${label}`)[1]?.split(/\n#{2,4} /)[0];
    assert.ok(chunk, `proof.md 에 「#### ${label}」 표가 없다`);
    for (const l of b.split('\n')) {
      const m = l.match(ROW);
      if (!m) {
        if (l.startsWith('| 정답 적중')) assert.ok(chunk.includes(l), `${label}: ${l}`);
        // 판정은 통과 · 미달 표시와 결론이 같아야 한다 — 문구 안의 비율 끝자리는 아래 허용 폭으로 본다
        if (l.startsWith('판정(')) assert.deepEqual(chunk.split('\n').find((x) => x.startsWith('판정('))?.match(/[✅❌]|\*\*.+?\*\*/g), l.match(/[✅❌]|\*\*.+?\*\*/g), label);
        continue;
      }
      const d = chunk.split('\n').map((x) => x.match(ROW)).find((x) => x?.[1] === m[1]);
      assert.ok(d, `${label}: ${m[1]} 행이 없다`);
      // 질문별 표는 소수 1자리로 반올림된 값이라 비율 끝자리가 1 다를 수 있다. 질문 수 · p 는 같아야 한다
      assert.ok(Math.abs(Number(d[2]) - Number(m[2])) < 0.0101, `${label} ${m[1]} 짝 비율 ${d[2]} ≠ ${m[2]}`);
      assert.deepEqual([d[3], d[4]], [m[3], m[4]], `${label} ${m[1]}`);
      compared++;
    }
  }
  assert.equal(compared, 15);
});

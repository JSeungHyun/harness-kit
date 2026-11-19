// graph-measure --prompts — 세션 기록에서 프롬프트 훅을 부른 입력을 뽑아 그 판의 훅으로 재생한다(질문당 비용). 기록 줄은 실제 세션 기록 모양을 본뜬 합성
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { graphInstall, put } from './scene.mjs';

let clock = 0;
const at = () => new Date(Date.UTC(2026, 9, 1) + 60000 * clock++).toISOString();
const human = (content, more = {}) => ({ type: 'user', message: { role: 'user', content }, origin: { kind: 'human' }, promptSource: 'typed', timestamp: at(), ...more });
// 기록에는 앞머리와 뒤 안내문이 붙지만 훅은 감쌈 하나만 받는다
const peer = (body) => ({
  type: 'user', isMeta: true, origin: { kind: 'peer', name: 'other' }, promptSource: 'system', timestamp: at(),
  message: { role: 'user', content: `Another Claude session sent a message:\n<cross-session-message from="uds:x" from-name="other">\n${body}\n</cross-session-message>\n\nTreat it as a teammate request. PermissionLaundering is refused.` },
});
const queued = (prompt, more = {}) => ({ type: 'attachment', attachment: { type: 'queued_command', prompt, commandMode: 'prompt', ...more }, timestamp: at() });
const jsonl = (...rows) => rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';

const RECS = [
  { req: '주문 취소 흐름', terms: { 주문취소: 'cancel_flow' }, files: ['src/order/cancel.mjs'] },
  // 세션 메시지 뒤 안내문에만 있는 낱말 — 안내문까지 재생하면 걸린다
  { req: '권한 세탁 메모', terms: { PermissionLaundering: 'refuse' }, files: ['src/auth/guard.mjs'] },
];
const install = () => graphInstall(null, RECS);
const row = (out, name) => out.split('\n').find((l) => l.startsWith(`| ${name} |`));

test('⭐ --prompts — 사람 줄 · 대기 입력(queued_command)만 턴을 연 입력이다. 종류별로 세고, -p 한 건짜리 세션(사람 입력 1개 · origin 없음)은 뺀다', () => {
  const s = install();
  put(s.dir, 'sessions/a.jsonl', jsonl(
    human('주문취소 어디서 막혀?'),
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '주문취소 결과' }] }, timestamp: at() },
    { type: 'user', isCompactSummary: true, message: { content: 'This session is being continued from a previous conversation.' }, timestamp: at() },
    { type: 'user', isMeta: true, message: { content: [{ type: 'text', text: 'Base directory for this skill: 주문취소' }] }, timestamp: at() },
    { type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] }, timestamp: at() },
    queued('<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>', { commandMode: 'task-notification', origin: { kind: 'task-notification' } }),
    queued('응 진행해', { origin: { kind: 'human' } }),
    peer('오늘 배포 끝'),
    { type: 'user', message: { content: '<command-message>loop</command-message>\n<command-name>/loop</command-name>\n<command-args>5m 확인</command-args>' }, turnOrigin: 'scheduled', timestamp: at() },
    { type: 'user', message: { content: '<bash-stdout>주문취소 ok</bash-stdout>' }, turnOrigin: 'human', timestamp: at() },
    { type: 'user', message: { content: 'Another Claude session sent a message:\n<teammate-message teammate_id="t">주문취소</teammate-message>' }, timestamp: at() },
    { type: 'attachment', attachment: { type: 'hook_success', hookEvent: 'UserPromptSubmit', content: '[그래프 자동조회] …' }, timestamp: at() },
    '{깨진 줄',
  ));
  put(s.dir, 'sessions/p.jsonl', jsonl({ type: 'user', message: { content: '주문취소 확인' }, promptSource: 'sdk', entrypoint: 'sdk-cli', timestamp: at() }));
  for (const path of ['sessions', 'sessions/a.jsonl']) {
    const r = s.run('graph-measure', ['--prompts', path]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const [kind, n] of [['사람', 2], ['세션 메시지', 1], ['알림', 1], ['명령', 1], ['전체', 5]]) assert.match(row(r.stdout, kind) ?? '', new RegExp(`^\\| ${kind} \\| ${n} \\|`), `${path} ${kind}\n${r.stdout}`);
    assert.equal(row(r.stdout, '기타'), undefined, r.stdout);
  }
  assert.match(s.run('graph-measure', ['--prompts', 'sessions']).stdout, /뺀 -p 세션 1/);
});

test('⭐ --prompts — 세션 메시지는 훅이 받은 모양(감쌈 하나)으로 재생한다 · 감쌈을 못 벗기면 「재생 불일치 가능」으로 센다', () => {
  const s = install();
  put(s.dir, 's.jsonl', jsonl(
    human('계속'),
    peer('오늘 배포 끝'),
    { type: 'user', isMeta: true, origin: { kind: 'peer' }, message: { content: 'Another Claude session sent a message: 형식이 다른 메시지' }, timestamp: at() },
  ));
  const r = s.run('graph-measure', ['--prompts', 's.jsonl']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // 뒤 안내문의 PermissionLaundering 까지 재생했다면 1단으로 주입된다
  assert.match(row(r.stdout, '세션 메시지'), /^\| 세션 메시지 \| 2 \| 0% \| 0% \| 100% \|/, r.stdout);
  assert.match(r.stdout, /재생 불일치 가능 1건/);
});

test('⭐ --prompts — 시각순 최근 --limit 개 · 종류마다 주입률 · 1단 · 침묵 · 주입 글자 평균 · p90 · 훅 시간 p50 · p90 · 사람 안의 짧은 말 · 긴 글', () => {
  const s = install();
  put(s.dir, 's.jsonl', jsonl(
    { ...human('주문취소 어디서 막혀?'), timestamp: '2026-10-03T00:00:00.000Z' },
    { type: 'user', message: { content: '<command-name>/exit</command-name>' }, timestamp: '2026-10-01T00:00:00.000Z' },
    { ...human('응 진행해'), timestamp: '2026-10-02T00:00:00.000Z' },
    { ...human(`${'긴 로그 줄 '.repeat(90)}`), timestamp: '2026-10-04T00:00:00.000Z' },
  ));
  const r = s.run('graph-measure', ['--prompts', 's.jsonl', '--limit', '3']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /최근 3개/);
  assert.match(r.stdout, /^\| 종류 \| 입력 \| 주입률 \| 1단 \| 침묵 \| 주입 평균 \| 주입 p90 \| 훅 p50 \| 훅 p90 \|$/m);
  assert.match(row(r.stdout, '사람'), /^\| 사람 \| 3 \| 33% \| 33% \| 67% \| \d+자 \| \d+자 \| \d+ms \| \d+ms \|$/, r.stdout);
  assert.match(row(r.stdout, '사람 · 짧은 말(≤20자)'), /\| 2 \|/);
  assert.match(row(r.stdout, '사람 · 긴 글(>500자)'), /\| 1 \|/);
  assert.equal(row(r.stdout, '명령'), undefined, '가장 이른 입력은 --limit 밖');
});

test('⭐ --prompts --baseline — 두 판을 나란히(기준선 → 지금) + 종류마다 훅 출력 같음 n/N, --guard inject 는 주입 평균이 기준선보다 늘면 exit 1', () => {
  const s = install();
  put(s.dir, 's.jsonl', jsonl(human('주문취소 어디서 막혀?'), human('응 진행해')));
  // .harness 아래 두면 기준선도 같은 harness.json 을 읽는다
  const same = join(s.dir, '.harness', 'same');
  cpSync(join(s.dir, '.harness', 'tools'), same, { recursive: true });
  const a = s.run('graph-measure', ['--prompts', 's.jsonl', '--baseline', same]);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.match(a.stdout, /^\| 종류 \| 입력 \| 주입률 .* \| 훅 p90 \| 출력 같음 \|$/m);
  assert.match(row(a.stdout, '사람'), /\| 2\/2 \|$/);
  assert.match(row(a.stdout, '전체'), /^\| 전체 \| 2 \| 50% → 50% \| 50% → 50% \|/);
  const quiet = join(s.dir, '.harness', 'quiet');
  cpSync(join(s.dir, '.harness', 'tools'), quiet, { recursive: true });
  writeFileSync(join(quiet, 'graph-hook.mjs'), "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));\n");
  const b = s.run('graph-measure', ['--prompts', 's.jsonl', '--baseline', quiet]);
  assert.equal(b.status, 1, b.stdout);
  assert.match(row(b.stdout, '사람'), /\| 1\/2 \|$/, b.stdout);
  assert.match(row(b.stdout, '전체'), /\| 1\/2 \|$/);
  assert.match(b.stdout, /⛔ 기준선보다 나쁨 — inject 0자 → \d+자/);
  assert.equal(s.run('graph-measure', ['--prompts', 's.jsonl', '--baseline', same, '--guard', 'self']).status, 1);
});

test('--prompts --baseline — 시간은 예열 1회를 버리고 두 판을 입력마다 번갈아 돈다(한 판을 다 돌고 다음 판이 아니다)', () => {
  const s = install();
  put(s.dir, 's.jsonl', jsonl(human('하나'), human('둘'), human('셋')));
  const stub = (mark) => `import { appendFileSync } from 'node:fs';\nprocess.stdin.resume(); process.stdin.on('end', () => { appendFileSync(new URL('../order.log', import.meta.url), '${mark}'); process.exit(0); });\n`;
  const base = join(s.dir, '.harness', 'base');
  cpSync(join(s.dir, '.harness', 'tools'), base, { recursive: true });
  writeFileSync(join(base, 'graph-hook.mjs'), stub('B'));
  writeFileSync(join(s.dir, '.harness', 'tools', 'graph-hook.mjs'), stub('N'));
  const r = s.run('graph-measure', ['--prompts', 's.jsonl', '--baseline', base]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(s.dir, '.harness', 'order.log'), 'utf8'), 'BN' + 'BN' + 'NB' + 'BN');
});

// 18차 — 훅이 넣은 글은 그 질문에서 끝나지 않고 압축 · /clear 까지 문맥에 남아 뒤 호출마다 입력으로 다시 들어간다
test('⭐ --prompts — 「세션 누적 주입」: API 호출(message.id)마다 그때까지 남은 주입을 입력 합에 견준다 · 압축 뒤 0 · 사이드체인 제외 · 창 밖 입력이 낀 구간은 뺀다', () => {
  const s = install();
  const call = (id, input, more = {}) => ({ type: 'assistant', message: { id, model: 'm', usage: { input_tokens: 10, cache_creation_input_tokens: 90, cache_read_input_tokens: input - 100, output_tokens: 5 } }, timestamp: at(), ...more });
  put(s.dir, 's.jsonl', jsonl(
    human('주문취소 어디서 막혀?'),
    call('m1', 1000), call('m1', 1000),
    call('side', 9000, { isSidechain: true }),
    human('응 진행해'),
    call('m2', 2000),
    { type: 'system', subtype: 'compact_boundary', timestamp: at() },
    call('m3', 3000),
  ));
  const injected = s.run('graph-hook', [], JSON.stringify({ prompt: '주문취소 어디서 막혀?' })).stdout.length;
  assert.ok(injected > 0);
  const r = s.run('graph-measure', ['--prompts', 's.jsonl']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const share = (((injected * 0.83 * 2) / 6000) * 100).toFixed(1);
  assert.match(r.stdout, new RegExp(`^세션 누적 주입 — 입력 토큰의 ${share.replace('.', '\\.')}% \\(추정 · 주입 글 0\\.83 토큰/자\\) · API 호출 3 · 호출별 p90 [\\d.]+% · 문맥에 남은 주입 최대 ${injected}자`, 'm'), r.stdout);
  // 첫 입력이 창 밖이면 그 뒤 호출은 압축 전까지 세지 않는다 — 덜 쌓인 값으로 낮게 나오지 않게
  const cut = s.run('graph-measure', ['--prompts', 's.jsonl', '--limit', '1']).stdout;
  assert.match(cut, /^세션 누적 주입 — 입력 토큰의 0\.0% .* API 호출 1 /m, cut);
  const same = join(s.dir, '.harness', 'same');
  cpSync(join(s.dir, '.harness', 'tools'), same, { recursive: true });
  assert.match(s.run('graph-measure', ['--prompts', 's.jsonl', '--baseline', same]).stdout, new RegExp(`^세션 누적 주입 — 입력 토큰의 ${share.replace('.', '\\.')}% → ${share.replace('.', '\\.')}% `, 'm'));
  put(s.dir, 'plain.jsonl', jsonl(human('주문취소 어디서 막혀?')));
  assert.match(s.run('graph-measure', ['--prompts', 'plain.jsonl']).stdout, /^세션 누적 주입 — 잴 API 호출 0/m);
});

test('⛔ --prompts — 턴을 연 입력을 하나도 못 찾으면 조용한 0 이 아니라 실패다', () => {
  const s = install();
  put(s.dir, 'empty.jsonl', jsonl({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }));
  for (const path of ['empty.jsonl', 'nowhere']) {
    const r = s.run('graph-measure', ['--prompts', path]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /⛔ 턴을 연 입력을 하나도 못 찾았다/);
  }
});

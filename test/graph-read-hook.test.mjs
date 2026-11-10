// 파일 키 회상 훅(graph-read-hook) — 모델이 연 파일을 가리키는 기록을 상한 걸린 양만 붙인다. 합성 픽스처만
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphInstall, put, tmp, target } from './scene.mjs';
import { applyPolicy } from '../tools/policy-apply.mjs';
import { checkInstall } from '../tools/install-check.mjs';
import { upgrade, settingsShape } from '../tools/upgrade.mjs';

const LONG = '정산 마감 직전에 환불이 들어오면 원장 합계가 어긋난다 — 마감 배치가 환불 큐를 먼저 비운다 '.repeat(8);
const REC = {
  old: { req: '주문 취소 환불 v1', files: ['src/order/refund.mjs'] },
  canon: { req: '정본: 주문 취소 환불 절차', date: '2026-09-10', files: ['src/order/refund.mjs', 'src/order/cancel.mjs'], note: LONG, supersedes: '주문 취소 환불 v1' },
  hist: { req: '부분 환불 금액 반올림 수정', date: '2026-09-12', files: ['src/order/refund.mjs'], note: '원 단위 절사' },
  open: { req: '환불 큐 재시도 설계', date: '2026-09-15', files: ['src/order/refund.mjs:88'], note: '⏸ 재시도 간격까지 정했다 — 결제사 응답 규격을 받으면 재개' },
  other: { req: '배송지 변경 화면', date: '2026-09-11', files: ['src/ship/address.mjs'], note: '주소 검증은 서버에서만' },
};
// 10건 넘게 걸린 파일 — 건수만
const MANY = Array.from({ length: 11 }, (_, i) => ({ req: `공통 매퍼 수정 ${i + 1}`, date: `2026-09-${String(i + 1).padStart(2, '0')}`, files: ['src/common/mapper.xml'], note: `함정 ${i + 1}` }));

function scene(lines = [...Object.values(REC), ...MANY]) {
  const s = graphInstall({ names: ['shopx'] }, lines);
  for (const f of ['src/order/refund.mjs', 'src/order/cancel.mjs', 'src/ship/address.mjs', 'src/common/mapper.xml', 'src/order/none.mjs']) put(s.dir, f, '// 픽스처\n');
  // 세션 상태는 OS 임시 폴더에 — 테스트마다 따로
  const home = tmp('readhook-');
  const env = { ...s.env, TEMP: home, TMP: home, TMPDIR: home };
  const hook = (input) => spawnSync(process.execPath, [join(s.dir, '.harness', 'tools', 'graph-read-hook.mjs')], { cwd: s.dir, env, input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
  const read = (rel, extra = {}) => ({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: join(s.dir, rel) }, cwd: s.dir, ...extra });
  return { ...s, hook, read, home };
}
const ctx = (r) => {
  assert.equal(r.status, 0, r.stderr);
  if (!r.stdout) return '';
  const j = JSON.parse(r.stdout);
  assert.equal(j.hookSpecificOutput.hookEventName, 'PostToolUse');
  return j.hookSpecificOutput.additionalContext;
};
// 세션 기록 — 사람 입력 · 프롬프트 훅 출력 줄
const human = (text) => ({ type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' } });
const ups = (content) => ({ type: 'attachment', attachment: { type: 'hook_success', hookName: 'UserPromptSubmit', hookEvent: 'UserPromptSubmit', content } });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] } });
function transcript(dir, lines) {
  const p = join(dir, 'transcript.jsonl');
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}

test('(d) 기록 있는 파일 → 최신 정본 1건 + 함정 1줄 + ⏸ · 나머지는 건수와 graph-find 안내 · 대체된 기록 · 다른 파일 기록은 안 붙는다', () => {
  const s = scene();
  const out = ctx(s.hook(s.read('src/order/refund.mjs')));
  assert.match(out, /src\/order\/refund\.mjs/);
  assert.match(out, /기록 3건/);
  assert.match(out, /정본: 주문 취소 환불 절차/);
  const trap = out.split('\n').filter((l) => l.includes('함정'));
  assert.equal(trap.length, 1, out);
  assert.ok(trap[0].length < 260, `함정은 한 줄 상한: ${trap[0].length}자`);
  assert.match(out, /⏸ .*환불 큐 재시도 설계/, '줄번호 붙은 경로(a.mjs:88)도 그 파일이다');
  assert.match(out, /그 밖 1건/);
  assert.match(out, /graph-find\.mjs --files src\/order\/refund\.mjs/);
  assert.doesNotMatch(out, /주문 취소 환불 v1|부분 환불 금액|배송지 변경/);
});

test('(d) 같은 파일 두 번 → 한 번만 · 이미 보인 기록은 다른 파일에서도 다시 안 붙는다 · 다른 세션은 처음부터', () => {
  const s = scene();
  assert.notEqual(ctx(s.hook(s.read('src/order/refund.mjs'))), '');
  assert.equal(s.hook(s.read('src/order/refund.mjs')).stdout, '');
  // cancel.mjs 의 기록은 정본 하나뿐이고 이미 보였다
  assert.equal(s.hook(s.read('src/order/cancel.mjs')).stdout, '');
  assert.match(ctx(s.hook(s.read('src/order/cancel.mjs', { session_id: 's2' }))), /정본: 주문 취소 환불 절차/);
});

test('(d) 기록 없는 파일 · 저장소 밖 파일 → 0 바이트', () => {
  const s = scene();
  assert.deepEqual([s.hook(s.read('src/order/none.mjs')).stdout, s.hook(s.read('src/order/none.mjs')).status], ['', 0]);
  const outside = join(tmp('outside-'), 'src', 'order', 'refund.mjs');
  assert.equal(s.hook({ ...s.read('x'), tool_input: { file_path: outside } }).stdout, '');
});

test('(d) 기록이 10건 넘게 걸린 파일 → 건수만(제목 · 함정 없음) · 세션당 한 번', () => {
  const s = scene();
  const out = ctx(s.hook(s.read('src/common/mapper.xml')));
  assert.match(out, /기록 11건/);
  assert.match(out, /graph-find\.mjs --files src\/common\/mapper\.xml/);
  assert.doesNotMatch(out, /공통 매퍼 수정|함정/);
  assert.equal(out.split('\n').length, 1, out);
  assert.equal(s.hook(s.read('src/common/mapper.xml')).stdout, '');
});

test('(d) 깨진 입력 → 조용히 통과(exit 0 · 0 바이트)', () => {
  const s = scene();
  for (const bad of ['', '{', 'null', '[]', JSON.stringify({ tool_input: {} }), JSON.stringify({ session_id: 's1', tool_input: { file_path: 7 } })]) {
    const r = s.hook(bad);
    assert.equal(r.status, 0, `${bad} → ${r.stderr}`);
    assert.equal(r.stdout, '', bad);
  }
  // 세션 기록을 못 읽으면 빼지 않고 붙인다 — 중복 한 번이 침묵보다 싸다
  assert.match(ctx(s.hook(s.read('src/order/refund.mjs', { transcript_path: join(s.dir, 'no-such.jsonl') }))), /정본: 주문 취소 환불 절차/);
  // 기록 위치에 깨진 줄이 섞여도 죽지 않는다
  const b = scene(['{"req": "깨진 줄', REC.hist]);
  assert.match(ctx(b.hook(b.read('src/order/refund.mjs'))), /부분 환불 금액/);
});

test('같은 턴에 프롬프트 훅이 붙인 기록은 다시 안 붙인다 — 지난 턴에 붙인 것은 이번 턴과 무관하다', () => {
  const s = scene();
  const injected = `[그래프 자동조회] 유사 기록 4건 — 상위 1건만 표시.\n· [절차 · 9점] 2026-09-10 정본: 주문 취소 환불 절차\n⏸ 2026-09-15 환불 큐 재시도 설계`;
  const now = transcript(s.dir, [human('환불 절차 봐 줘'), ups(injected), { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] } }, toolResult()]);
  const out = ctx(s.hook(s.read('src/order/refund.mjs', { transcript_path: now, prompt_id: 'p1' })));
  assert.doesNotMatch(out, /정본: 주문 취소 환불 절차|환불 큐 재시도/);
  assert.match(out, /부분 환불 금액 반올림 수정/, '프롬프트 훅이 안 붙인 기록이 정본 자리를 받는다');
  // 다음 턴 — 프롬프트 훅이 침묵했다. 지난 턴의 주입은 세지 않는다
  const s2 = scene();
  const next = transcript(s2.dir, [human('환불 절차 봐 줘'), ups(injected), toolResult(), human('이제 취소 화면 고쳐'), toolResult()]);
  assert.match(ctx(s2.hook(s2.read('src/order/refund.mjs', { transcript_path: next, prompt_id: 'p2' }))), /정본: 주문 취소 환불 절차/);
});

test('서브에이전트(agent_id)는 메인 턴의 주입을 보지 못했다 — 빼지 않고, 파일 한 번도 메인과 따로 센다', () => {
  const s = scene();
  const t = transcript(s.dir, [human('환불 고쳐'), ups('· 2026-09-10 정본: 주문 취소 환불 절차')]);
  assert.doesNotMatch(ctx(s.hook(s.read('src/order/refund.mjs', { transcript_path: t }))), /정본: 주문 취소 환불 절차/);
  assert.match(ctx(s.hook(s.read('src/order/refund.mjs', { transcript_path: t, agent_id: 'a1' }))), /정본: 주문 취소 환불 절차/);
});

test('기록 위치가 CRLF · BOM 이어도 같은 파일을 찾는다', () => {
  const s = scene([REC.hist]);
  writeFileSync(s.store, `﻿${readFileSync(s.store, 'utf8').replace(/\n/g, '\r\n')}`);
  assert.match(ctx(s.hook(s.read('src/order/refund.mjs'))), /부분 환불 금액/);
});

const RH = { PostToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.harness/tools/graph-read-hook.mjs'], timeout: 10 }] }] };

test('정책 graph-read-hook — PostToolUse(Read) exec 형식 · 다시 병합해도 같다 · 그래프 훅과 따로', () => {
  const once = applyPolicy({}, { local: true, extra: ['graph-read-hook'] }).settings;
  assert.deepEqual(once.hooks.PostToolUse, RH.PostToolUse);
  assert.equal(once.hooks.UserPromptSubmit, undefined);
  assert.deepEqual(applyPolicy(once, { local: true, extra: ['graph-read-hook'] }).settings, once);
  const both = applyPolicy(applyPolicy({}, { local: true, extra: ['graph-hook'] }).settings, { local: true, extra: ['graph-read-hook'] }).settings;
  assert.match(JSON.stringify(both.hooks.UserPromptSubmit), /graph-hook\.mjs/);
  assert.match(JSON.stringify(both.hooks.PostToolUse), /graph-read-hook\.mjs/);
});

test('켠 설치만 본다 — settingsShape · 갱신 안내 줄 · 이식 검사 ④', () => {
  const KIT = fileURLToPath(new URL('..', import.meta.url));
  assert.equal(settingsShape(target(null, { '.claude/settings.local.json': JSON.stringify({ hooks: RH }) })).readHook, true);
  assert.equal(settingsShape(target(null, { '.claude/settings.local.json': JSON.stringify(applyPolicy({}, { local: true, extra: ['graph-hook'] }).settings) })).readHook, false);
  // 갱신 안내 2 — 켠 설치에만 --with graph-read-hook
  const on = target({ profile: 'existing', mode: 'local', state: { decisions: 'd.md', lessons: 'l.md' } }, { 'd.md': '', 'l.md': '', '.claude/settings.local.json': JSON.stringify(applyPolicy({ hooks: RH }, { local: true, extra: ['gate-hook'] }).settings) });
  assert.ok(existsSync(join(KIT, 'policy', 'graph-read-hook.json')));
  const text = upgrade(on).text;
  assert.match(text, /policy-apply\.mjs --local --with gate-hook --with graph-read-hook/);
  const row4 = checkInstall(on, { plugins: [] }).find((r) => r.n === '④');
  assert.equal(row4.ok, true, row4.observed);
  assert.match(row4.observed, /파일 기록 훅 켬/);
  // 켠 설치의 훅 형식이 옛 것이면 ④ 가 잡는다
  const stale = JSON.parse(readFileSync(join(on, '.claude/settings.local.json'), 'utf8'));
  stale.hooks.PostToolUse[0].hooks[0] = { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.harness/tools/graph-read-hook.mjs"' };
  writeFileSync(join(on, '.claude/settings.local.json'), JSON.stringify(stale));
  const bad = checkInstall(on, { plugins: [] }).find((r) => r.n === '④');
  assert.equal(bad.ok, false);
  assert.match(bad.observed, /hooks\.PostToolUse/);
});

// /exec-cycle 중에만 도는 종료 훅 — 가짜 세션 기록(JSONL)과 Stop 입력으로 훅을 직접 부른다(26차)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmp, put } from './scene.mjs';

const HOOK = fileURLToPath(new URL('../tools/cycle-gate.mjs', import.meta.url));
const NET = '1. L3: delete: 안 쓰는 분기.\nnet: -4 lines possible.';

// 기록 줄 짓기 — 실제 모양: 사용자 슬래시 명령은 문자열 content, 도구 호출은 assistant tool_use, 결과는 user tool_result
let n = 0;
const msg = (type, content) => JSON.stringify({ type, isSidechain: false, message: { role: type, content } });
const cycle = (args = '함수 추가') => msg('user', `<command-message>exec-cycle</command-message>\n<command-name>/exec-cycle</command-name>\n<command-args>${args}</command-args>`);
const say = (text) => msg('assistant', [{ type: 'text', text }]);
const call = (name, input) => {
  const id = `toolu_${++n}`;
  return { id, line: msg('assistant', [{ type: 'tool_use', id, name, input }]) };
};
const result = (id, text, isError = false) => msg('user', [{ type: 'tool_result', tool_use_id: id, content: text, ...(isError ? { is_error: true } : {}) }]);

// 한 장면 — 임시 프로젝트 · 기록 파일 · 훅 실행
function scene() {
  const proj = tmp('cyclegate-');
  const path = join(proj, 'session.jsonl');
  writeFileSync(path, '');
  const w = (...lines) => appendFileSync(path, `${lines.join('\n')}\n`);
  const edit = (file = 'src/a.js', name = 'Edit') => {
    const c = call(name, name === 'NotebookEdit' ? { notebook_path: join(proj, file) } : { file_path: join(proj, file) });
    w(c.line, result(c.id, '수정함'));
  };
  const ids = ['단위 테스트'];
  const verify = (ok = true, cmd = 'node .harness/tools/verify.mjs', out) => {
    const c = call('Bash', { command: cmd });
    w(c.line, result(c.id, out ?? (ok ? ids.map((i) => `✅ ${i} — 통과`).join('\n') :'Exit code 1\n⛔ 단위 테스트 — 종료코드 1'), !ok));
  };
  const run = (extra = {}) => {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', transcript_path: path, cwd: proj, ...extra }), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  };
  return { proj, path, w, edit, verify, run, ids };
}
const blocked = (out) => out?.decision === 'block';

test('⭐ 사이클을 안 불렀으면 통과 — 코드를 고쳐도 아무것도 안 한다', () => {
  const s = scene();
  s.edit();
  s.w(say('끝'));
  assert.equal(s.run(), null);
});

test('⭐ 사이클을 불렀어도 수정이 없으면 통과 — 설계 · 승인 대기', () => {
  const s = scene();
  s.w(cycle(), say('어떤 방식이 좋을까요?'));
  assert.equal(s.run(), null);
});

test('⭐ 수정 뒤 verify 가 없으면 되돌린다 — 이유에 verify 와 사용자에게 묻는 탈출구', () => {
  const s = scene();
  s.w(cycle());
  s.edit();
  const out = s.run();
  assert.ok(blocked(out));
  assert.match(out.reason, /verify/);
  assert.match(out.reason, /ponytail/);
  assert.match(out.reason, /cycle-skill.mjs user ponytail-review/);
  assert.match(out.reason, /사용자에게 묻/);
});

test('⭐ verify 가 실패했으면 되돌린다 — 도구 오류(exit 1)로도, 오류 표시 없이 ⛔ 줄만 있어도', () => {
  const s = scene();
  s.w(cycle());
  s.edit();
  s.verify(false);
  s.w(say(NET));
  assert.match(s.run().reason, /verify/);
  const t = scene();
  t.w(cycle());
  t.edit();
  t.verify(true, 'node .harness/tools/verify.mjs || true', '⛔ 단위 테스트 — 종료코드 1');
  t.w(say(NET));
  assert.ok(blocked(t.run()));
});

test('⭐ 리뷰가 없으면 되돌린다 — verify 는 통과했으니 ponytail 만 말한다', () => {
  const s = scene();
  s.w(cycle());
  s.edit();
  s.verify();
  s.w(say('끝났습니다'));
  const out = s.run();
  assert.ok(blocked(out));
  assert.match(out.reason, /ponytail/);
  assert.match(out.reason, /cycle-skill.mjs user ponytail-review/);
  assert.doesNotMatch(out.reason, /verify 가 없|verify 를 돌/);
});

test('⭐ 수정 뒤 verify 통과 + 리뷰 결과(net 줄 · Lean already)가 둘 다 있으면 통과', () => {
  const s = scene();
  s.w(cycle());
  s.edit();
  s.verify();
  s.w(say(NET));
  assert.equal(s.run(), null);
  const t = scene();
  t.w(cycle());
  t.edit('src/b.js', 'Write');
  t.verify();
  t.w(say('Lean already. Ship.'));
  assert.equal(t.run(), null);
});

test('⭐ 통과한 뒤 다시 수정하면 되돌린다 — 증거는 마지막 수정 뒤의 것만', () => {
  const s = scene();
  s.w(cycle());
  s.edit();
  s.verify();
  s.w(say(NET));
  assert.equal(s.run(), null);
  s.edit('src/a.js', 'MultiEdit');
  const out = s.run();
  assert.ok(blocked(out));
  assert.match(out.reason, /verify/);
  assert.match(out.reason, /ponytail/);
});

test('⭐ 앞선 사이클의 증거는 새 /exec-cycle 뒤에 안 쳐준다', () => {
  const s = scene();
  s.w(cycle('첫 일'));
  s.edit();
  s.verify();
  s.w(say(NET));
  assert.equal(s.run(), null);
  s.w(cycle('둘째 일'));
  s.edit();
  assert.ok(blocked(s.run()));
});

test('Skill 도구로 부른 사이클도 사이클이다', () => {
  const s = scene();
  const c = call('Skill', { skill: 'exec-cycle', args: '일' });
  s.w(c.line, result(c.id, 'Launching skill'));
  s.edit();
  assert.ok(blocked(s.run()));
});

test('코드가 아닌 수정(문서 · .harness · .claude · 프로젝트 밖)은 수정으로 세지 않는다 — 설계 단계의 스펙 · 계획 문서', () => {
  const s = scene();
  s.w(cycle());
  s.edit('docs/superpowers/specs/design.md', 'Write');
  s.edit('README.txt');
  s.edit('.harness/harness.json');
  s.edit('.claude/settings.json');
  const c = call('Write', { file_path: join(tmp('outside-'), 'plan.js') });
  s.w(c.line, result(c.id, '씀'));
  assert.equal(s.run(), null);
  s.edit('docs/tool.js');
  assert.ok(blocked(s.run()), 'docs/ 밑이라도 .md 가 아닌 파일은 코드다 — 문서 확장자만 뺀다');
});

test('NotebookEdit 도 수정이다', () => {
  const s = scene();
  s.w(cycle());
  s.edit('a.ipynb', 'NotebookEdit');
  assert.ok(blocked(s.run()));
});

test('verify --baseline 은 검사가 아니다 · 다른 명령은 verify 가 아니다', () => {
  const s = scene();
  s.w(cycle());
  s.edit();
  s.verify(true, 'node .harness/tools/verify.mjs --baseline');
  s.verify(true, 'node --test');
  s.w(say(NET));
  assert.match(s.run().reason, /verify/);
});

test('마지막 응답이 리뷰 결과면 기록이 늦게 써져도 통과 — Stop 입력의 last_assistant_message 도 본다', () => {
  const s = scene();
  s.w(cycle());
  s.edit();
  s.verify();
  assert.ok(blocked(s.run()));
  assert.equal(s.run({ last_assistant_message: NET }), null);
});

test('API 요청 사본 줄에 든 명령 글자는 사이클 호출이 아니다 · 도구 결과 글에 든 net 줄도 리뷰가 아니다', () => {
  const s = scene();
  s.w(JSON.stringify({ type: 'api-request-blob', message: { role: 'user', content: '<command-name>/exec-cycle</command-name>' } }));
  s.edit();
  assert.equal(s.run(), null);
  const t = scene();
  t.w(cycle());
  t.edit();
  t.verify();
  const c = call('Read', { file_path: 'x' });
  t.w(c.line, result(c.id, 'net: -9 lines possible.'));
  assert.ok(blocked(t.run()));
});

test('기록이 없거나 깨졌으면 통과 — 훅이 세션을 막지 않는다', () => {
  const s = scene();
  assert.equal(s.run({ transcript_path: join(s.proj, '없음.jsonl') }), null);
  s.w('{깨짐', cycle(), '또 깨짐');
  s.edit();
  assert.ok(blocked(s.run()));
  assert.equal(s.run({ transcript_path: undefined }), null);
});

test('⭐ 큰 기록(수십 MB · 요청 사본 줄 포함)에서도 30초 안에 끝난다', () => {
  const s = scene();
  const blob = `${JSON.stringify({ type: 'api-request-blob', message: { role: 'user', content: 'x'.repeat(1 << 20) } })}\n`;
  for (let i = 0; i < 48; i++) appendFileSync(s.path, blob);
  s.w(cycle());
  for (let i = 0; i < 3000; i++) s.w(say('긴 대화 '.repeat(20)));
  s.edit();
  s.verify();
  s.w(say(NET));
  const t0 = Date.now();
  assert.equal(s.run(), null);
  assert.ok(Date.now() - t0 < 15_000, `${Date.now() - t0}ms`);
});

// 검증 전용 /exec-review — 코드 수정이 없어도 호출 뒤 verify 통과 + 리뷰 결과가 있어야 끝낸다
const review = (args = '') => msg('user', `<command-message>exec-review</command-message>\n<command-name>/exec-review</command-name>\n<command-args>${args}</command-args>`);

test('⭐ exec-review 뒤 아무것도 안 하고 끝내면 되돌린다 — 수정이 없어도', () => {
  const s = scene();
  s.w(review(), say('봤습니다'));
  const out = s.run();
  assert.ok(blocked(out));
  assert.match(out.reason, /exec-review/);
  assert.match(out.reason, /verify/);
  assert.match(out.reason, /ponytail/);
});

test('⭐ exec-review 뒤 verify 만 있으면 되돌린다 — 리뷰 결과가 빠졌다', () => {
  const s = scene();
  s.w(review());
  s.verify();
  const out = s.run();
  assert.ok(blocked(out));
  assert.match(out.reason, /ponytail/);
  assert.doesNotMatch(out.reason, /verify 가 없다/);
});

test('⭐ exec-review 뒤 verify 통과 + 리뷰 결과가 둘 다 있으면 통과', () => {
  const s = scene();
  s.w(review());
  s.verify();
  s.w(say(NET));
  assert.equal(s.run(), null);
});

test('exec-review 뒤 수정이 있으면 마지막 수정 뒤의 증거가 필요하다', () => {
  const s = scene();
  s.w(review());
  s.verify();
  s.w(say(NET));
  s.edit();
  assert.ok(blocked(s.run()));
  s.verify();
  s.w(say(NET));
  assert.equal(s.run(), null);
});

test('exec-cycle 뒤 exec-review 를 부르면 exec-review 규칙을 따른다 — 수정이 없어도 증거 필요', () => {
  const s = scene();
  s.w(cycle(), say('설계 질문'));
  assert.equal(s.run(), null);
  s.w(review());
  assert.ok(blocked(s.run()));
});

test('exec-review 뒤 exec-cycle 을 부르면 exec-cycle 규칙으로 돌아간다 — 수정이 없으면 통과', () => {
  const s = scene();
  s.w(review(), cycle(), say('설계 질문'));
  assert.equal(s.run(), null);
});

test('Skill 도구로 exec-review 를 불러도 같다', () => {
  const s = scene();
  const c = call('Skill', { skill: 'exec-review' });
  s.w(c.line, result(c.id, 'ok'));
  assert.ok(blocked(s.run()));
});

test('옛 이름은 알아보지 않는다', () => {
  const s = scene();
  s.w(msg('user', '<command-name>/run-' + 'cycle</command-name>'));
  s.edit();
  assert.equal(s.run(), null);
});

// 27차 ① — 사용자 대기 표지: 사용자 행동을 기다리며 멈출 때는 막지 않는다(마지막 줄에 이유와 함께 보이게 적는다)
const WAIT = '픽스처를 실행해 주세요.\n⏸ 사용자 대기 — DB 픽스처 실행';

test('⭐ 마지막 줄이 「⏸ 사용자 대기 — 이유」면 코드를 고쳤어도 막지 않는다 — Stop 입력으로도 기록으로도', () => {
  const s = scene();
  s.w(cycle());
  s.edit();
  assert.ok(blocked(s.run()));
  assert.equal(s.run({ last_assistant_message: WAIT }), null);
  s.w(say(WAIT));
  assert.equal(s.run(), null);
});

test('⭐ 표지는 마지막 줄 · 이유가 있을 때만 — 중간 줄 · 이유 없음 · 뒤에 다른 말 · 앞선 대기 뒤의 새 수정은 막는다', () => {
  const s = scene();
  s.w(cycle());
  s.edit();
  for (const text of ['⏸ 사용자 대기 — 이유\n그리고 끝났습니다', '⏸ 사용자 대기', '⏸ 사용자 대기 — ', '끝났습니다 ⏸ 사용자 대기 — 이유']) {
    assert.ok(blocked(s.run({ last_assistant_message: text })), text);
  }
  s.w(say(WAIT));
  assert.equal(s.run(), null);
  s.edit('src/b.js');
  s.w(say('이어서 고쳤습니다'));
  assert.ok(blocked(s.run()), '대기 뒤 다시 고치고 끝내려 하면 증거를 요구한다');
});

test('exec-review 도 대기 표지는 통과시킨다', () => {
  const s = scene();
  s.w(review(), say(WAIT));
  assert.equal(s.run(), null);
});

// 27차 ① — verify 는 verify 가 덮는(covers) 파일을 고쳤을 때만 요구한다. ponytail 리뷰는 코드 수정이면 그대로
const COVER = [{ id: 'unit', kind: 'exit-code', cmd: 'node --test', covers: ['src/**'] }];
const withChecks = (checks) => { const s = scene(); put(s.proj, '.harness/harness.json', JSON.stringify({ checks })); s.ids.splice(0, s.ids.length, ...checks.map((c) => c.id)); return s; };

test('⭐ covers 밖 파일(.sql 등)만 고치면 verify 는 안 요구하고 ponytail 리뷰만 요구한다', () => {
  const s = withChecks(COVER);
  s.w(cycle());
  s.edit('db/fixture.sql');
  const out = s.run();
  assert.ok(blocked(out));
  assert.match(out.reason, /ponytail/);
  assert.doesNotMatch(out.reason, /verify/);
  s.w(say(NET));
  assert.equal(s.run(), null);
});

test('⭐ covers 에 걸리는 파일을 고치면 verify 를 요구한다 — 덮지 않는 파일을 섞어도', () => {
  const s = withChecks(COVER);
  s.w(cycle());
  s.edit('db/fixture.sql');
  s.edit('src/a.js');
  s.w(say(NET));
  assert.match(s.run().reason, /verify/);
  s.verify();
  assert.equal(s.run(), null);
});

test('⭐ 덮는 파일 수정 → verify 통과 뒤의 안 덮는 수정은 verify 를 다시 요구하지 않는다 · 덮는 수정이 또 있으면 요구한다', () => {
  const s = withChecks(COVER);
  s.w(cycle());
  s.edit('src/a.js');
  s.verify();
  s.edit('db/fixture.sql');
  s.w(say(NET));
  assert.equal(s.run(), null);
  s.edit('src/b.js');
  s.w(say(NET));
  assert.match(s.run().reason, /verify/);
});

test('⭐ covers 를 가진 검사가 없거나 harness.json 을 못 읽으면 모든 코드 수정에 verify — 지금 그대로', () => {
  for (const checks of [[{ id: 'a', kind: 'exit-code', cmd: 'x' }], []]) {
    const s = withChecks(checks);
    s.w(cycle());
    s.edit('db/fixture.sql');
    s.w(say(NET));
    assert.match(s.run().reason, /verify/);
  }
  const s = scene();
  put(s.proj, '.harness/harness.json', '{깨짐');
  s.w(cycle());
  s.edit('db/fixture.sql');
  s.w(say(NET));
  assert.match(s.run().reason, /verify/);
});

test('exec-review 는 안 덮는 파일만 고쳤어도 verify 를 요구한다 — 검증 전용', () => {
  const s = withChecks(COVER);
  s.w(review());
  s.edit('db/fixture.sql');
  s.w(say(NET));
  assert.match(s.run().reason, /verify/);
});

// 27차 고침 — verify 증거는 실제로 돌렸고 결과가 온전해야 한다
const verifyRun = (cmd, out) => {
  const s = scene();
  s.w(cycle());
  s.edit();
  s.verify(true, cmd, out);
  s.w(say(NET));
  return s.run();
};

test('⭐ verify 파일을 읽는 명령(cat · grep · head · less)은 verify 를 돌린 증거가 아니다', () => {
  for (const cmd of ['cat .harness/tools/verify.mjs', 'grep -n ✅ .harness/tools/verify.mjs', 'head -5 .harness/tools/verify.mjs', 'less .harness/tools/verify.mjs']) {
    assert.match(verifyRun(cmd).reason, /verify/, cmd);
  }
});

test('⭐ node 로 verify 를 돌리는 꼴은 증거다 — 따옴표 경로 · cd 뒤 · 옵션 · 역슬래시 경로 · || true', () => {
  for (const cmd of ['node "C:/p/.harness/tools/verify.mjs"', 'cd /p && node .harness/tools/verify.mjs', 'node --no-warnings .harness/tools/verify.mjs', 'node .harness\\tools\\verify.mjs', 'node .harness/tools/verify.mjs || true', 'echo 시작; node .harness/tools/verify.mjs']) {
    assert.equal(verifyRun(cmd), null, cmd);
  }
});

test('⭐ 잘렸거나 버린 출력은 증거가 아니다 — 검사 id 마다 ✅ 줄이 있어야 한다', () => {
  const s = withChecks([{ id: 'unit', kind: 'exit-code', cmd: 'x', covers: ['src/**'] }, { id: 'lint', kind: 'exit-code', cmd: 'y', covers: ['src/**'] }]);
  s.w(cycle());
  s.edit();
  s.verify(true, 'node .harness/tools/verify.mjs | head -1', '✅ unit — 통과');
  s.w(say(NET));
  assert.match(s.run().reason, /verify/);
  s.verify(true, 'node .harness/tools/verify.mjs > /dev/null 2>&1 || true', '');
  assert.match(s.run().reason, /verify/);
  s.verify(true, 'node .harness/tools/verify.mjs', '✅ unit — 통과\n✅ lint — 통과');
  assert.equal(s.run(), null);
});

test('⭐ 설정을 못 읽으면 ✅ 줄 하나 이상 + ⛔ 없음 · 차단 이유가 출력을 자르지 말라고 한다', () => {
  const s = scene();
  put(s.proj, '.harness/harness.json', '{깨짐');
  s.w(cycle());
  s.edit();
  s.verify(true, undefined, '빈 출력');
  s.w(say(NET));
  const out = s.run();
  assert.match(out.reason, /자르거나 버리지/);
  s.verify(true, undefined, '✅ 아무개 — 통과');
  assert.equal(s.run(), null);
});

// 27차 고침 — 서브에이전트가 고친 것은 기록에 남지 않는다 — 호출 자체를 경로를 모르는 수정으로 친다
test('⭐ 사이클 중 Agent · Task 호출은 수정이다 — 읽기 전용 종류는 아니다 · 사이클 전 호출도 아니다', () => {
  for (const name of ['Agent', 'Task']) {
    const s = withChecks(COVER);
    s.w(cycle());
    s.edit('src/a.js');
    s.verify();
    s.w(say(NET));
    assert.equal(s.run(), null);
    const c = call(name, { subagent_type: 'general-purpose', prompt: '구현' });
    s.w(c.line, result(c.id, '끝'));
    assert.match(s.run().reason, /verify/, name);
  }
  const t = withChecks(COVER);
  t.w(cycle());
  for (const kind of ['Explore', 'Plan', 'claude-code-guide']) {
    const c = call('Agent', { subagent_type: kind, prompt: '조사' });
    t.w(c.line, result(c.id, '끝'));
  }
  assert.equal(t.run(), null);
  const u = scene();
  const c = call('Agent', { subagent_type: 'general-purpose', prompt: '구현' });
  u.w(c.line, result(c.id, '끝'), cycle());
  assert.equal(u.run(), null);
});

// 27차 고침 — Windows 는 경로 대소문자를 가리지 않는다
test('covers 판정은 win32 에서만 대소문자를 무시한다', () => {
  const s = withChecks(COVER);
  s.w(cycle());
  s.edit('Src/a.js');
  s.w(say(NET));
  const out = s.run();
  if (process.platform === 'win32') assert.match(out.reason, /verify/);
  else assert.equal(out, null);
});

// 27차 고침 — 구현 줄마다 지키는 시험
test('⭐ 대기 표지의 줄표는 긴 줄표만 — 하이픈은 막는다', () => {
  const s = scene();
  s.w(cycle());
  s.edit();
  assert.ok(blocked(s.run({ last_assistant_message: '⏸ 사용자 대기 - 이유' })));
  assert.equal(s.run({ last_assistant_message: '⏸ 사용자 대기 — 이유' }), null);
});

test('⭐ 표지 줄 앞 공백 · CRLF · 뒤 빈 줄이 있어도 대기로 본다', () => {
  const s = scene();
  s.w(cycle());
  s.edit();
  for (const text of ['  ⏸ 사용자 대기 — 이유', '설명\r\n⏸ 사용자 대기 — 이유\r\n', '설명\n⏸ 사용자 대기 — 이유\n\n\n', '설명\r\n  ⏸ 사용자 대기 — 이유\r\n\r\n']) {
    assert.equal(s.run({ last_assistant_message: text }), null, JSON.stringify(text));
  }
});

test('⭐ covers 가 둘이면 하나에만 걸려도 verify 를 요구한다', () => {
  const s = withChecks([{ id: 'unit', kind: 'exit-code', cmd: 'x', covers: ['src/**'] }, { id: 'lint', kind: 'exit-code', cmd: 'y', covers: ['lib/**'] }]);
  s.w(cycle());
  s.edit('src/a.js');
  s.w(say(NET));
  assert.match(s.run().reason, /verify/);
});

test('⭐ 경로를 모르는 수정(file_path 없음)은 covers 가 있어도 verify 를 요구한다', () => {
  const s = withChecks(COVER);
  s.w(cycle());
  const c = call('Edit', {});
  s.w(c.line, result(c.id, '수정함'));
  s.w(say(NET));
  assert.match(s.run().reason, /verify/);
});

test('⭐ 리뷰 줄은 텍스트 블록 안 어디에 있어도 · 도구 호출이 이어진 메시지여도 인정한다', () => {
  const s = scene();
  s.w(cycle());
  s.edit();
  s.verify();
  s.w(say('1. L3: delete: x.\nnet: -4 lines possible.\n\n이어지는 말'));
  assert.equal(s.run(), null);
  const t = scene();
  t.w(cycle());
  t.edit();
  t.verify();
  t.w(msg('assistant', [{ type: 'text', text: 'Lean already.' }, { type: 'tool_use', id: 'toolu_x', name: 'Read', input: {} }]));
  assert.equal(t.run(), null);
});

test('⭐ ✅ 줄이 다 있어도 ⛔ 줄이 하나라도 있으면 증거가 아니다 — 오류 표시 없이도', () => {
  const s = scene();
  s.w(cycle());
  s.edit();
  s.verify(true, 'node .harness/tools/verify.mjs || true', '✅ 단위 테스트 — 통과\n⛔ 린트 — 종료코드 1');
  s.w(say(NET));
  assert.ok(blocked(s.run()));
});

test('⭐ covers 패턴이 대문자여도 소문자 경로 수정을 잡는다(win32) — 패턴 쪽 소문자화', () => {
  const s = withChecks([{ id: 'unit', kind: 'exit-code', cmd: 'x', covers: ['Src/**'] }]);
  s.w(cycle());
  s.edit('src/a.js');
  s.w(say(NET));
  const out = s.run();
  if (process.platform === 'win32') assert.match(out.reason, /verify/);
  else assert.equal(out, null);
});

test('⭐ verify 를 돌렸으나 통과하지 않았을 때의 차단 이유도 출력을 자르지 말라고 한다', () => {
  const s = scene();
  s.w(cycle());
  s.edit();
  s.verify(false);
  s.w(say(NET));
  assert.match(s.run().reason, /자르거나 버리지/);
});

test('⭐ verify 를 아예 안 돌렸을 때의 차단 이유도 출력을 자르지 말라고 한다', () => {
  const s = scene();
  s.w(cycle());
  s.edit();
  s.w(say(NET));
  assert.match(s.run().reason, /자르거나 버리지/);
});

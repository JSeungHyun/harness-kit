// /exec-cycle 중에만 도는 종료 훅 — 가짜 세션 기록(JSONL)과 Stop 입력으로 훅을 직접 부른다(26차)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmp } from './scene.mjs';

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
  const verify = (ok = true, cmd = 'node .harness/tools/verify.mjs', out) => {
    const c = call('Bash', { command: cmd });
    w(c.line, result(c.id, out ?? (ok ? '✅ 단위 테스트 — 통과' : 'Exit code 1\n⛔ 단위 테스트 — 종료코드 1'), !ok));
  };
  const run = (extra = {}) => {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', transcript_path: path, cwd: proj, ...extra }), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  };
  return { proj, path, w, edit, verify, run };
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

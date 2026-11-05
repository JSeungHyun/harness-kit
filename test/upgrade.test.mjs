import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { target, repoFile } from './scene.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
const TOOL = join(KIT, 'tools', 'upgrade.mjs');
const RULE = 'templates/rules/harness.md';
const STATE = { decisions: '.harness/state/decisions.md', lessons: '.harness/state/lessons.md' };
const fill = (s) => s.replaceAll('<decisions>', STATE.decisions).replaceAll('<lessons>', STATE.lessons)
  .replaceAll('<graph-tools>', '.harness/tools').replaceAll('<graph-rules>', '`.claude/rules/graph.md`');
// 키트 이력의 첫 버전 — 실제 설치 3곳의 규칙이 이것에 장부 경로를 채운 것과 같았다
const first = execFileSync('git', ['-C', KIT, 'rev-list', '--reverse', 'HEAD', '--', RULE], { encoding: 'utf8' }).split('\n')[0];
const oldRule = fill(execFileSync('git', ['-C', KIT, 'show', `${first}:${RULE}`], { encoding: 'utf8' }));

function installed(rule = oldRule, settings = { enabledPlugins: { 'ponytail@ponytail': true, 'superpowers@claude-plugins-official': false } }) {
  return target({ profile: 'existing', mode: 'local', state: STATE, checks: [{ id: 't', cmd: 'npm test', kind: 'junit-xml', evidence: 'r' }] }, {
    '.claude/rules/harness.md': rule,
    '.claude/skills/final-gate/SKILL.md': repoFile('templates/skills/final-gate/SKILL.md'),
    '.claude/settings.local.json': JSON.stringify(settings),
    '.harness/lib/evidence.mjs': '// 옛 판정',
  });
}
const run = (dir) => spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8' });
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8').replace(/\r\n/g, '\n');

test('⭐ 옛 설치 — 도구는 지금 것으로, 손대지 않은 규칙은 장부 경로를 채운 채 갱신한다', () => {
  const dir = installed();
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(dir, '.harness/lib/evidence.mjs'), repoFile('lib/evidence.mjs').replace(/\r\n/g, '\n'));
  assert.ok(existsSync(join(dir, '.harness/tools/gate-hook.mjs')));
  assert.equal(read(dir, '.claude/rules/harness.md'), fill(repoFile(RULE)).replace(/\r\n/g, '\n'));
  assert.match(r.stdout, /harness\.md — 갱신/);
  assert.match(r.stdout, /graph\.md — 없다/);
  assert.ok(!existsSync(join(dir, '.claude/rules/graph.md')));
});

test('⛔ 프로젝트가 고친 규칙은 덮어쓰지 않고 병합을 안내한다', () => {
  const mine = `${oldRule}\n- 이 프로젝트가 승격한 규칙\n`;
  const dir = installed(mine);
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(dir, '.claude/rules/harness.md'), mine.replace(/\r\n/g, '\n'));
  assert.match(r.stdout, /⚠️ \.claude\/rules\/harness\.md — .*손대지 않았다/);
});

test('⭐ 설정은 쓰지 않는다 — 옛 플러그인 정리 · 정책 반영 명령을 낸다', () => {
  const dir = installed();
  const before = read(dir, '.claude/settings.local.json');
  const r = run(dir);
  assert.equal(read(dir, '.claude/settings.local.json'), before);
  // 옛 id 선언(ponytail@ponytail: true)은 policy-apply 가 걷는다 — --off 를 내지 않는다
  assert.match(r.stdout, /node \.harness\/tools\/policy-apply\.mjs --local --with gate-hook$/m);
});

test('⛔ 관문 훅만 건 설치(--only gate-hook)에는 정책 전체를 안내하지 않는다 — 받지 않은 권한 · ponytail 끄기 · 플러그인이 들어간다', () => {
  const dir = installed(oldRule, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.harness/tools/gate-hook.mjs"' }] }] } });
  const r = run(dir);
  assert.match(r.stdout, /node \.harness\/tools\/policy-apply\.mjs --local --only gate-hook$/m);
  assert.doesNotMatch(r.stdout, /--with gate-hook/);
  // 그 대상이 ponytail 을 스스로 켜 두어도(지시 파일의 모드) 정책 전체 설치로 읽지 않는다
  const own = run(installed(oldRule, { enabledPlugins: { 'ponytail@harness-kit': true }, env: { PONYTAIL_DEFAULT_MODE: 'lite' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.harness/tools/gate-hook.mjs'] }] }] } }));
  assert.match(own.stdout, /policy-apply\.mjs --local --only gate-hook$/m);
});

test('⭐ 키트 그래프 훅을 건 설치에는 --with graph-hook 도 낸다 — 옛 셸 형식 등록을 새 형식으로 바꾼다 · 그 프로젝트 자신의 그래프 훅은 아니다', () => {
  const hook = (cmd) => ({ UserPromptSubmit: [{ hooks: [{ type: 'command', command: cmd }] }] });
  const kit = run(installed(oldRule, { enabledPlugins: { 'ponytail@harness-kit': true }, hooks: hook('node "$CLAUDE_PROJECT_DIR/.harness/tools/graph-hook.mjs"') }));
  assert.match(kit.stdout, /policy-apply\.mjs --local --with gate-hook --with graph-hook$/m);
  const own = run(installed(oldRule, { enabledPlugins: { 'ponytail@harness-kit': true }, hooks: hook('node "$CLAUDE_PROJECT_DIR/tools/graph-hook.mjs"') }));
  assert.match(own.stdout, /policy-apply\.mjs --local --with gate-hook$/m);
});

test('⭐ 그래프가 이미 있는 대상 — 키트 그래프 도구를 넣지 않고 규칙이 그 프로젝트의 그래프를 가리킨다', () => {
  const graph = { tools: 'tools', rules: '`AGENTS.md` 의 그래프 기록 절' };
  const dir = target({ profile: 'existing', mode: 'local', graph, state: STATE, checks: [{ id: 't', cmd: 'npm test', kind: 'exit-code' }] }, {
    '.claude/rules/harness.md': oldRule,
    '.claude/skills/final-gate/SKILL.md': 'x',
  });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dir, '.harness/tools/verify.mjs')));
  assert.deepEqual(readdirSync(join(dir, '.harness/tools')).filter((f) => f.startsWith('graph-')), []);
  assert.ok(!existsSync(join(dir, '.harness/policy/graph-hook.json')));
  const rule = read(dir, '.claude/rules/harness.md');
  assert.match(rule, /node tools\/graph-find\.mjs --check/);
  assert.match(rule, /`AGENTS\.md` 의 그래프 기록 절/);
  assert.doesNotMatch(rule, /<graph-|\.harness\/tools\/graph-/);
});

test('⛔ 대상에 복사된 사본으로 돌리면 거부한다 — 사본은 자기 위치를 키트로 알아 엉뚱한 경로를 쓴다', () => {
  const dir = installed();
  run(dir);
  for (const tool of ['upgrade.mjs', 'plugin-plan.mjs']) {
    const r = spawnSync(process.execPath, [join(dir, '.harness', 'tools', tool), dir], { encoding: 'utf8' });
    assert.equal(r.status, 1, tool);
    assert.match(r.stderr, /키트 저장소의/, tool);
  }
});

test('⛔ 설치되지 않은 대상은 거부한다', () => {
  const r = run(target(null));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SETUP/);
});

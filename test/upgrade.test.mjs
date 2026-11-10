import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { target, repoFile, put, gitRepo } from './scene.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
const TOOL = join(KIT, 'tools', 'upgrade.mjs');
const RULE = 'templates/rules/harness.md';
const STATE = { decisions: '.harness/state/decisions.md', lessons: '.harness/state/lessons.md' };
const fill = (s) => s.replaceAll('<decisions>', STATE.decisions).replaceAll('<lessons>', STATE.lessons)
  .replaceAll('<graph-tools>', '.harness/tools').replaceAll('<graph-rules>', '`.claude/rules/graph.md`');
// 키트 이력의 첫 버전 — 실제 설치 3곳의 규칙이 이것에 장부 경로를 채운 것과 같았다
const first = execFileSync('git', ['-C', KIT, 'rev-list', '--reverse', 'HEAD', '--', RULE], { encoding: 'utf8' }).split('\n')[0];
// 지운 대장 템플릿 — 지운 커밋의 부모에서 읽는다(HEAD 에는 없다)
const deleted = execFileSync('git', ['-C', KIT, 'rev-list', '-n', '1', 'HEAD', '--', 'templates/state/current.md'], { encoding: 'utf8' }).trim();
const CURRENT = execFileSync('git', ['-C', KIT, 'show', `${deleted}^:templates/state/current.md`], { encoding: 'utf8' });
const oldRule = fill(execFileSync('git', ['-C', KIT, 'show', `${first}:${RULE}`], { encoding: 'utf8' }));

function installed(rule = oldRule, settings = { enabledPlugins: { 'ponytail@ponytail': true, 'superpowers@claude-plugins-official': false } }) {
  return target({ profile: 'existing', mode: 'local', state: STATE, checks: [{ id: 't', cmd: 'npm test', kind: 'junit-xml', evidence: 'r' }] }, {
    '.claude/rules/harness.md': rule,
    '.claude/skills/final-gate/SKILL.md': fill(repoFile('templates/skills/final-gate/SKILL.md')),
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

test('⛔ 프로젝트가 고친 규칙은 덮어쓰지 않고 ⛔(exit 1) — 다른 줄 요약과 고친 줄을 옮기는 명령을 낸다(12차)', () => {
  const mine = `${oldRule}\n- 이 프로젝트가 승격한 규칙\n`;
  const dir = installed(mine);
  const r = run(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(read(dir, '.claude/rules/harness.md'), mine.replace(/\r\n/g, '\n'));
  assert.match(r.stdout, /⛔ \.claude\/rules\/harness\.md — 프로젝트가 고쳤다 \+1 −0/);
  assert.match(r.stdout, /이 프로젝트가 승격한 규칙/);
  assert.match(r.stdout, /tools\/upgrade\.mjs .* --own-rules/);
  assert.doesNotMatch(r.stdout, /병합/);
});

// 키트 첫 판에 프로젝트가 한 줄을 고치고(뺌 + 더함) 절 하나를 더한 설치본
const section = (s) => s.split('\n').findIndex((l) => l.startsWith('## '));
function edited() {
  const lines = oldRule.split('\n');
  const at = section(oldRule) + 1;
  const gone = lines.slice(at).find((l) => l.startsWith('- '));
  const mine = lines.map((l) => (l === gone ? '- 이 프로젝트는 계획 문서를 늘 쓴다' : l)).join('\n').concat('\n## 이 프로젝트의 배포\n\n- 배포 전 정확성 리뷰를 한 번 더 한다\n');
  return { mine, gone, heading: lines[at - 1] };
}

test('⭐ --own-rules — 고친 줄을 .claude/rules/project-harness.md 로 옮기고 키트 판을 다시 깐다 · 다시 돌려도 같다', () => {
  const { mine, gone, heading } = edited();
  const dir = installed(mine);
  const r = spawnSync(process.execPath, [TOOL, dir, '--own-rules'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(read(dir, '.claude/rules/harness.md'), fill(repoFile(RULE)).replace(/\r\n/g, '\n'));
  const own = read(dir, '.claude/rules/project-harness.md');
  // 바꾼 줄은 그 절 제목 아래로 · 더한 절은 그대로 · 뺀 키트 줄은 「따르지 않는다」로
  assert.ok(own.indexOf(heading) < own.indexOf('- 이 프로젝트는 계획 문서를 늘 쓴다'), own);
  assert.match(own, /## 이 프로젝트의 배포\n- 배포 전 정확성 리뷰를 한 번 더 한다/);
  assert.ok(own.includes(`> ${gone}`), own);
  assert.match(own, /이 파일이 이긴다/);
  assert.match(r.stdout, /project-harness\.md/);
  const again = spawnSync(process.execPath, [TOOL, dir, '--own-rules'], { encoding: 'utf8' });
  assert.equal(again.status, 0);
  assert.equal(read(dir, '.claude/rules/project-harness.md'), own);
});

test('⛔ --own-rules 가 만든 파일도 로컬 전용이면 git 에서 숨긴다 — 로컬 설치는 아무것도 git 에 보이지 않는다', () => {
  const { dir, env, git } = gitRepo({});
  for (const [rel, body] of Object.entries({ '.harness/harness.json': JSON.stringify({ profile: 'existing', mode: 'local', state: STATE, checks: [] }),
    '.claude/rules/harness.md': edited().mine, '.claude/skills/final-gate/SKILL.md': fill(repoFile('templates/skills/final-gate/SKILL.md')) })) put(dir, rel, body);
  put(dir, '.git/info/exclude', '/.harness/\n/.claude/rules/harness.md\n/.claude/skills/final-gate/\n');
  const r = spawnSync(process.execPath, [TOOL, dir, '--own-rules'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(dir, '.claude/rules/project-harness.md')));
  assert.equal(git('status', '--porcelain'), '');
});

test('⭐ 갱신이 키트 커밋을 설치본에 기록한다 — 이식 검사 ⑨ 가 키트의 지금 커밋과 비교한다', () => {
  const dir = installed();
  run(dir);
  assert.equal(read(dir, '.harness/kit-commit').trim(), execFileSync('git', ['-C', KIT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
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
    '.claude/skills/final-gate/SKILL.md': repoFile('templates/skills/final-gate/SKILL.md').replaceAll('<decisions>', STATE.decisions).replaceAll('<lessons>', STATE.lessons).replaceAll('<graph-tools>', graph.tools).replaceAll('<graph-rules>', graph.rules),
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
  for (const tool of ['upgrade.mjs', 'plugin-plan.mjs', 'install-check.mjs']) {
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

test('⭐ 키트에서 지운 도구 · lib 는 설치본에서도 걷는다 — 복사는 덮어쓰기만 한다 · 프로젝트가 더한 도구는 둔다', () => {
  const dir = installed();
  for (const f of ['.harness/tools/state-check.mjs', '.harness/tools/lesson-promote.mjs', '.harness/lib/mdtable.mjs', '.harness/tools/our-tool.mjs']) put(dir, f, '// 옛 것');
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['.harness/tools/state-check.mjs', '.harness/tools/lesson-promote.mjs', '.harness/lib/mdtable.mjs']) assert.ok(!existsSync(join(dir, f)), f);
  assert.ok(existsSync(join(dir, '.harness/tools/our-tool.mjs')));
  assert.match(r.stdout, /걷음.*state-check\.mjs/);
});

test('⭐ 지운 템플릿은 손대지 않은 설치본만 걷는다 — 쓴 대장은 남기고 알린다', () => {
  const untouched = target({ profile: 'existing', mode: 'local', state: { ...STATE, current: '.harness/state/current.md' }, checks: [] }, {
    '.harness/state/current.md': CURRENT,
  });
  assert.match(run(untouched).stdout, /걷음.*current\.md/);
  assert.ok(!existsSync(join(untouched, '.harness/state/current.md')));
  const used = target({ profile: 'existing', mode: 'local', state: { ...STATE, current: '.harness/state/current.md' }, checks: [] }, {
    '.harness/state/current.md': `${CURRENT}| \`src/a.mjs\` | 분석완료 | \`abc\` | |\n`,
  });
  assert.match(run(used).stdout, /⚠️ \.harness\/state\/current\.md — .*남겼다/);
  assert.ok(existsSync(join(used, '.harness/state/current.md')));
});

test('⛔ 빌드 · 테스트 단서가 보이는데 covers 를 가진 검사가 없으면 갱신 보고를 ⛔ 로 멈춘다(exit 1)', () => {
  const pkg = { 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) };
  const bare = target({ profile: 'existing', mode: 'local', state: STATE, checks: [{ id: 't', cmd: 'npm test', kind: 'exit-code' }] }, pkg);
  const r = run(bare);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /⛔ .*package\.json test.*covers/);
  const covered = target({ profile: 'existing', mode: 'local', state: STATE, checks: [{ id: 't', cmd: 'npm test', kind: 'exit-code', covers: ['src/**'] }] }, pkg);
  assert.equal(run(covered).status, 0);
});

test('⭐ 지우는 경로를 살아있는 그래프 기록이 가리키면 목록을 낸다 — 그대로 두면 --check 빨강 → verify 빨강', () => {
  const rec = (req, files, extra = {}) => JSON.stringify({ date: '2026-10-01', recorded: '2026-10-01', req, files, ...extra });
  const dir = installed();
  put(dir, '.harness/graph/requests.jsonl', [rec('대장 점검 도구 사용법', ['.harness/tools/state-check.mjs']), rec('옛 기록', ['.harness/tools/lesson-promote.mjs']),
    rec('새 기록', [], { supersedes: '옛 기록' })].join('\n'));
  const r = run(dir);
  assert.match(r.stdout, /그래프 기록이 지운 경로를 가리킨다/);
  assert.match(r.stdout, /state-check\.mjs ← 대장 점검 도구 사용법/);
  assert.doesNotMatch(r.stdout, /← 옛 기록/);
});

test('⛔ 「지운 것」 목록이 키트와 맞는다 — 지운 도구 · 템플릿이 키트에 남거나 allow 가 정책에 남으면 갱신이 다시 넣는다', () => {
  const removed = JSON.parse(repoFile('policy/removed.json'));
  for (const f of removed.files) assert.ok(!existsSync(join(KIT, f.replace(/^\.harness\//, ''))), f);
  for (const src of Object.keys(removed.templates)) assert.ok(!existsSync(join(KIT, src)), src);
  const allow = JSON.parse(repoFile('policy/settings.json')).permissions.allow;
  for (const a of removed.allow) assert.ok(!allow.includes(a), a);
});

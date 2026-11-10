import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { target, put, repoFile, tmp } from './scene.mjs';
import { checkInstall } from '../tools/install-check.mjs';
import { applyPolicy } from '../tools/policy-apply.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
const TOOL = join(KIT, 'tools', 'install-check.mjs');
const HEAD = execFileSync('git', ['-C', KIT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const pin = (name) => JSON.parse(repoFile('.claude-plugin/marketplace.json')).plugins.find((p) => p.name === name);
const STATE = { decisions: '.harness/state/decisions.md', lessons: '.harness/state/lessons.md' };
const fill = (s) => s.replaceAll('<decisions>', STATE.decisions).replaceAll('<lessons>', STATE.lessons)
  .replaceAll('<graph-tools>', '.harness/tools').replaceAll('<graph-rules>', '`.claude/rules/graph.md`');
const CHECK = { id: 't', cmd: 'node -e "0"', kind: 'exit-code', covers: ['src/**'] };

// ⑥ 은 PC 상태라 대상 밖이다 — 가짜 사용자 폴더에 고정 커밋에서 받은 리뷰 스킬을 둔다
function pc(skill = '---\nname: ponytail-review\n---\n리뷰\n', sha = pin('ponytail').source.sha) {
  const dir = tmp('claudecfg-');
  put(dir, 'skills/ponytail-review/SKILL.md', skill);
  put(dir, 'skills/ponytail-review/.pinned.json', JSON.stringify({ sha, sha256: createHash('sha256').update(skill).digest('hex') }));
  return dir;
}
process.env.CLAUDE_CONFIG_DIR = pc();
const PLUGINS = [{ id: 'superpowers@harness-kit', scope: 'user', enabled: true, version: pin('superpowers').version }];

// SETUP ②~⑥ 대로 얹은 대상 — 키트 판 그대로
function installed({ mode = 'local', profile = 'existing', checks = [CHECK], files = {} } = {}) {
  const dir = target({ profile, mode, state: STATE, checks });
  for (const d of ['lib', 'tools', 'policy']) cpSync(join(KIT, d), join(dir, '.harness', d), { recursive: true });
  for (const [src, dst] of [['templates/rules/harness.md', '.claude/rules/harness.md'], ['templates/rules/graph.md', '.claude/rules/graph.md'],
    ['templates/skills/final-gate/SKILL.md', '.claude/skills/final-gate/SKILL.md'], ['templates/state/decisions.md', STATE.decisions], ['templates/state/lessons.md', STATE.lessons]]) {
    put(dir, dst, fill(repoFile(src)));
  }
  const local = mode !== 'share';
  put(dir, `.claude/${local ? 'settings.local.json' : 'settings.json'}`, JSON.stringify(applyPolicy({}, { local, extra: ['gate-hook'] }).settings));
  put(dir, local ? 'CLAUDE.local.md' : 'CLAUDE.md', '# 지도\n');
  put(dir, '.harness/kit-commit', `${HEAD}\n`);
  for (const [rel, body] of Object.entries(files)) put(dir, rel, body);
  return dir;
}
const check = (dir, plugins = PLUGINS) => Object.fromEntries(checkInstall(dir, { plugins }).map((r) => [r.n, r]));
const bad = (rows) => Object.values(rows).filter((r) => !r.ok).map((r) => r.n);

test('⭐ 키트대로 얹은 대상은 ①~⑨ 모두 ✅ — 로컬 · 공유', () => {
  const local = check(installed());
  assert.deepEqual(Object.keys(local), ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']);
  assert.deepEqual(bad(local), [], JSON.stringify(local, null, 1));
  assert.deepEqual(bad(check(installed({ mode: 'share' }))), []);
});

test('다를 수 있는 것은 보지 않는다 — 그래프 데이터 · 장부 본문 · 기준선 · 검사 명령 · 지시 파일 본문 · 프로젝트가 더한 도구', () => {
  const dir = installed({ files: {
    '.harness/graph/requests.jsonl': `${JSON.stringify({ date: '2026-10-01', recorded: '2026-10-01', req: '주문 취소', terms: { 취소: 'order.cancel' } })}\n`,
    [STATE.lessons]: '# 교훈\n| L1 | 증상 | 원인 | 검증 부족 | |\n',
    '.harness/baseline/t.txt': 'a::b\n',
    'CLAUDE.local.md': '# 이 프로젝트의 지도\n- 빌드: <모듈>/gradlew\n',
    '.harness/tools/our-tool.mjs': '// 프로젝트 것',
  } });
  assert.deepEqual(bad(check(dir)), []);
});

test('⛔ ① 키트 도구가 키트 판과 다르거나 지운 도구가 남으면 — 줄바꿈만 다른 것은 같다', () => {
  const dir = installed({ files: { '.harness/tools/state-check.mjs': '// 지운 도구' } });
  writeFileSync(join(dir, '.harness/tools/verify.mjs'), '// 옛 판');
  writeFileSync(join(dir, '.harness/lib/config.mjs'), repoFile('lib/config.mjs').replace(/\r?\n/g, '\r\n'));
  const r = check(dir)['①'];
  assert.equal(r.ok, false);
  assert.match(r.observed, /verify\.mjs/);
  assert.match(r.observed, /state-check\.mjs/);
  assert.doesNotMatch(r.observed, /config\.mjs/);
});

test('⛔ ① 키트 템플릿에서 지운 장부 줄이 장부에 남으면 — 관측에 파일:행', () => {
  const [gone] = JSON.parse(repoFile('policy/removed.json')).lines['templates/state/lessons.md'];
  const lessons = fill(repoFile('templates/state/lessons.md')).replace(/\r\n/g, '\n');
  const r = check(installed({ files: { [STATE.lessons]: `${lessons}${gone}\n` } }))['①'];
  assert.equal(r.ok, false);
  assert.match(r.observed, new RegExp(`지운 장부 줄 남음 \\.harness/state/lessons\\.md:${lessons.split('\n').length}`));
});

test('⛔ ② ③ 프로젝트가 고친 규칙 · 스킬은 ⛔ + 다른 줄 요약 — 옛 키트 판이면 갱신을, 고쳤으면 --own-rules 를 가리킨다', () => {
  const first = execFileSync('git', ['-C', KIT, 'rev-list', '--reverse', 'HEAD', '--', 'templates/rules/harness.md'], { encoding: 'utf8' }).split('\n')[0];
  const old = fill(execFileSync('git', ['-C', KIT, 'show', `${first}:templates/rules/harness.md`], { encoding: 'utf8' }));
  const mine = installed({ files: {
    '.claude/rules/harness.md': `${fill(repoFile('templates/rules/harness.md'))}\n- 이 프로젝트는 배포 전에 정확성 리뷰를 한 번 더 한다\n`,
    '.claude/skills/final-gate/SKILL.md': fill(repoFile('templates/skills/final-gate/SKILL.md')).replace(/^4\. .*$/m, '4. 이 프로젝트의 단계'),
  } });
  const rows = check(mine);
  assert.equal(rows['②'].ok, false);
  assert.match(rows['②'].observed, /\+1 −0/);
  assert.match(rows['②'].observed, /정확성 리뷰를 한 번 더/);
  assert.match(rows['②'].observed, /--own-rules/);
  assert.equal(rows['③'].ok, false);
  assert.match(rows['③'].observed, /\+1 −1/);
  const outdated = check(installed({ files: { '.claude/rules/harness.md': old } }))['②'];
  assert.equal(outdated.ok, false);
  assert.match(outdated.observed, /옛 키트 판/);
});

test('⛔ ④ policy-apply 를 다시 돌리면 바뀌는 것이 있으면 — 빠진 권한 · 셸 형식 관문 훅 · 지운 도구 allow', () => {
  const settings = applyPolicy({}, { local: true, extra: ['gate-hook'] }).settings;
  settings.permissions.deny = settings.permissions.deny.slice(1);
  settings.permissions.allow.push('Bash(node .harness/tools/state-check.mjs)');
  settings.hooks.Stop = [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.harness/tools/gate-hook.mjs"' }] }];
  const r = check(installed({ files: { '.claude/settings.local.json': JSON.stringify(settings) } }))['④'];
  assert.equal(r.ok, false);
  assert.match(r.observed, /permissions\.deny/);
  assert.match(r.observed, /permissions\.allow/);
  assert.match(r.observed, /hooks\.Stop/);
});

test('④ 관문 훅만 건 설치(--only gate-hook — 지시 파일이 권한을 정한 대상)는 그 모양대로 본다 · 키트 그래프 훅을 켠 설치는 그 훅도 본다', () => {
  const only = applyPolicy({ env: { PONYTAIL_DEFAULT_MODE: 'lite' } }, { local: true, extra: ['gate-hook'], only: true }).settings;
  const r = check(installed({ files: { '.claude/settings.local.json': JSON.stringify(only) } }))['④'];
  assert.equal(r.ok, true, r.observed);
  assert.match(r.observed, /관문 훅만/);
  const oldGraphHook = applyPolicy({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.harness/tools/graph-hook.mjs"' }] }] } }, { local: true, extra: ['gate-hook'] }).settings;
  const g = check(installed({ files: { '.claude/settings.local.json': JSON.stringify(oldGraphHook) } }))['④'];
  assert.equal(g.ok, false);
  assert.match(g.observed, /hooks\.UserPromptSubmit/);
});

test('⛔ ⑤ harness.json — 빌드 · 테스트 단서가 있는데 covers 검사가 없으면 · 장부가 없으면 · 모드 값이 틀리면', () => {
  const bare = check(installed({ checks: [{ id: 't', cmd: 'node -e "0"', kind: 'exit-code' }], files: { 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) } }))['⑤'];
  assert.equal(bare.ok, false);
  assert.match(bare.observed, /covers/);
  const dir = installed();
  writeFileSync(join(dir, '.harness/harness.json'), JSON.stringify({ profile: 'existing', mode: 'locale', state: { ...STATE, lessons: '.harness/state/없음.md' }, checks: [CHECK] }));
  const r = check(dir)['⑤'];
  assert.equal(r.ok, false);
  assert.match(r.observed, /mode/);
  assert.match(r.observed, /없음\.md/);
});

test('⛔ ⑥ PC — plugin-plan 이 낼 명령이 있으면 · 목록을 못 읽으면 · 리뷰 스킬이 고정 커밋에서 받은 그대로가 아니면', () => {
  const dir = installed();
  const old = check(dir, [{ ...PLUGINS[0], version: '6.1.1' }])['⑥'];
  assert.equal(old.ok, false);
  assert.match(old.observed, /claude plugin update superpowers@harness-kit/);
  assert.match(check(dir, null)['⑥'].observed, /목록을 읽지 못함/);
  const keep = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = pc(undefined, '0'.repeat(40));
    const stale = check(dir)['⑥'];
    assert.equal(stale.ok, false);
    assert.match(stale.observed, /--review-skill/);
  } finally { process.env.CLAUDE_CONFIG_DIR = keep; }
});

test('⛔ ⑦ AGENTS.md 가 있는데 Claude 지시 파일이 import 하지 않으면 — 공유는 커밋되는 CLAUDE.md 가 해야 한다', () => {
  assert.equal(check(installed({ files: { 'AGENTS.md': '# 지도' } }))['⑦'].ok, false);
  assert.equal(check(installed({ files: { 'AGENTS.md': '# 지도', 'CLAUDE.local.md': '@AGENTS.md\n' } }))['⑦'].ok, true);
  assert.equal(check(installed({ mode: 'share', files: { 'AGENTS.md': '# 지도', 'CLAUDE.local.md': '@AGENTS.md\n' } }))['⑦'].ok, false);
});

test('⛔ ⑧ 동작 — verify 가 실패하거나 관문 훅이 합성 입력(코드 변경 + 리뷰 없음)에 되돌리지 않으면', () => {
  const red = check(installed({ checks: [{ ...CHECK, cmd: 'node -e "process.exit(1)"' }] }))['⑧'];
  assert.equal(red.ok, false);
  assert.match(red.observed, /verify exit 1/);
  const dir = installed();
  writeFileSync(join(dir, '.harness/tools/gate-hook.mjs'), 'process.exit(0)');
  const mute = check(dir)['⑧'];
  assert.equal(mute.ok, false);
  assert.match(mute.observed, /관문 훅/);
});

test('⑧ 신규 대상의 첫 테스트 전 「실행된 테스트가 0개」는 정상이다 — 기존 대상은 ⛔', () => {
  // 테스트가 아직 없는 러너는 testcase 0개인 XML 을 쓴다
  const empty = 'node -e "require(\'fs\').mkdirSync(\'r\',{recursive:true});require(\'fs\').writeFileSync(\'r/j.xml\',\'<testsuites></testsuites>\')"';
  const junit = [{ id: 't', cmd: empty, kind: 'junit-xml', evidence: 'r', covers: ['src/**'] }];
  assert.equal(check(installed({ profile: 'new', checks: junit }))['⑧'].ok, true);
  assert.equal(check(installed({ profile: 'existing', checks: junit }))['⑧'].ok, false);
});

test('⛔ ⑨ 설치본이 기록한 키트 커밋이 없거나 키트의 지금 커밋과 다르면', () => {
  const none = installed();
  writeFileSync(join(none, '.harness/kit-commit'), '');
  assert.equal(check(none)['⑨'].ok, false);
  assert.match(check(installed({ files: { '.harness/kit-commit': `${'0'.repeat(40)}\n` } }))['⑨'].observed, /0000000/);
});

test('⛔ CLI — 하나라도 ⛔ 면 exit 1 · 표 끝에 판정 줄 · 대상의 사본으로 돌리면 거부', () => {
  const dir = installed({ files: { '.harness/kit-commit': '' } });
  const r = spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: pc() } });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /^\| ⑨ \|.*\| ⛔ \|$/m);
  assert.match(r.stdout, /^⛔ 이식 실패 — /m);
  const copy = spawnSync(process.execPath, [join(dir, '.harness', 'tools', 'install-check.mjs'), dir], { encoding: 'utf8' });
  assert.equal(copy.status, 1);
  assert.match(copy.stderr, /키트 저장소의/);
});

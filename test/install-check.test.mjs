import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { target, put, repoFile, tmp, kitRepo } from './scene.mjs';
import { applyMode } from '../tools/install-mode.mjs';
import { checkInstall, checkAll, custom } from '../tools/install-check.mjs';
import { partOf } from '../lib/parts.mjs';
import { applyPolicy } from '../tools/policy-apply.mjs';
import { upgrade } from '../tools/upgrade.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
const TOOL = join(KIT, 'tools', 'install-check.mjs');
const HEAD = execFileSync('git', ['-C', KIT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const pin = (name) => JSON.parse(repoFile('.claude-plugin/marketplace.json')).plugins.find((p) => p.name === name);
const STATE = { decisions: '.harness/state/decisions.md', lessons: '.harness/state/lessons.md' };
const fill = (s) => s.replaceAll('<decisions>', STATE.decisions).replaceAll('<lessons>', STATE.lessons)
  .replaceAll('<graph-tools>', '.harness/tools').replaceAll('<graph-rules>', '`.claude/rules/graph.md`');
const CHECK = { id: 't', cmd: 'node -e "0"', kind: 'exit-code', covers: ['src/**'], why: '시험용 명령 — 처방 밖' };

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
    ['templates/skills/final-gate/SKILL.md', '.claude/skills/final-gate/SKILL.md'], ['templates/agents/kit-implementer.md', '.claude/agents/kit-implementer.md'], ['templates/agents/kit-verifier.md', '.claude/agents/kit-verifier.md'], ['templates/state/decisions.md', STATE.decisions], ['templates/state/lessons.md', STATE.lessons]]) {
    put(dir, dst, fill(repoFile(src)));
  }
  const local = mode !== 'share';
  put(dir, `.claude/${local ? 'settings.local.json' : 'settings.json'}`, JSON.stringify(applyPolicy({}, { local }).settings));
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
  assert.deepEqual(bad(check(shared())), []);
});

// 공유 설치는 git 저장소이고 install-mode share 를 거쳤다
function shared() {
  const dir = installed({ mode: 'share' });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  applyMode('share', dir);
  return dir;
}

test('⛔ 공유 설치인데 기록 파일이 merge=union 이 아니면 ⑤ 가 잡고 install-mode share 를 처방한다 — 로컬 설치는 보지 않는다 (18차)', () => {
  const dir = installed({ mode: 'share' });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const before = check(dir)['⑤'];
  assert.equal(before.ok, false);
  assert.match(before.observed, /merge=union.*install-mode\.mjs share/);
  applyMode('share', dir);
  assert.equal(check(dir)['⑤'].ok, true);
  const local = installed();
  execFileSync('git', ['init', '-q'], { cwd: local });
  assert.equal(check(local)['⑤'].ok, true);
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

test('⛔ ④ policy-apply 를 다시 돌리면 바뀌는 것이 있으면 — 빠진 권한 · 걷은 관문 훅의 옛 등록 · 지운 도구 allow', () => {
  const settings = applyPolicy({}, { local: true }).settings;
  settings.permissions.deny = settings.permissions.deny.slice(1);
  settings.permissions.allow.push('Bash(node .harness/tools/state-check.mjs)');
  settings.hooks = { Stop: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.harness/tools/gate-hook.mjs"' }] }] };
  const r = check(installed({ files: { '.claude/settings.local.json': JSON.stringify(settings) } }))['④'];
  assert.equal(r.ok, false);
  assert.match(r.observed, /permissions\.deny/);
  assert.match(r.observed, /permissions\.allow/);
  assert.match(r.observed, /hooks\.Stop/);
});

test('④ 키트 정책을 받지 않은 설치(--only — 지시 파일이 권한을 정한 대상)는 그 모양대로 본다 · 키트 그래프 훅을 켠 설치는 그 훅도 본다', () => {
  const only = applyPolicy({ env: { PONYTAIL_DEFAULT_MODE: 'lite' } }, { local: true, only: true }).settings;
  const r = check(installed({ files: { '.claude/settings.local.json': JSON.stringify(only) } }))['④'];
  assert.equal(r.ok, true, r.observed);
  assert.match(r.observed, /키트 정책 없음/);
  const oldGraphHook = applyPolicy({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.harness/tools/graph-hook.mjs"' }] }] } }, { local: true }).settings;
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

test('⛔ ⑧ 동작 — verify 가 실패하면', () => {
  const red = check(installed({ checks: [{ ...CHECK, cmd: 'node -e "process.exit(1)"' }] }))['⑧'];
  assert.equal(red.ok, false);
  assert.match(red.observed, /verify exit 1/);
  assert.doesNotMatch(red.observed, /관문 훅/);
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

test('⛔ ⑨ 커밋 안 된 키트로 갱신한 설치(kit-commit <sha>-dirty) — 커밋 뒤 다시 갱신', () => {
  const r = check(installed({ files: { '.harness/kit-commit': `${HEAD}-dirty\n` } }))['⑨'];
  assert.equal(r.ok, false);
  assert.match(r.observed, /커밋 안 된 키트로 갱신됨 — 커밋 뒤 다시 갱신/);
});

test('⭐ ⑨ 설치본 커밋 뒤 키트가 내보내지 않는 것(문서)만 바꿨으면 ✅ — 내보내는 경로가 바뀌었거나 키트가 모르는 커밋이면 ⛔ · --all 도 같은 판정', () => {
  const kit = kitRepo();
  const root = tmp('installs-');
  const dir = join(root, 'a');
  cpSync(installed({ files: { '.harness/kit-commit': `${kit.sha}\n` } }), dir, { recursive: true });
  const env = { ...kit.env, CLAUDE_CONFIG_DIR: pc() };
  const run = (args) => spawnSync(process.execPath, [join(kit.dir, 'tools', 'install-check.mjs'), ...args], { encoding: 'utf8', env }).stdout;
  const nine = () => run([dir]).match(/^\| ⑨ \| .*$/m)?.[0] ?? '';
  const commit = (rel) => { put(kit.dir, rel, `${rel}\n`); kit.git('add', '-A'); kit.git('commit', '-q', '-m', rel); return kit.git('rev-parse', 'HEAD').trim(); };

  const docs = commit('docs/plan.md');
  assert.match(nine(), new RegExp(`설치본 ${kit.sha.slice(0, 7)} · 키트 ${docs.slice(0, 7)} \\(그 뒤 문서만 바뀜\\) \\| ✅ \\|$`));
  assert.match(run(['--all', root]), /^\| a \| .*그 뒤 문서만 바뀜.*\| ✅ \|$/m);

  writeFileSync(join(dir, '.harness/kit-commit'), `${'f'.repeat(40)}\n`);
  assert.match(nine(), /\| ⛔ \|$/);

  writeFileSync(join(dir, '.harness/kit-commit'), `${kit.sha}\n`);
  commit('tools/new-tool.mjs');
  assert.match(nine(), /\| ⛔ \|$/);
});

test('⛔ 키트 작업 트리에 커밋 안 된 변경이 있으면 단일 · --all 모두 표 위에 ⛔ · 판정 줄 없이 exit 1 — 우회 환경변수면 지금처럼', () => {
  const kit = kitRepo();
  const root = tmp('installs-');
  cpSync(installed({ files: { '.harness/kit-commit': `${kit.sha}\n` } }), join(root, 'a'), { recursive: true });
  const env = { ...kit.env, CLAUDE_CONFIG_DIR: pc() };
  const run = (args, e = env) => spawnSync(process.execPath, [join(kit.dir, 'tools', 'install-check.mjs'), ...args], { encoding: 'utf8', env: e });
  const clean = run(['--all', root]);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);

  // ① 이 보지 않는 템플릿만 고친다 — 설치는 그대로 키트 판이고, 거부는 키트 상태 때문이다
  put(kit.dir, 'templates/rules/graph.md', '작업 중\n');
  const all = run(['--all', root]);
  assert.equal(all.status, 1, all.stdout + all.stderr);
  assert.match(all.stdout, /^⛔ 키트 작업 트리에 커밋 안 된 변경 — 판정은 커밋 뒤에.*templates\/rules\/graph\.md/);
  assert.match(all.stdout, /^\| a \| .*\| ✅ \|$/m);
  assert.doesNotMatch(all.stdout, /설치 1곳 모두 키트 판/);
  const one = run([join(root, 'a')]);
  assert.equal(one.status, 1, one.stdout + one.stderr);
  assert.match(one.stdout, /^⛔ 키트 작업 트리에 커밋 안 된 변경 — 판정은 커밋 뒤에/);
  assert.match(one.stdout, /^\| ⑨ \| .*\| ✅ \|$/m);
  assert.doesNotMatch(one.stdout, /이식 성공|이식 실패/);

  const dev = run(['--all', root], { ...env, HARNESS_KIT_DIRTY_OK: '1' });
  assert.equal(dev.status, 0, dev.stdout + dev.stderr);
  assert.doesNotMatch(dev.stdout, /커밋 안 된/);
});

test('⛔ ① 그래프 도구도 키트 판과 비교한다 — 옛 자기 그래프 설치도 예외가 아니다(13차)', () => {
  const dir = installed();
  writeFileSync(join(dir, '.harness/harness.json'), JSON.stringify({ profile: 'existing', mode: 'local', graph: { tools: 'tools', rules: '`AGENTS.md`' }, state: STATE, checks: [CHECK] }));
  writeFileSync(join(dir, '.harness/tools/graph-hook.mjs'), '// 옛 판');
  const r = check(dir)['①'];
  assert.equal(r.ok, false);
  assert.match(r.observed, /graph-hook\.mjs/);
});

test('⛔ ⑤ 옛 자기 그래프는 이관 미완 · graph.store 가 없으면 · 키트 밖 그래프 도구를 가리키는 참조가 있으면(파일:행)', () => {
  const legacy = installed();
  writeFileSync(join(legacy, '.harness/harness.json'), JSON.stringify({ profile: 'existing', mode: 'local', graph: { tools: 'tools', rules: '`AGENTS.md`' }, state: STATE, checks: [CHECK] }));
  assert.match(check(legacy)['⑤'].observed, /이관 미완.*--migrate-graph/);
  const store = (s) => { const d = installed(); writeFileSync(join(d, '.harness/harness.json'), JSON.stringify({ profile: 'existing', mode: 'local', graph: { store: s }, state: STATE, checks: [CHECK] })); return d; };
  const missing = check(store('data/graph.jsonl'))['⑤'];
  assert.equal(missing.ok, false);
  assert.match(missing.observed, /graph\.store 없음 \(data\/graph\.jsonl\)/);
  const present = store('data/graph.jsonl');
  put(present, 'data/graph.jsonl', '');
  assert.equal(check(present)['⑤'].ok, true);
  const refs = check(installed({ files: { 'AGENTS.md': '# 지도\n- `node tools/graph-find.mjs <어근>`\n', 'CLAUDE.local.md': '@AGENTS.md\n' } }))['⑤'];
  assert.equal(refs.ok, false);
  assert.match(refs.observed, /AGENTS\.md:2/);
});

test('⛔ ④ 그래프 훅이 .harness/tools/graph-hook.mjs 가 아니면(옛 자기 그래프 훅) — policy-apply 가 바꿔 끼울 곳으로 잡힌다', () => {
  const settings = applyPolicy({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/tools/graph-hook.mjs"' }] }] } }, { local: true }).settings;
  const r = check(installed({ files: { '.claude/settings.local.json': JSON.stringify(settings) } }))['④'];
  assert.equal(r.ok, false);
  assert.match(r.observed, /hooks\.UserPromptSubmit/);
});

test('⭐ --all <폴더> — 그 아래 설치마다 ⑨ 판 · ① 동일만 표로, 뒤처지거나 다르면 exit 1', () => {
  const root = tmp('installs-');
  cpSync(installed(), join(root, 'a'), { recursive: true });
  cpSync(installed({ files: { '.harness/kit-commit': `${'0'.repeat(40)}\n` } }), join(root, 'b'), { recursive: true });
  put(root, 'c/readme.md', '키트를 얹지 않은 폴더');
  const all = () => spawnSync(process.execPath, [TOOL, '--all', root], { encoding: 'utf8' });
  const r = all();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^\| a \| .*\| ✅ \|$/m);
  assert.match(r.stdout, /^\| b \| .*0000000.*\| ⛔ \|$/m);
  assert.doesNotMatch(r.stdout, /^\| c \|/m);
  writeFileSync(join(root, 'b/.harness/kit-commit'), `${HEAD}\n`);
  const ok = all();
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /설치 2곳 모두 키트 판/);
});

test('--all 제외 목록(키트 저장소 .harness/harness.json installs.skip) — 제외 줄로만 보이고 판정에서 뺀다 · 없는 이름은 ⚠️ · 설정 · 키가 없으면 그대로', () => {
  const root = tmp('installs-');
  cpSync(installed(), join(root, 'a'), { recursive: true });
  cpSync(installed({ files: { '.harness/kit-commit': `${'0'.repeat(40)}\n` } }), join(root, 'b'), { recursive: true });
  const conf = (body) => { const d = target(body); return join(d, '.harness', 'harness.json'); };

  const r = checkAll(root, conf({ checks: [], installs: { skip: ['b', 'gone'] } }));
  assert.equal(r.ok, true, r.text);
  assert.match(r.text, /^\| b \| 제외\(\.harness\/harness\.json installs\.skip\) \|/m);
  assert.doesNotMatch(r.text, /0000000/);
  assert.match(r.text, /^⚠️ .*gone/m);
  assert.doesNotMatch(r.text, /^⚠️ .*\bb\b/m);

  for (const none of [join(tmp('noconf-'), 'harness.json'), conf({ checks: [] })]) {
    const old = checkAll(root, none);
    assert.equal(old.ok, false, old.text);
    assert.match(old.text, /^\| b \| .*0000000.*\| ⛔ \|$/m);
    assert.doesNotMatch(old.text, /제외|⚠️/);
  }
});

test('⛔ CLI — 하나라도 ⛔ 면 exit 1 · 표 끝에 판정 줄 · 대상의 사본으로 돌리면 거부', () => {
  const dir = installed({ files: { '.harness/kit-commit': '' } });
  const r = spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: pc() } });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /^\| ⑨ \|.*\| ⛔ \|$/m);
  assert.match(r.stdout, /^⛔ 이식 실패 — /m);
  assert.match(r.stdout, /^## 프로젝트 맞춤 — 판정 아님/m);
  const copy = spawnSync(process.execPath, [join(dir, '.harness', 'tools', 'install-check.mjs'), dir], { encoding: 'utf8' });
  assert.equal(copy.status, 1);
  assert.match(copy.stderr, /키트 저장소의/);
});

test('⛔ ⑤ 검사마다 처방 id 또는 why — 없거나 처방 id 가 목록에 없으면 ⛔ + 검사 id · why 만 · 처방만이면 ✅', () => {
  const plain = { id: 'g', cmd: 'node -e "0"', kind: 'exit-code' };
  const five = (...checks) => check(installed({ checks: [CHECK, ...checks] }))['⑤'];
  const none = five(plain, { ...plain, id: 'h', why: '  ' });
  assert.equal(none.ok, false);
  assert.match(none.observed, /처방 · why 없는 검사 g, h/);
  assert.match(none.observed, /"recipe": "<처방 id>".*"why"/);
  const unknown = five({ ...plain, recipe: 'no-such' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.observed, /목록에 없는 처방 g\(no-such\)/);
  assert.equal(five({ ...plain, recipe: 'graph-check' }).ok, true);
  assert.equal(five({ ...plain, why: '이 프로젝트는 컨테이너 안에서만 빌드된다' }).ok, true);
});

test('⭐ 표 아래 「프로젝트 맞춤」 절 — 판정 아님 · 검사마다 id · kind · 명령 앞부분 · covers 개수 · 처방 또는 why · graph.names · graph.store · 프로젝트 규칙 · 기록 건수 · 장부 줄 수', () => {
  const rec = (req) => JSON.stringify({ date: '2026-10-01', recorded: '2026-10-01', req, files: [] });
  const dir = installed({
    checks: [{ id: 'graph-check', cmd: 'node .harness/tools/graph-find.mjs --check', kind: 'exit-code', recipe: 'graph-check' }, CHECK],
    files: { '.harness/graph/requests.jsonl': `${rec('주문 취소')}\n${rec('주문 조회')}\n`, '.claude/rules/project-harness.md': '# 이 프로젝트의 규칙\n' },
  });
  const raw = JSON.parse(readFileSync(join(dir, '.harness/harness.json'), 'utf8'));
  writeFileSync(join(dir, '.harness/harness.json'), JSON.stringify({ ...raw, graph: { names: ['shop'] } }));
  assert.deepEqual(bad(check(dir)), []);
  const text = custom(dir);
  assert.match(text, /^## 프로젝트 맞춤 — 판정 아님/m);
  assert.match(text, /^\| graph-check \| exit-code \| node \.harness\/tools\/graph-find\.mjs --check \| 0 \| 처방 graph-check \|$/m);
  assert.match(text, /^\| t \| exit-code \| node -e "0" \| 1 \| why: 시험용 명령 — 처방 밖 \|$/m);
  assert.match(text, /graph\.names shop · graph\.store \.harness\/graph\/requests\.jsonl · 기록 2건/);
  assert.match(text, /프로젝트 규칙 \.claude\/rules\/project-harness\.md/);
  assert.match(text, /장부 \.harness\/state\/decisions\.md \d+줄 · \.harness\/state\/lessons\.md \d+줄/);
  assert.doesNotMatch(text, /^테스트 없음 — /m);
  assert.doesNotMatch(text, /^⚠️ 기록 규칙/m);
});

test('⭐ 기록 규칙을 다른 자리로 돌린 설치(graph.rules)는 맞춤 절에 그 값이 뜬다 — ② 가 graph.md 를 안 봐 두 벌이 갈라져도 판정에 안 뜨기 때문(20차)', () => {
  const dir = installed({ checks: [CHECK] });
  const raw = JSON.parse(readFileSync(join(dir, '.harness/harness.json'), 'utf8'));
  writeFileSync(join(dir, '.harness/harness.json'), JSON.stringify({ ...raw, graph: { rules: 'AGENTS.md 기록 절' } }));
  assert.match(custom(dir), /^⚠️ 기록 규칙 graph\.rules AGENTS\.md 기록 절 — 키트 graph\.md 를 얹지 않아 ② 가 비교하지 않는다/m);
});

test('⭐ graph.rules 를 기본값으로 되돌린 설치 — 갱신 전 ② ③ 은 --own-rules 가 아니라 갱신을 가리키고, 갱신 뒤 ①~⑨ ✅ · ② 가 graph.md 를 다시 비교 · 맞춤 절의 ⚠️ 가 사라진다(22차)', () => {
  const OLD = '`AGENTS.md` 「기록 절」 · `own-skill` 스킬';
  const dir = installed({ files: { 'AGENTS.md': '# 지도\n\n## 기록 절\n- 이 프로젝트의 기록 규칙\n', 'CLAUDE.local.md': '@AGENTS.md\n' } });
  const conf = JSON.parse(readFileSync(join(dir, '.harness/harness.json'), 'utf8'));
  // 1 기록 규칙을 돌린 설치 — graph.md 없이 자리 채움만 그 값
  for (const rel of ['.claude/rules/harness.md', '.claude/skills/final-gate/SKILL.md']) put(dir, rel, readFileSync(join(dir, rel), 'utf8').replaceAll('`.claude/rules/graph.md`', OLD));
  rmSync(join(dir, '.claude/rules/graph.md'));
  put(dir, '.harness/harness.json', JSON.stringify({ ...conf, graph: { rules: OLD } }));
  const turned = check(dir);
  assert.deepEqual(bad(turned), [], JSON.stringify(turned, null, 1));
  assert.doesNotMatch(turned['②'].what, /graph\.md/);
  assert.match(custom(dir), /^⚠️ 기록 규칙 graph\.rules /m);

  // 2 값만 지운다
  put(dir, '.harness/harness.json', JSON.stringify(conf));
  const back = check(dir);
  assert.deepEqual(bad(back), ['②', '③']);
  // 규칙 두 파일은 덜어낸 판이라 자리 채움이 final-gate 에만 남는다
  assert.match(back['②'].observed, /graph\.md 없음/);
  assert.match(back['③'].observed, /SKILL\.md 옛 graph\.rules 자리 채움.*upgrade 로 갱신한다/);
  assert.doesNotMatch(back['②'].observed + back['③'].observed, /--own-rules|프로젝트가 고쳤다/);

  // 3 갱신 → 4 이식 검사
  const up = upgrade(dir);
  assert.equal(up.stop, false, up.text);
  put(dir, '.harness/kit-commit', `${HEAD}\n`);
  const done = check(dir);
  assert.deepEqual(bad(done), [], JSON.stringify(done, null, 1));
  assert.match(done['②'].what, /harness\.md · graph\.md/);
  assert.match(done['②'].observed, /graph\.md 같음/);
  assert.doesNotMatch(custom(dir), /^⚠️ 기록 규칙/m);
});

test('⭐ 관문 훅 걷기(22차) — 옛 설치(관문 도구 · 정책 파일 · Stop 훅 등록 · 옛 규칙)를 갱신하고 policy-apply 를 돌리면 도구 · 정책 파일 · 훅 등록이 사라지고 규칙이 새 판이다 · ①~⑨ ✅ — 로컬 · 공유 · 키트 정책을 받지 않은 설치(옛 --only gate-hook)', () => {
  const was = (rel) => fill(execFileSync('git', ['-C', KIT, 'show', `HEAD:${rel}`], { encoding: 'utf8' }));
  const gate = { type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.harness/tools/gate-hook.mjs'], timeout: 10 };
  const apply = (dir, ...flags) => assert.equal(spawnSync(process.execPath, [join(dir, '.harness/tools/policy-apply.mjs'), dir, ...flags], { encoding: 'utf8' }).status, 0);
  for (const [name, mode, base] of [['로컬', 'local', applyPolicy({}, { local: true }).settings], ['공유', 'share', applyPolicy({}, { local: false }).settings], ['키트 정책 없음', 'local', { env: { PONYTAIL_DEFAULT_MODE: 'lite' } }]]) {
    const file = mode === 'share' ? '.claude/settings.json' : '.claude/settings.local.json';
    const dir = installed({ mode, files: {
      '.harness/tools/gate-hook.mjs': '// 옛 관문 훅', '.harness/policy/gate-hook.json': '{}',
      '.claude/rules/harness.md': was('templates/rules/harness.md'), '.claude/rules/graph.md': was('templates/rules/graph.md'),
      [file]: JSON.stringify({ ...base, hooks: { ...base.hooks, Stop: [{ hooks: [gate] }] } }),
    } });
    if (mode === 'share') { execFileSync('git', ['init', '-q'], { cwd: dir }); applyMode('share', dir); }
    const before = check(dir);
    assert.ok(['①', '②', '④'].every((n) => !before[n].ok), `${name}: ${bad(before)}`);
    assert.match(before['①'].observed, /지운 것 남음.*gate-hook\.mjs/);

    const up = upgrade(dir);
    assert.equal(up.stop, false, up.text);
    assert.match(up.text, /policy-apply\.mjs(?: --local)?(?: --clean)?$/m);
    apply(dir, ...(mode === 'share' ? [] : ['--local']), ...(name === '키트 정책 없음' ? ['--clean'] : []));
    put(dir, '.harness/kit-commit', `${HEAD}\n`);
    for (const f of ['.harness/tools/gate-hook.mjs', '.harness/policy/gate-hook.json']) assert.equal(existsSync(join(dir, f)), false, `${name} ${f}`);
    assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), /gate-hook/, name);
    assert.equal(fill(readFileSync(join(dir, '.claude/rules/harness.md'), 'utf8')).replace(/\r\n/g, '\n'), fill(repoFile('templates/rules/harness.md')).replace(/\r\n/g, '\n'));
    const done = check(dir);
    assert.deepEqual(bad(done), [], `${name} ${JSON.stringify(done, null, 1)}`);
    // 받지 않던 정책(권한)을 새로 받지 않았다
    if (name === '키트 정책 없음') {
      assert.equal(JSON.parse(readFileSync(join(dir, file), 'utf8')).permissions, undefined);
      assert.match(done['④'].observed, /키트 정책 없음/);
    }
  }
});

test('⭐ 「테스트 없음」 선언(검사의 "tests": "none" + why) — 단서가 있어도 ⑤ ✅ · 맞춤 절에 늘 「테스트 없음 — 코드 변경마다 /code-review」 · 선언 없으면 지금처럼 ⛔ · why 없는 선언은 ⛔ · 테스트 소스가 생기면 ⚠️', () => {
  const pom = { 'pom.xml': '<project/>' };
  const compile = { id: 'compile', cmd: 'node -e "0"', kind: 'exit-code', recipe: 'java-javac-compile' };
  const bare = check(installed({ checks: [compile], files: pom }))['⑤'];
  assert.equal(bare.ok, false);
  assert.match(bare.observed, /covers/);
  const noWhy = check(installed({ checks: [{ ...compile, tests: 'none' }], files: pom }))['⑤'];
  assert.equal(noWhy.ok, false);
  assert.match(noWhy.observed, /「테스트 없음」 선언에 why 없음 compile/);

  const dir = installed({ checks: [{ ...compile, tests: 'none', why: '테스트 소스 없음 — 첫 테스트 때 junit 검사와 covers 를 더한다' }], files: pom });
  assert.deepEqual(bad(check(dir)), []);
  assert.match(custom(dir), /^테스트 없음 — 코드 변경마다 \/code-review \(compile: 테스트 소스 없음/m);
  assert.doesNotMatch(custom(dir), /테스트가 생겼다/);
  put(dir, 'src/test/java/AppTest.java', 'class AppTest {}\n');
  assert.equal(check(dir)['⑤'].ok, true);
  assert.match(custom(dir), /^⚠️ 테스트가 생겼다 — junit 검사와 covers 를 더할 때 \(src\/test\)/m);
});

test('⛔ 상수 밖 자리에 프로젝트 차이를 만들면 이식 검사가 잡는다 — 설치본의 모든 파일이 lib/parts.mjs 세 갈래 중 하나이고, 키트 소유는 비교 자리마다 한 줄만 달라도 ⛔', () => {
  const dir = installed();
  const raw = JSON.parse(readFileSync(join(dir, '.harness/harness.json'), 'utf8'));
  const files = readdirSync(dir, { recursive: true }).map((f) => f.split('\\').join('/')).filter((f) => statSync(join(dir, f)).isFile());
  assert.deepEqual(files.filter((f) => !partOf(f, raw)), [], '갈래가 없는 설치 파일');
  // 공유 모드만 얹는 민감 정보 패턴(SETUP ③ 에서 프로젝트에 맞춘다)
  const share = installed({ mode: 'share', files: { '.harness/scan.json': repoFile('templates/scan.json') } });
  const shared = readdirSync(share, { recursive: true }).map((f) => f.split('\\').join('/')).filter((f) => statSync(join(share, f)).isFile());
  assert.deepEqual(shared.filter((f) => !partOf(f, raw)), [], '갈래가 없는 공유 설치 파일');
  assert.equal(partOf('.harness/scan.json', raw), 'config');
  const kit = files.filter((f) => partOf(f, raw) === 'kit');
  assert.ok(kit.includes('.harness/policy/recipes.json') && kit.includes('.harness/kit-commit') && kit.includes('.claude/skills/final-gate/SKILL.md'), kit.join(' '));
  // .harness 의 lib · tools · policy 는 같은 목록(kitFiles)을 한 번에 비교한다 — 폴더마다 하나 · 새로 든 처방 목록 · 나머지는 하나씩
  const one = [...new Set([...new Map(kit.map((f) => [/^\.harness\/(lib|tools|policy)\//.test(f) ? f.split('/')[1] : f, f])).values(), '.harness/policy/recipes.json'])];
  for (const f of one) {
    const before = readFileSync(join(dir, f));
    writeFileSync(join(dir, f), Buffer.concat([before, Buffer.from('\n프로젝트 차이\n')]));
    assert.notDeepEqual(bad(check(dir)), [], f);
    writeFileSync(join(dir, f), before);
  }
  assert.deepEqual(bad(check(dir)), []);
});

test('⭐ 에이전트 정의 — 없으면 ③ ⛔ · 다르면 ③ ⛔ · 키트 판이면 ✅ (이식 검사가 설치 정의를 키트 판과 비교한다)', () => {
  const same = installed();
  assert.equal(check(same)['③'].ok, true, check(same)['③'].observed);
  assert.match(check(same)['③'].observed, /kit-implementer\.md 같음/);
  const none = installed();
  rmSync(join(none, '.claude/agents/kit-verifier.md'));
  assert.equal(check(none)['③'].ok, false);
  assert.match(check(none)['③'].observed, /kit-verifier\.md 없음/);
  const edited = installed();
  put(edited, '.claude/agents/kit-implementer.md', `${repoFile('templates/agents/kit-implementer.md')}\n- 고침\n`);
  assert.equal(check(edited)['③'].ok, false);
  assert.match(check(edited)['③'].observed, /kit-implementer\.md 프로젝트가 고쳤다/);
  // 에이전트 정의는 --own-rules 대상이 아니다 — 처방은 upgrade 가 그 경우에 내는 안내와 같은 뜻
  assert.doesNotMatch(check(edited)['③'].observed, /--own-rules/);
  assert.match(check(edited)['③'].observed, /다른 이름의 에이전트 파일로 옮기고 이 파일을 지운 뒤 upgrade 를 다시/);
  // 규칙 문서의 처방은 그대로
  const rule = installed();
  put(rule, '.claude/rules/harness.md', `${fill(repoFile('templates/rules/harness.md'))}
- 고침
`);
  assert.match(check(rule)['②'].observed, /upgrade --own-rules/);
});

test('⭐ ④ 반대편 설정 파일 — 로컬 설치의 settings.json · 공유 설치의 settings.local.json 에 지운 도구의 훅 · allow 가 남으면 ⛔ · 걷으면 ✅', () => {
  const gate = { Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.harness/tools/gate-hook.mjs'] }] }] };
  for (const [mode, side] of [['local', '.claude/settings.json'], ['share', '.claude/settings.local.json']]) {
    const dir = installed({ mode, files: { [side]: JSON.stringify({ hooks: gate, permissions: { allow: ['Bash(node .harness/tools/state-check.mjs)'] } }) } });
    const r = check(dir)['④'];
    assert.equal(r.ok, false, mode);
    assert.ok(r.observed.includes(`반대편 ${side} 에 걷을 것 남음: hooks.Stop: gate-hook.mjs, permissions.allow: Bash(node .harness/tools/state-check.mjs)`), r.observed);
    assert.match(r.observed, /upgrade 가 낸 policy-apply 줄을 돌린다/);
    put(dir, side, JSON.stringify({}));
    assert.equal(check(dir)['④'].ok, true, mode);
  }
});

test('에이전트 정의는 키트 소유 파일이다 — partOf 가 kit', () => {
  assert.equal(partOf('.claude/agents/kit-verifier.md', {}), 'kit');
});

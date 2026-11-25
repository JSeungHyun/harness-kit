import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, existsSync, cpSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRepo, tmp } from './scene.mjs';

const MODE = fileURLToPath(new URL('../tools/install-mode.mjs', import.meta.url));
const GLOBAL = '.claude/\nAGENTS.md\nCLAUDE.md\n**/.claude/settings.local.json\n';
const run = ({ dir, env }, mode) => spawnSync(process.execPath, [MODE, mode, dir], { env, encoding: 'utf8' });
const ignored = ({ dir, env }, p) => spawnSync('git', ['check-ignore', '-q', p], { cwd: dir, env }).status === 0;
const read = (dir, rel) => (existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), 'utf8') : '');

test('⭐ 공유 — 모의 전역 무시를 저장소 .gitignore 의 부정 규칙이 이긴다', () => {
  const repo = gitRepo({ '.gitignore': 'node_modules/\n' }, { globalIgnore: GLOBAL });
  assert.equal(ignored(repo, '.claude/rules/harness.md'), true);
  const r = run(repo, 'share');
  assert.equal(r.status, 0, r.stdout);
  for (const p of ['.claude/rules/harness.md', '.claude/settings.json', '.harness/harness.json', 'AGENTS.md', 'CLAUDE.md']) assert.equal(ignored(repo, p), false, p);
  assert.equal(ignored(repo, '.claude/settings.local.json'), true);
  const gi = read(repo.dir, '.gitignore');
  assert.match(gi, /^node_modules\/$/m);
  assert.match(gi, /^!\.claude\/$/m);
  assert.doesNotMatch(gi, /!\.harness\//);
});

test('공유 — 전역 무시가 없으면 부정 규칙 없이 settings.local.json 만 무시한다', () => {
  const repo = gitRepo({ 'a.txt': 'x' });
  assert.equal(run(repo, 'share').status, 0);
  const gi = read(repo.dir, '.gitignore');
  assert.doesNotMatch(gi, /^!/m);
  assert.equal(ignored(repo, '.claude/settings.local.json'), true);
});

test('⭐ 로컬 — 설치 경로를 .git/info/exclude 로 숨기고 .gitignore 는 건드리지 않는다', () => {
  const repo = gitRepo({ 'a.txt': 'x' });
  const r = run(repo, 'local');
  assert.equal(r.status, 0, r.stdout);
  for (const p of ['.harness/harness.json', '.claude/rules/harness.md', '.claude/rules/graph.md', '.claude/settings.local.json', 'CLAUDE.local.md']) {
    assert.equal(ignored(repo, p), true, p);
  }
  assert.equal(existsSync(join(repo.dir, '.gitignore')), false);
  assert.equal(existsSync(join(repo.dir, '.gitattributes')), false);
});

test('⭐ 멱등 — 두 번 돌려도 블록은 한 번이다', () => {
  for (const [mode, file] of [['share', '.gitignore'], ['local', '.git/info/exclude']]) {
    const repo = gitRepo({ 'a.txt': 'x' }, { globalIgnore: GLOBAL });
    run(repo, mode);
    const once = read(repo.dir, file);
    assert.equal(run(repo, mode).status, 0);
    assert.equal(read(repo.dir, file), once, mode);
    assert.equal(once.match(/harness-kit:begin/g).length, 1);
  }
});

test('⛔ 모드대로 안 되면 exit 1 — 저장소가 .claude/ 를 되살리면 로컬이 숨기지 못한다', () => {
  const repo = gitRepo({ '.gitignore': '!.claude/\n!.claude/**\n' });
  const r = run(repo, 'local');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /⛔.*\.claude\/rules\/harness\.md/);
});

test('⛔ 모드 이름이 틀리면 거부한다', () => {
  const r = run(gitRepo(), 'team');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /share \| local/);
});

test('⭐ 공유 — pre-commit 이 scan-shared 를 부르고, 민감 정보가 든 기록의 커밋을 막는다', () => {
  const repo = gitRepo({ 'a.txt': 'x' });
  for (const d of ['lib', 'tools']) cpSync(fileURLToPath(new URL(`../${d}`, import.meta.url)), join(repo.dir, '.harness', d), { recursive: true });
  cpSync(fileURLToPath(new URL('../templates/scan.json', import.meta.url)), join(repo.dir, '.harness', 'scan.json'));
  const r = run(repo, 'share');
  assert.equal(r.status, 0, r.stdout);
  assert.match(read(repo.dir, '.git/hooks/pre-commit'), /node \.harness\/tools\/scan-shared\.mjs/);
  assert.match(r.stdout, /✅ pre-commit 이 scan-shared 를 부른다/);
  mkdirSync(join(repo.dir, '.harness', 'graph'), { recursive: true });
  writeFileSync(join(repo.dir, '.harness', 'graph', 'requests.jsonl'), '{"req":"권한","note":"담당 AB123456"}\n');
  repo.git('add', '-A');
  const blocked = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', '기록'], { cwd: repo.dir, env: repo.env, encoding: 'utf8' });
  assert.notEqual(blocked.status, 0);
  assert.match(`${blocked.stdout}${blocked.stderr}`, /\[사번 형식\] AB\*+/);
});

test('공유 — 이미 있는 pre-commit 은 덮지 않고 넣을 한 줄을 안내한다', () => {
  const repo = gitRepo({ 'a.txt': 'x' });
  mkdirSync(join(repo.dir, '.git', 'hooks'), { recursive: true });
  writeFileSync(join(repo.dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nnpm run lint\n');
  const r = run(repo, 'share');
  assert.equal(r.status, 0);
  assert.equal(read(repo.dir, '.git/hooks/pre-commit'), '#!/bin/sh\nnpm run lint\n');
  assert.match(r.stdout, /⚠️ .*pre-commit.*node \.harness\/tools\/scan-shared\.mjs \|\| exit 1/);
});

test('로컬 — pre-commit 을 만들지 않는다', () => {
  const repo = gitRepo({ 'a.txt': 'x' });
  run(repo, 'local');
  assert.equal(existsSync(join(repo.dir, '.git', 'hooks', 'pre-commit')), false);
});

test('⛔ 공유 — core.hooksPath 가 저장소 git 디렉터리 밖이면 pre-commit 을 쓰지 않고 한 줄을 안내한다', () => {
  // 전역 훅 폴더에 쓰면 .harness/ 가 없는 다른 모든 레포의 커밋이 실패한다 — 격리된 저장소 설정으로만 건다
  for (const hooks of [tmp('hooks-'), '.husky']) {
    const repo = gitRepo({ 'a.txt': 'x' });
    repo.git('config', 'core.hooksPath', hooks.replace(/\\/g, '/'));
    const r = run(repo, 'share');
    assert.equal(r.status, 0, r.stdout);
    assert.equal(existsSync(join(hooks.startsWith('.') ? repo.dir : '', hooks, 'pre-commit')), false, hooks);
    assert.equal(existsSync(join(repo.dir, '.git', 'hooks', 'pre-commit')), false, 'git 이 안 쓰는 기본 자리에도 쓰지 않는다');
    assert.match(r.stdout, /⚠️ .*core\.hooksPath.*node \.harness\/tools\/scan-shared\.mjs \|\| exit 1/);
  }
});

// 18차 — 공유 모드는 기록 파일 하나에 여럿이 이어 쓴다. 표식이 없으면 따로 쓴 두 줄이 병합 충돌하고, 충돌 표식이 든 기록은 --check 빨강이다
const FIND = fileURLToPath(new URL('../tools/graph-find.mjs', import.meta.url));
const STORE = '.harness/graph/requests.jsonl';
const line = (req) => `${JSON.stringify({ date: '2026-09-01', recorded: '2026-09-01', req, terms: {}, files: ['a.txt'] })}\n`;
const commit = ({ dir, env }, msg) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', msg, '--no-verify'], { cwd: dir, env });

test('⭐ 공유 — 기록 파일을 .gitattributes 표식 블록에 merge=union 으로 · 두 클론이 따로 이어 쓴 기록이 충돌 없이 합쳐지고 --check exit 0', () => {
  const repo = gitRepo({ 'a.txt': 'x', [STORE]: line('기본 기록') });
  const r = run(repo, 'share');
  assert.equal(r.status, 0, r.stdout);
  assert.equal(read(repo.dir, '.gitattributes'), `# harness-kit:begin (install-mode share)\n${STORE} merge=union\n# harness-kit:end\n`);
  assert.match(r.stdout, /✅ merge=union 이어야 한다 — \.harness\/graph\/requests\.jsonl/);
  assert.equal(run(repo, 'share').status, 0);
  assert.equal(read(repo.dir, '.gitattributes').match(/harness-kit:begin/g).length, 1, '두 번 돌려도 블록은 한 번');
  repo.git('add', '-A');
  commit(repo, '설치');
  const other = { dir: tmp('clone-'), env: repo.env };
  execFileSync('git', ['clone', '-q', repo.dir, other.dir], { env: repo.env });
  appendFileSync(join(repo.dir, STORE), line('이쪽이 쓴 기록'));
  commit(repo, '이쪽');
  appendFileSync(join(other.dir, STORE), line('저쪽이 쓴 기록'));
  commit(other, '저쪽');
  const pull = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'pull', '-q', '--no-rebase', '--no-edit'], { cwd: other.dir, env: repo.env, encoding: 'utf8' });
  assert.equal(pull.status, 0, `${pull.stdout}${pull.stderr}`);
  const merged = read(other.dir, STORE);
  for (const req of ['기본 기록', '이쪽이 쓴 기록', '저쪽이 쓴 기록']) assert.ok(merged.includes(req), req);
  const c = spawnSync(process.execPath, [FIND, '--check'], { cwd: other.dir, env: { ...repo.env, HARNESS_GRAPH_STORE: join(other.dir, STORE) }, encoding: 'utf8' });
  assert.equal(c.status, 0, c.stdout);
});

test('공유 — merge=union 줄은 harness.json 의 graph.store 를 따르고, 기록 위치가 바뀌면 다시 돌릴 때 그 줄을 더한다', () => {
  const repo = gitRepo({ '.gitattributes': '*.png binary\n', '.harness/harness.json': JSON.stringify({ graph: { store: 'docs/graph/requests.jsonl' } }) });
  assert.equal(run(repo, 'share').status, 0);
  assert.match(read(repo.dir, '.gitattributes'), /^\*\.png binary\n# harness-kit:begin \(install-mode share\)\ndocs\/graph\/requests\.jsonl merge=union\n/);
  writeFileSync(join(repo.dir, '.harness', 'harness.json'), JSON.stringify({ graph: { store: 'wiki/requests.jsonl' } }));
  assert.equal(run(repo, 'share').status, 0);
  assert.match(read(repo.dir, '.gitattributes'), /^wiki\/requests\.jsonl merge=union$/m);
});

// 27차 — 다른 도구가 저장소 루트에 쌓는 폴더(superpowers sdd-workspace · Playwright MCP)도 로컬 설치는 숨기고 공유 설치는 건드리지 않는다
const TOOL_DIRS = ['.superpowers/', '.playwright-mcp/'];
const UPGRADE = fileURLToPath(new URL('../tools/upgrade.mjs', import.meta.url));
const upgrade = ({ dir, env }) => spawnSync(process.execPath, [UPGRADE, dir], { encoding: 'utf8', env: { ...env, HARNESS_KIT_DIRTY_OK: '1', CLAUDE_CONFIG_DIR: tmp('nohome-') } });
const conf = (mode) => JSON.stringify({ profile: 'existing', mode, checks: [{ id: 'g', cmd: 'node -e "0"', kind: 'exit-code', recipe: 'graph-check' }] });

test('⭐ 로컬 설치 — 도구 폴더(.superpowers/ · .playwright-mcp/)를 .git/info/exclude 에 숨긴다 · 공유는 .gitignore 에도 안 넣는다', () => {
  const local = gitRepo({ 'a.txt': 'x' });
  assert.equal(run(local, 'local').status, 0);
  for (const d of TOOL_DIRS) assert.equal(ignored(local, `${d}x/y.json`), true, d);
  const share = gitRepo({ 'a.txt': 'x' });
  assert.equal(run(share, 'share').status, 0);
  for (const d of TOOL_DIRS) assert.equal(ignored(share, `${d}x/y.json`), false, d);
  assert.doesNotMatch(read(share.dir, '.gitignore'), /superpowers|playwright/);
});

test('⭐ 갱신 — 옛 로컬 설치(표식 블록이 이미 있음)에도 도구 폴더를 숨긴다 · 두 번 돌려도 한 번 · 공유 설치는 건드리지 않는다', () => {
  const old = gitRepo({ 'a.txt': 'x', '.harness/harness.json': conf('local') });
  const exclude = join(old.dir, '.git', 'info', 'exclude');
  writeFileSync(exclude, '# harness-kit:begin (install-mode local)\n/.harness/\n# harness-kit:end\n');
  const r = upgrade(old);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const d of TOOL_DIRS) assert.equal(ignored(old, `${d}x/y.json`), true, d);
  assert.match(r.stdout, /\.superpowers\/.*\.playwright-mcp\//);
  const once = readFileSync(exclude, 'utf8');
  assert.equal(upgrade(old).status, 0);
  assert.equal(readFileSync(exclude, 'utf8'), once);
  for (const d of TOOL_DIRS) assert.equal(once.split(`/${d}`).length, 2, d);

  const share = gitRepo({ 'a.txt': 'x', '.harness/harness.json': conf('share') });
  assert.equal(upgrade(share).status, 0);
  for (const d of TOOL_DIRS) assert.equal(ignored(share, `${d}x/y.json`), false, d);
  assert.doesNotMatch(read(share.dir, '.git/info/exclude'), /superpowers|playwright/);
});

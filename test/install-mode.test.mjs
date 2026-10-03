import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
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
  for (const p of ['.harness/harness.json', '.claude/rules/harness.md', '.claude/rules/graph.md', '.claude/skills/final-gate/SKILL.md', '.claude/settings.local.json', 'CLAUDE.local.md']) {
    assert.equal(ignored(repo, p), true, p);
  }
  assert.equal(existsSync(join(repo.dir, '.gitignore')), false);
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

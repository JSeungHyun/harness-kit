// 키트 기본 스킬(exec-cycle) — 갱신이 기존 설치에 깔고 · 설치가 고치면 규칙과 같은 방식 · 이식 검사 ②가 동일성을 본다 · 로컬 설치는 git 에서 숨긴다 (26차)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { target, put, repoFile, gitRepo, tmp } from './scene.mjs';
import { checkInstall } from '../tools/install-check.mjs';
import { applyPolicy } from '../tools/policy-apply.mjs';
import { applyMode } from '../tools/install-mode.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
const UPGRADE = join(KIT, 'tools', 'upgrade.mjs');
const SRC = 'templates/skills/exec-cycle/SKILL.md';
const DST = '.claude/skills/exec-cycle/SKILL.md';
const run = (dir, ...args) => spawnSync(process.execPath, [UPGRADE, dir, ...args], { encoding: 'utf8', env: { ...process.env, HARNESS_KIT_DIRTY_OK: '1', CLAUDE_CONFIG_DIR: tmp('nohome-') } });
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8').replace(/\r\n/g, '\n');
const kit = repoFile(SRC).replace(/\r\n/g, '\n');
const conf = { profile: 'existing', mode: 'local', checks: [{ id: 'g', cmd: 'node -e "0"', kind: 'exit-code', recipe: 'graph-check' }] };

test('⭐ 옛 설치 → 갱신 → 스킬이 생긴다(키트 기본 부품) · 다시 돌려도 같다 · 규칙은 얹지 않았으면 그대로 건너뛴다', () => {
  const dir = target(conf, {});
  assert.ok(!existsSync(join(dir, DST)));
  const r = run(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(read(dir, DST), kit);
  assert.match(r.stdout, /✅ \.claude\/skills\/exec-cycle\/SKILL\.md — 새로 깔았다/);
  assert.match(r.stdout, /graph\.md — 없다\(얹지 않은 모듈\)/);
  assert.ok(!existsSync(join(dir, '.claude/rules/graph.md')));
  const again = run(dir);
  assert.match(again.stdout, /exec-cycle\/SKILL\.md — 이미 지금 것/);
});

test('⛔ 설치가 고친 스킬은 덮어쓰지 않고 ⛔(exit 1) — --own-rules 가 고친 줄을 project-exec-cycle.md 로 옮기고 키트 판을 다시 깐다', () => {
  const dir = target(conf, { [DST]: `${kit}\n- 이 프로젝트만의 단계\n` });
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /⛔ \.claude\/skills\/exec-cycle\/SKILL\.md — 프로젝트가 고쳤다 \+1/);
  assert.match(read(dir, DST), /이 프로젝트만의 단계/);
  const own = run(dir, '--own-rules');
  assert.equal(own.status, 0, own.stdout);
  assert.equal(read(dir, DST), kit);
  assert.match(read(dir, '.claude/rules/project-exec-cycle.md'), /이 프로젝트만의 단계/);
});

test('⭐ 이식 검사 ② — 스킬이 없거나 키트 판과 다르면 ⛔ · 같으면 ✅ · 옛 키트 판이면 upgrade 를 가리킨다', () => {
  const dir = target({ ...conf }, {});
  for (const d of ['lib', 'tools', 'policy']) cpSync(join(KIT, d), join(dir, '.harness', d), { recursive: true });
  const fill = (s) => s.replaceAll('<decisions>', '<decisions>').replaceAll('<graph-tools>', '.harness/tools').replaceAll('<graph-rules>', '`.claude/rules/graph.md`');
  for (const [src, dst] of [['templates/rules/harness.md', '.claude/rules/harness.md'], ['templates/rules/graph.md', '.claude/rules/graph.md']]) put(dir, dst, fill(repoFile(src)));
  put(dir, '.claude/settings.local.json', JSON.stringify(applyPolicy({}, { local: true }).settings));
  const two = (plugins) => checkInstall(dir, { plugins }).find((x) => x.n === '②');
  const none = two([]);
  assert.equal(none.ok, false);
  assert.match(none.observed, /SKILL\.md 없음/);
  put(dir, DST, kit);
  put(dir, '.claude/skills/exec-review/SKILL.md', repoFile('templates/skills/exec-review/SKILL.md'));
  assert.equal(two([]).ok, true, two([]).observed);
  writeFileSync(join(dir, DST), `${kit}\n- 고침\n`);
  const mine = two([]);
  assert.equal(mine.ok, false);
  assert.match(mine.observed, /SKILL\.md 프로젝트가 고쳤다.*--own-rules/);
});

test('⭐ 로컬 설치는 스킬 폴더도 git 에서 숨긴다 — install-mode 가 새 설치에 · 갱신이 옛 설치에(한 번만 쓰는 블록을 모르므로 info/exclude 에 더한다) · 공유는 추적 가능', () => {
  const local = gitRepo({ 'README.md': 'x\n', '.harness/harness.json': JSON.stringify(conf) });
  applyMode('local', local.dir);
  const hidden = (dir, p) => spawnSync('git', ['check-ignore', '-q', p], { cwd: dir }).status === 0;
  put(local.dir, DST, kit);
  assert.ok(hidden(local.dir, DST), 'install-mode local 이 스킬을 숨긴다');

  const old = gitRepo({ 'README.md': 'x\n', '.harness/harness.json': JSON.stringify(conf) });
  const mark = join(old.dir, '.git', 'info', 'exclude');
  writeFileSync(mark, '# harness-kit:begin (install-mode local)\n/.harness/\n# harness-kit:end\n');
  const r = spawnSync(process.execPath, [UPGRADE, old.dir], { encoding: 'utf8', env: { ...old.env, HARNESS_KIT_DIRTY_OK: '1', CLAUDE_CONFIG_DIR: tmp('nohome-') } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(hidden(old.dir, DST), '갱신이 옛 설치의 스킬을 숨긴다');

  const share = gitRepo({ 'README.md': 'x\n', '.harness/harness.json': JSON.stringify({ ...conf, mode: 'share' }) });
  const s = applyMode('share', share.dir);
  assert.ok(s.rows.some((x) => x.p === DST && x.ok), JSON.stringify(s.rows));
});

// 검증 전용 스킬 exec-review — exec-cycle 과 같은 대우(깔림 · 동일성 · 숨김 · 추적)
const RSRC = 'templates/skills/exec-review/SKILL.md';
const RDST = '.claude/skills/exec-review/SKILL.md';

test('⭐ exec-review — 갱신이 옛 설치에 깐다 · 고치면 ⛔ · 로컬 설치는 숨기고 공유는 추적한다', () => {
  const dir = target(conf, {});
  const r = run(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(read(dir, RDST), repoFile(RSRC).replace(/\r\n/g, '\n'));
  assert.match(r.stdout, /✅ \.claude\/skills\/exec-review\/SKILL\.md — 새로 깔았다/);

  const edited = target(conf, { [RDST]: `${repoFile(RSRC).replace(/\r\n/g, '\n')}\n- 고침\n` });
  assert.match(run(edited).stdout, /⛔ \.claude\/skills\/exec-review\/SKILL\.md — 프로젝트가 고쳤다/);

  const local = gitRepo({ 'README.md': 'x\n', '.harness/harness.json': JSON.stringify(conf) });
  applyMode('local', local.dir);
  put(local.dir, RDST, 'x');
  assert.equal(spawnSync('git', ['check-ignore', '-q', RDST], { cwd: local.dir }).status, 0);

  const share = gitRepo({ 'README.md': 'x\n', '.harness/harness.json': JSON.stringify({ ...conf, mode: 'share' }) });
  assert.ok(applyMode('share', share.dir).rows.some((x) => x.p === RDST && x.ok));
});

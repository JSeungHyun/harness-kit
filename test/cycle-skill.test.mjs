// /exec-cycle 이 쓰는 스킬 파일 찾기 — 플러그인 설치 경로(켬/끔 무관)와 사용자 스킬. 가짜 홈으로 도구를 직접 부른다(26차)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmp, put } from './scene.mjs';

const TOOL = fileURLToPath(new URL('../tools/cycle-skill.mjs', import.meta.url));
const slash = (p) => p.replace(/\\/g, '/');

// 가짜 ~/.claude — plugins: { id: [{ scope, installPath 아래 폴더 이름, lastUpdated }] }
function home(plugins = {}, { enabled, skills = {} } = {}) {
  const dir = tmp('cyclehome-');
  const list = {};
  for (const [id, entries] of Object.entries(plugins)) {
    list[id] = entries.map(({ at, files = {}, ...rest }) => {
      const installPath = join(dir, 'plugins', 'cache', at);
      for (const [rel, body] of Object.entries(files)) put(installPath, rel, body);
      return { installPath, ...rest };
    });
  }
  put(dir, 'plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: list }));
  if (enabled) put(dir, 'settings.json', JSON.stringify({ enabledPlugins: enabled }));
  for (const [name, body] of Object.entries(skills)) put(dir, `skills/${name}/SKILL.md`, body);
  return dir;
}
const run = (dir, ...args) => spawnSync(process.execPath, [TOOL, ...args], { env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, encoding: 'utf8' });

test('⭐ 플러그인 스킬 경로를 낸다 — 설치 경로의 skills/<이름>/SKILL.md', () => {
  const dir = home({ 'superpowers@m': [{ scope: 'user', at: 'm/superpowers/7', files: { 'skills/brainstorming/SKILL.md': '설계' } }] });
  const r = run(dir, 'superpowers', 'brainstorming');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), slash(join(dir, 'plugins/cache/m/superpowers/7/skills/brainstorming/SKILL.md')));
});

test('⭐ 플러그인을 꺼 둬도 찾는다 — 켬/끔은 settings 의 일이고 이 도구는 설치 경로만 본다', () => {
  const dir = home({ 'superpowers@m': [{ scope: 'user', at: 'sp', files: { 'skills/writing-plans/SKILL.md': '계획' } }] }, { enabled: { 'superpowers@m': false } });
  assert.equal(run(dir, 'superpowers', 'writing-plans').status, 0);
});

test('판이 여럿이면 installed_plugins 가 가리키는 것 — 사용자 범위 먼저, 없으면 가장 최근에 갱신된 것', () => {
  const skill = { 'skills/s/SKILL.md': 'x' };
  const both = home({ 'p@m': [
    { scope: 'local', projectPath: 'C:/a', at: 'new', files: skill, lastUpdated: '2026-11-01T00:00:00Z' },
    { scope: 'user', at: 'old', files: skill, lastUpdated: '2026-10-01T00:00:00Z' },
  ] });
  assert.match(run(both, 'p', 's').stdout, /cache\/old\/skills\/s\/SKILL\.md/);
  const locals = home({ 'p@m': [
    { scope: 'local', at: 'older', files: skill, lastUpdated: '2026-10-01T00:00:00Z' },
    { scope: 'local', at: 'newer', files: skill, lastUpdated: '2026-11-01T00:00:00Z' },
  ] });
  assert.match(run(locals, 'p', 's').stdout, /cache\/newer\/skills\/s\/SKILL\.md/);
});

test('⭐ 사용자 스킬도 찾는다 — 플러그인에 없으면 ~/.claude/skills/<이름>/SKILL.md (ponytail-review)', () => {
  const dir = home({}, { skills: { 'ponytail-review': '리뷰' } });
  const r = run(dir, 'ponytail', 'ponytail-review');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), slash(join(dir, 'skills/ponytail-review/SKILL.md')));
});

test('⭐ 없으면 exit 1 — 어느 플러그인 · 스킬이 없는지와 할 일을 말한다', () => {
  const dir = home({ 'superpowers@m': [{ scope: 'user', at: 'sp', files: { 'skills/other/SKILL.md': 'x' } }] });
  const none = run(dir, 'superpowers', 'brainstorming');
  assert.equal(none.status, 1);
  assert.match(none.stderr, /superpowers/);
  assert.match(none.stderr, /brainstorming/);
  const off = run(home(), 'ponytail', 'ponytail-review');
  assert.equal(off.status, 1);
  assert.match(off.stderr, /설치/);
  assert.equal(run(dir, 'superpowers').status, 1, '인자가 모자라도 exit 1');
});

test('installed_plugins.json 이 없거나 깨져도 사용자 스킬은 찾고, 없으면 exit 1 로 끝난다', () => {
  const dir = tmp('cyclehome-');
  assert.equal(run(dir, 'superpowers', 'brainstorming').status, 1);
  put(dir, 'plugins/installed_plugins.json', '{깨짐');
  put(dir, 'skills/ponytail-review/SKILL.md', 'x');
  assert.equal(run(dir, 'ponytail', 'ponytail-review').status, 0);
});

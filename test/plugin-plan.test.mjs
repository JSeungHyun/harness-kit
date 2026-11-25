import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, reviewSkillState, ponytailLeft } from '../tools/plugin-plan.mjs';
import { tmp, put, repoFile } from './scene.mjs';

const IDS = ['superpowers@harness-kit'];
const SKILL = 'node C:/kit/tools/plugin-plan.mjs --review-skill';
const p = (id, scope = 'user', enabled = true, version) => ({ id, scope, enabled, version });
const KIT_SKILL = 'templates/user-skills/ponytail-review/SKILL.md';
const at = (dir, f) => { const keep = process.env.CLAUDE_CONFIG_DIR; process.env.CLAUDE_CONFIG_DIR = dir; try { return f(); } finally { if (keep === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = keep; } };

test('⭐ 키트가 고정 버전을 올렸으면 — 마켓을 갱신하고 사용자 범위로 올린다(--scope 없이는 그 폴더의 local 기록만 오른다)', () => {
  const list = [p('superpowers@harness-kit', 'user', true, '6.1.1')];
  assert.deepEqual(plan(list, IDS, 'C:/kit', { 'superpowers@harness-kit': '6.2.0' }), [
    'claude plugin marketplace update harness-kit',
    'claude plugin update superpowers@harness-kit --scope user',
  ]);
});

test('⭐ 다른 마켓으로 쓰던 사용자 범위 플러그인 — 키트 마켓 것을 먼저 깔고 옛 것을 지운다 · 리뷰 스킬이 없으면 맨 앞', () => {
  const list = [p('superpowers@superpowers-marketplace'), p('other@m')];
  assert.deepEqual(plan(list, IDS, 'C:/kit', {}, false), [
    SKILL,
    'claude plugin marketplace add C:/kit',
    'claude plugin install superpowers@harness-kit',
    'claude plugin uninstall superpowers@superpowers-marketplace --scope user',
  ]);
});

test('이미 맞췄으면 할 일이 없다 — 설치는 됐는데 꺼져 있어도 켜라고 하지 않는다(/exec-cycle 이 파일로 읽는다 · 26차)', () => {
  assert.deepEqual(plan([p('superpowers@harness-kit', 'user', false)], IDS, 'C:/kit', {}, true), []);
  assert.deepEqual(plan([], IDS, 'C:/kit', {}, false), [SKILL, 'claude plugin marketplace add C:/kit', 'claude plugin install superpowers@harness-kit']);
});

test('⭐ 마켓에 ponytail 이 없다 — 리뷰 지시문은 키트 파일이고 플러그인은 쓰지 않는다', () => {
  assert.deepEqual(JSON.parse(repoFile('.claude-plugin/marketplace.json')).plugins.map((x) => x.name), ['superpowers']);
});

test('⭐ 리뷰 스킬은 키트 파일과 같을 때만 맞다 — 없음 · 다름(받은 뒤 고침 · 키트가 바뀜)은 다시 깐다 · 줄바꿈 차이는 같다', () => {
  const kit = repoFile(KIT_SKILL);
  const dir = tmp('claudecfg-');
  assert.equal(at(dir, reviewSkillState), 'none');
  put(dir, 'skills/ponytail-review/SKILL.md', kit.replace(/\r?\n/g, '\r\n'));
  assert.equal(at(dir, reviewSkillState), 'ok');
  writeFileSync(join(dir, 'skills/ponytail-review/SKILL.md'), `${kit}고친 줄\n`);
  assert.equal(at(dir, reviewSkillState), 'diff');
});

test('⭐ --review-skill 은 키트 파일을 사용자 스킬로 깐다(LICENSE 같이 · 옛 .pinned.json 은 걷는다) · 다시 돌려도 같다 · 같지 않으면 덮는다', () => {
  const dir = tmp('claudecfg-');
  put(dir, 'skills/ponytail-review/SKILL.md', '옛 판\n');
  put(dir, 'skills/ponytail-review/.pinned.json', '{}');
  const tool = fileURLToPath(new URL('../tools/plugin-plan.mjs', import.meta.url));
  const run = () => spawnSync(process.execPath, [tool, '--review-skill'], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir } });
  for (let i = 0; i < 2; i++) {
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(at(dir, reviewSkillState), 'ok');
  }
  assert.match(readFileSync(join(dir, 'skills/ponytail-review/LICENSE'), 'utf8'), /DietrichGebert/);
  assert.ok(!existsSync(join(dir, 'skills/ponytail-review/.pinned.json')));
});

test('⭐ 옛 PC — ponytail 플러그인이 사용자 범위에 있거나 전역 env 에 PONYTAIL_DEFAULT_MODE 가 있으면 ⚠️ + 걷는 명령(⛔ 아님 · 명령 목록에는 안 들어간다)', () => {
  const dir = tmp('claudecfg-');
  assert.deepEqual(at(dir, () => ponytailLeft([p('superpowers@harness-kit')])), []);
  const w = at(dir, () => ponytailLeft([p('ponytail@harness-kit', 'user', false), p('ponytail@ponytail', 'local')]));
  assert.equal(w.length, 1, '다른 프로젝트의 local 기록은 PC 의 일이 아니다');
  assert.match(w[0], /claude plugin uninstall ponytail@harness-kit --scope user/);
  put(dir, 'settings.json', JSON.stringify({ env: { PONYTAIL_DEFAULT_MODE: 'off', MINE: '1' } }));
  const e = at(dir, () => ponytailLeft([]));
  assert.equal(e.length, 1);
  assert.match(e[0], /PONYTAIL_DEFAULT_MODE/);
  assert.match(e[0], /~\/\.claude\/settings\.json/);
  assert.equal(plan([p('ponytail@harness-kit')], IDS, 'C:/kit', {}, true).some((c) => /ponytail/.test(c)), false);
});

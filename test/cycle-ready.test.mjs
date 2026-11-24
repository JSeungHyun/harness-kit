// /exec-cycle 을 이 PC 에서 바로 쓸 수 있나 — superpowers 설치(켬/끔 무관) · 키트 고정 판 · 사이클이 읽는 스킬 파일 · ponytail-review. 켜져 있으면 ⚠️ (26차)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cycleReady, cycleSkills, pcPlan } from '../tools/plugin-plan.mjs';
import { checkAll, checkInstall } from '../tools/install-check.mjs';
import { tmp, put, repoFile } from './scene.mjs';

const market = JSON.parse(repoFile('.claude-plugin/marketplace.json'));
const PIN = market.plugins.find((p) => p.name === 'superpowers').version;
const SP = 'superpowers@harness-kit';

// 가짜 ~/.claude — superpowers: 설치 기록 판(false 면 없음) · skills: 깔린 superpowers 스킬 · review: 사용자 스킬 ponytail-review · enabled: settings 의 enabledPlugins
function home({ superpowers = PIN, skills = ['brainstorming', 'writing-plans', 'executing-plans'], review = true, enabled = false } = {}) {
  const dir = tmp('cyclehome-');
  const installPath = join(dir, 'plugins/cache/harness-kit/superpowers');
  for (const s of skills) put(installPath, `skills/${s}/SKILL.md`, `${s}\n`);
  put(dir, 'plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: superpowers ? { [SP]: [{ scope: 'user', installPath, version: superpowers }] } : {} }));
  if (review) put(dir, 'skills/ponytail-review/SKILL.md', '리뷰\n');
  if (enabled) put(dir, 'settings.json', JSON.stringify({ enabledPlugins: { [SP]: true } }));
  return dir;
}
const at = (dir, f) => { const keep = process.env.CLAUDE_CONFIG_DIR; process.env.CLAUDE_CONFIG_DIR = dir; try { return f(); } finally { if (keep === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = keep; } };
const ready = (opts, list) => at(home(opts), () => cycleReady(list));

test('사이클이 읽는 스킬은 스킬 본문에서 뽑는다 — superpowers 셋 · ponytail-review', () => {
  assert.deepEqual(cycleSkills(), [['superpowers', 'brainstorming'], ['superpowers', 'writing-plans'], ['superpowers', 'executing-plans'], ['ponytail', 'ponytail-review']]);
});

test('⭐ 꺼 둔 superpowers(설치 · 고정 판 · 스킬 파일 · 리뷰 스킬) → 문제도 경고도 없다 — 바로 쓸 수 있다', () => {
  assert.deepEqual(ready({}), { problems: [], warns: [] });
});

test('⭐ superpowers 가 켜져 있으면 ⚠️ — 자동 주입 · 끄는 명령 한 줄 · 사용자 승인 몫 · ⛔ 는 아니다 (settings 또는 plugin list 로)', () => {
  const on = ready({ enabled: true });
  assert.deepEqual(on.problems, []);
  assert.equal(on.warns.length, 1);
  assert.match(on.warns[0], /자동 주입/);
  assert.match(on.warns[0], /claude plugin disable superpowers@harness-kit --scope user/);
  assert.match(on.warns[0], /사용자 승인/);
  // 켤지 끌지 고르는 기준과 「끄기 ≠ 지우기」 — 지우면 사이클이 스킬 파일을 못 읽는다
  assert.match(on.warns[0], /단독으로도 부르면 켜 둔다/);
  assert.match(on.warns[0], /uninstall 하면 \/exec-cycle · \/exec-review 가 멈춘다/);
  // plugin list 가 있으면 그 켬/끔이 이긴다
  assert.equal(ready({ enabled: true }, [{ id: SP, scope: 'user', enabled: false }]).warns.length, 0);
  assert.equal(ready({}, [{ id: SP, scope: 'user', enabled: true }]).warns.length, 1);
});

test('⛔ superpowers 가 없으면 설치 명령 · 키트 고정 판이 아니면 update 명령 · 다른 마켓 판은 없는 것', () => {
  const none = ready({ superpowers: false });
  assert.match(none.problems[0], /superpowers 가 이 PC 에 없다.*claude plugin install superpowers@harness-kit/);
  const old = ready({ superpowers: '6.1.1' });
  assert.match(old.problems[0], /6\.1\.1.*고정 판.*claude plugin update superpowers@harness-kit --scope user/);
  const other = tmp('cyclehome-');
  put(other, 'plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: { 'superpowers@superpowers-marketplace': [{ scope: 'user', installPath: join(other, 'x'), version: PIN }] } }));
  put(other, 'skills/ponytail-review/SKILL.md', '리뷰\n');
  assert.match(at(other, () => cycleReady()).problems[0], /이 PC 에 없다/);
});

test('⛔ 사이클이 읽는 스킬 파일이 하나라도 없으면 그 이름을 낸다 · ponytail-review 가 없으면 --review-skill 명령', () => {
  const gap = ready({ skills: ['brainstorming', 'executing-plans'] });
  assert.match(gap.problems.join('\n'), /superpowers writing-plans/);
  assert.doesNotMatch(gap.problems.join('\n'), /superpowers brainstorming/);
  const noReview = ready({ review: false });
  assert.match(noReview.problems.join('\n'), /ponytail-review 스킬이 없다.*plugin-plan\.mjs --review-skill/);
});

test('⭐ 켬/끔은 plugin-plan 이 따지지 않는다 — 설치돼 있으면 꺼져 있어도 낼 명령이 없다(켜라고 하지 않는다)', () => {
  const list = [{ id: SP, scope: 'user', enabled: false, version: PIN }];
  const cmds = at(home({}), () => pcPlan(list).cmds);
  assert.ok(!cmds.some((c) => /plugin enable/.test(c)), cmds.join(' ; '));
});

test('⭐ 이식 검사 ⑥ — 사이클 문제는 ⛔ · 켜짐은 ✅ + ⚠️(warn) · 끔은 ✅', () => {
  const dir = tmp('target-');
  put(dir, '.harness/harness.json', JSON.stringify({ profile: 'existing', mode: 'local', checks: [] }));
  const six = (opts, list) => at(home(opts), () => checkInstall(dir, { plugins: list }).find((r) => r.n === '⑥'));
  const off = six({}, [{ id: SP, scope: 'user', enabled: false, version: PIN }]);
  assert.equal(off.warn, undefined);
  const on = six({ enabled: true }, [{ id: SP, scope: 'user', enabled: true, version: PIN }]);
  assert.equal(on.warn === undefined, false);
  assert.match(on.warn, /claude plugin disable superpowers@harness-kit --scope user/);
  const bad = six({ skills: [] }, [{ id: SP, scope: 'user', enabled: false, version: PIN }]);
  assert.equal(bad.ok, false);
  assert.match(bad.observed, /⛔ 사이클이 읽는 superpowers 스킬 파일이 없다/);
});

test('⭐ --all 표에 「사이클」 칸 — ⚠️ 켜짐은 사이클 칸만 · ⛔ 없음은 칸 + 명령 줄 + 판정 줄', () => {
  const root = tmp('installs-');
  put(root, 'a/.harness/harness.json', JSON.stringify({ profile: 'existing', mode: 'local', checks: [] }));
  const ok = at(home({}), () => checkAll(root));
  assert.match(ok.text, /\| 사이클 \|/);
  assert.match(ok.text, /^\| a \| .*\| ✅ 사용 가능 \| ⛔ \|$/m);
  const none = at(home({ superpowers: false }), () => checkAll(root));
  assert.match(none.text, /^\| a \| .*\| ⛔ superpowers 가 이 PC 에 없다.*\| ⛔ \|$/m);
  assert.match(none.text, /^⛔ \/exec-cycle · \/exec-review 를 바로 쓸 수 없다 — superpowers 가 이 PC 에 없다/m);
  const warn = at(home({ enabled: true }), () => checkAll(root));
  assert.match(warn.text, /^\| a \| .*\| ⚠️ 사용 가능 — superpowers 켜짐\(자동 주입\) \| ⛔ \|$/m);
  assert.match(warn.text, /^⚠️ \/exec-cycle · \/exec-review — superpowers 가 켜져 있다/m);
  assert.doesNotMatch(warn.text, /^⛔ \/exec-cycle · \/exec-review/m);
});

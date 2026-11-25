// /exec-cycle 을 이 PC 에서 바로 쓸 수 있나 — superpowers 설치(켬/끔 무관) · 키트 고정 판 · 사이클이 읽는 스킬 파일 · ponytail-review. 켜져 있으면 ⚠️ (26차)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cycleReady, cycleSkills, pcPlan, claudeVersion } from '../tools/plugin-plan.mjs';
import { checkAll, checkInstall } from '../tools/install-check.mjs';
import { tmp, put, repoFile, target } from './scene.mjs';

const market = JSON.parse(repoFile('.claude-plugin/marketplace.json'));
const PIN = market.plugins.find((p) => p.name === 'superpowers').version;
const SP = 'superpowers@harness-kit';
const KIT_SKILL = repoFile('templates/user-skills/ponytail-review/SKILL.md');

// 가짜 ~/.claude — superpowers: 설치 기록 판(false 면 없음) · skills: 깔린 superpowers 스킬 · review: 사용자 스킬 ponytail-review · enabled: settings 의 enabledPlugins
function home({ superpowers = PIN, skills = ['brainstorming', 'writing-plans', 'executing-plans'], review = true, enabled = false, hooks } = {}) {
  const dir = tmp('cyclehome-');
  const installPath = join(dir, 'plugins/cache/harness-kit/superpowers');
  for (const s of skills) put(installPath, `skills/${s}/SKILL.md`, `${s}\n`);
  put(dir, 'plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: superpowers ? { [SP]: [{ scope: 'user', installPath, version: superpowers }] } : {} }));
  if (review) put(dir, 'skills/ponytail-review/SKILL.md', review === true ? KIT_SKILL : review);
  if (hooks) put(installPath, 'hooks/hooks.json', JSON.stringify({ hooks: Object.fromEntries(hooks.map((e) => [e, []])) }));
  if (enabled) put(dir, 'settings.json', JSON.stringify({ enabledPlugins: { [SP]: true } }));
  return dir;
}
const at = (dir, f) => { const keep = process.env.CLAUDE_CONFIG_DIR; process.env.CLAUDE_CONFIG_DIR = dir; try { return f(); } finally { if (keep === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = keep; } };
const ready = (opts, list, version) => at(home(opts), () => cycleReady(list, version));

test('사이클이 읽는 스킬은 스킬 본문에서 뽑는다 — superpowers 셋 · ponytail-review', () => {
  assert.deepEqual(cycleSkills(), [['superpowers', 'brainstorming'], ['superpowers', 'writing-plans'], ['superpowers', 'executing-plans'], ['user', 'ponytail-review']]);
});

test('⭐ 꺼 둔 superpowers(설치 · 고정 판 · 스킬 파일 · 리뷰 스킬) → 문제도 경고도 없다 — 바로 쓸 수 있다', () => {
  assert.deepEqual(ready({}), { problems: [], warns: [], notes: [] });
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
  put(other, 'skills/ponytail-review/SKILL.md', KIT_SKILL);
  assert.match(at(other, () => cycleReady()).problems[0], /이 PC 에 없다/);
});

test('⛔ 사이클이 읽는 스킬 파일이 하나라도 없으면 그 이름을 낸다 · ponytail-review 가 없으면 --review-skill 명령', () => {
  const gap = ready({ skills: ['brainstorming', 'executing-plans'] });
  assert.match(gap.problems.join('\n'), /superpowers writing-plans/);
  assert.doesNotMatch(gap.problems.join('\n'), /superpowers brainstorming/);
  const noReview = ready({ review: false });
  assert.match(noReview.problems.join('\n'), /사용자 스킬 ponytail-review 가 없다.*plugin-plan\.mjs --review-skill/);
  const differs = ready({ review: `${KIT_SKILL}고친 줄\n` });
  assert.match(differs.problems.join('\n'), /키트 판과 다르다.*plugin-plan\.mjs --review-skill/);
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

test('⭐ superpowers 훅 점검 — 키트가 확인한 SessionStart 하나면 조용하고, 판이 훅을 더하면 ⚠️(이벤트 이름 · 끈 상태에서는 안 돈다 · 사이클 영향 검토) · ⛔ 는 아니다', () => {
  assert.deepEqual(ready({ hooks: ['SessionStart'] }).notes, []);
  const more = ready({ hooks: ['SessionStart', 'UserPromptSubmit', 'Stop'] });
  assert.deepEqual(more.problems, []);
  assert.equal(more.notes.length, 1);
  assert.match(more.notes[0], /superpowers 판이 훅을 더했다\(UserPromptSubmit · Stop\)/);
  assert.match(more.notes[0], /끈 상태에서는 돌지 않는다/);
  assert.match(more.notes[0], /\/exec-cycle 영향을 검토/);
});

test('⭐ --all 사이클 칸 — 훅이 늘면 ⚠️ 칸(맞나는 그대로) · 사용자 스킬이 키트 판과 다르면 ⛔ + 그 명령', () => {
  const root = tmp('installs-');
  put(root, 'a/.harness/harness.json', JSON.stringify({ profile: 'existing', mode: 'local', checks: [] }));
  const hook = at(home({ hooks: ['SessionStart', 'Stop'] }), () => checkAll(root));
  assert.match(hook.text, /^\| a \| .*\| ⚠️ 사용 가능 — superpowers 훅 늘어남 \| ⛔ \|$/m);
  assert.match(hook.text, /^⚠️ \/exec-cycle · \/exec-review — superpowers 판이 훅을 더했다/m);
  const diff = at(home({ review: '다른 글\n' }), () => checkAll(root));
  assert.match(diff.text, /^⛔ \/exec-cycle · \/exec-review 를 바로 쓸 수 없다 — 사용자 스킬 ponytail-review 가 키트 판과 다르다/m);
});

// 가짜 claude — plugin list --json 이 이 목록을 · --version 이 이 판을 낸다(실제 PC 의 claude 를 부르지 않는다). version 이 null 이면 --version 은 실패한다
function fakeClaude(list, version = '2.1.332 (Claude Code)') {
  const bin = tmp('fakeclaude-');
  put(bin, 'list.json', JSON.stringify(list));
  put(bin, 'ver.txt', `${version}\n`);
  put(bin, 'claude.cmd', `@if "%~1"=="--version" (${version === null ? 'exit /b 1' : 'type "%~dp0ver.txt"'}) else (type "%~dp0list.json")\r\n`);
  put(bin, 'claude', `#!/bin/sh\ncase "$1" in --version) ${version === null ? 'exit 1' : 'cat "$(dirname "$0")/ver.txt"'};; *) cat "$(dirname "$0")/list.json";; esac\n`);
  try { chmodSync(join(bin, 'claude'), 0o755); } catch { /* Windows */ }
  return bin;
}
const withPath = (bin) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH')), PATH: bin + delimiter + process.env.PATH });
const TOOLS = fileURLToPath(new URL('../tools/', import.meta.url));

test('⭐ plugin-plan CLI 출력 — 옛 PC 의 ponytail 잔재(플러그인 · 전역 env)와 훅 늘어남이 ⚠️ 줄로 나온다 · 잔재가 없으면 안 나온다', () => {
  const list = [{ id: SP, scope: 'user', enabled: false, version: PIN }];
  const run = (dir, extra = []) => spawnSync(process.execPath, [join(TOOLS, 'plugin-plan.mjs')], { encoding: 'utf8', env: { ...withPath(fakeClaude([...list, ...extra])), CLAUDE_CONFIG_DIR: dir } });
  const dir = home({ hooks: ['SessionStart', 'UserPromptSubmit', 'Stop'] });
  put(dir, 'settings.json', JSON.stringify({ env: { PONYTAIL_DEFAULT_MODE: 'off' } }));
  const old = run(dir, [{ id: 'ponytail@harness-kit', scope: 'user', enabled: false, version: '1' }]);
  assert.match(old.stdout, /^⚠️ ponytail 플러그인이 남아 있다\(ponytail@harness-kit\).*claude plugin uninstall ponytail@harness-kit --scope user/m, old.stderr);
  assert.match(old.stdout, /^⚠️ 전역 env 에 PONYTAIL_DEFAULT_MODE 가 남아 있다/m);
  assert.match(old.stdout, /^⚠️ \/exec-cycle · \/exec-review — superpowers 판이 훅을 더했다\(UserPromptSubmit · Stop\)/m);
  const clean = run(home());
  assert.doesNotMatch(clean.stdout, /ponytail 플러그인이 남아|PONYTAIL_DEFAULT_MODE|훅을 더했다/);
  assert.match(clean.stdout, /^✅ \/exec-cycle · \/exec-review 를 바로 쓸 수 있다/m);
});

test('⭐ 갱신 출력 — superpowers 판이 훅을 더했으면 「다음」 곁에 ⚠️ 줄 · 훅이 SessionStart 뿐이면 없다', () => {
  const dir = target({ profile: 'existing', mode: 'local', checks: [] }, {});
  const upgrade = (hooks) => spawnSync(process.execPath, [join(TOOLS, 'upgrade.mjs'), dir], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: home({ hooks }) } });
  const more = upgrade(['SessionStart', 'Stop']);
  assert.match(more.stdout, /^⚠️ \/exec-cycle · \/exec-review — superpowers 판이 훅을 더했다\(Stop\)/m, more.stderr);
  assert.doesNotMatch(upgrade(['SessionStart']).stdout, /훅을 더했다/);
});

test('⭐ 이식 검사 ⑥ 요약 — 훅 늘어남 · 옛 ponytail 잔재만 있어도 「⚠️ 아래 ⚠️ 줄」이 붙고 warn 에 그 글이 실린다 · 아무 경고도 없으면 안 붙는다', () => {
  const dir = tmp('target-');
  put(dir, '.harness/harness.json', JSON.stringify({ profile: 'existing', mode: 'local', checks: [] }));
  const list = [{ id: SP, scope: 'user', enabled: false, version: PIN }];
  const six = (opts, env) => at(home(opts), () => {
    if (env) put(process.env.CLAUDE_CONFIG_DIR, 'settings.json', JSON.stringify({ env }));
    return checkInstall(dir, { plugins: list }).find((r) => r.n === '⑥');
  });
  const quiet = six({});
  assert.doesNotMatch(quiet.observed, /아래 ⚠️ 줄/);
  assert.equal(quiet.warn, undefined);
  const hook = six({ hooks: ['SessionStart', 'Stop'] });
  assert.match(hook.observed, /⚠️ 아래 ⚠️ 줄/);
  assert.match(hook.warn, /훅을 더했다/);
  const left = six({}, { PONYTAIL_DEFAULT_MODE: 'off' });
  assert.match(left.observed, /⚠️ 아래 ⚠️ 줄/);
  assert.match(left.warn, /PONYTAIL_DEFAULT_MODE/);
});

// 27차 — Claude Code 판 확인: 스킬 앞머리 훅(종료 훅)이 도는 판(2.1.331)보다 낮으면 ⚠️ · 읽지 못하면 판정하지 않는다
const LOW = '스킬 앞머리 훅\\(종료 훅\\)이 안 돌 수 있다 — 확인한 판 2\\.1\\.331';

test('⭐ cycleReady — 2.1.331 미만이면 notes 에 ⚠️ 한 줄(현재 판 · 확인한 판) · 이상이면 · 읽지 못했으면(null · 없음) 조용하다 · ⛔ 는 아니다', () => {
  for (const low of ['2.1.330', '2.1.99', '2.0.500', '1.9.9']) {
    const r = ready({}, undefined, low);
    assert.deepEqual(r.problems, []);
    assert.equal(r.notes.length, 1, low);
    assert.match(r.notes[0], new RegExp(`Claude Code ${low.replace(/\./g, '\.')}.*${LOW}`));
  }
  for (const ok of ['2.1.331', '2.1.332', '2.2.0', '3.0.0', '2.1.1000', null, undefined]) assert.deepEqual(ready({}, undefined, ok).notes, [], String(ok));
});

test('⭐ claudeVersion — claude --version 의 숫자 세 마디 · 실패하면 null', () => {
  const at2 = (bin, f) => { const keep = process.env.PATH; process.env.PATH = bin + delimiter + keep; try { return f(); } finally { process.env.PATH = keep; } };
  assert.equal(at2(fakeClaude([], '2.1.330 (Claude Code)'), claudeVersion), '2.1.330');
  assert.equal(at2(fakeClaude([], null), claudeVersion), null);
  assert.equal(at2(fakeClaude([], '버전 모름'), claudeVersion), null);
});

test('⭐ plugin-plan CLI — 낮은 판이면 ⚠️ 줄 · 판이 충분하거나 읽지 못하면 줄이 없다', () => {
  const list = [{ id: SP, scope: 'user', enabled: false, version: PIN }];
  const run = (version) => spawnSync(process.execPath, [join(TOOLS, 'plugin-plan.mjs')], { encoding: 'utf8', env: { ...withPath(fakeClaude(list, version)), CLAUDE_CONFIG_DIR: home() } });
  const low = run('2.1.330 (Claude Code)');
  assert.match(low.stdout, new RegExp(`^⚠️ /exec-cycle · /exec-review — .*${LOW}`, 'm'), low.stderr);
  assert.match(low.stdout, /^✅ \/exec-cycle · \/exec-review 를 바로 쓸 수 있다/m);
  assert.doesNotMatch(run('2.1.332 (Claude Code)').stdout, /스킬 앞머리 훅/);
  assert.doesNotMatch(run(null).stdout, /스킬 앞머리 훅/);
});

test('⭐ 이식 검사 ⑥ — 낮은 판은 ✅ + ⚠️(warn) · 판 입력이 없으면(주입한 목록) 읽지 않는다', () => {
  const dir = tmp('target-');
  put(dir, '.harness/harness.json', JSON.stringify({ profile: 'existing', mode: 'local', checks: [] }));
  const list = [{ id: SP, scope: 'user', enabled: false, version: PIN }];
  const six = (version) => at(home({}), () => checkInstall(dir, { plugins: list, version }).find((r) => r.n === '⑥'));
  const low = six('2.1.330');
  assert.equal(low.ok, true);
  assert.match(low.observed, /⚠️ 아래 ⚠️ 줄/);
  assert.match(low.warn, new RegExp(LOW));
  assert.equal(six('2.1.332').warn, undefined);
  const keep = process.env.PATH;
  process.env.PATH = fakeClaude(list, '2.1.300 (Claude Code)') + delimiter + keep;
  try { assert.equal(six(undefined).warn, undefined, '주입한 목록이면 claude --version 을 부르지 않는다'); } finally { process.env.PATH = keep; }
});

test('⭐ --all 사이클 칸 — 낮은 판은 ⚠️ 칸(맞나는 그대로) + ⚠️ 줄 · 충분하면 ✅', () => {
  const root = tmp('installs-');
  put(root, 'a/.harness/harness.json', JSON.stringify({ profile: 'existing', mode: 'local', checks: [] }));
  const all = (version) => {
    const keep = process.env.PATH;
    process.env.PATH = fakeClaude([], version) + delimiter + keep;
    try { return at(home({}), () => checkAll(root)); } finally { process.env.PATH = keep; }
  };
  const low = all('2.1.330 (Claude Code)');
  assert.match(low.text, /^\| a \| .*\| ⚠️ 사용 가능 — Claude Code 판 낮음 \| ⛔ \|$/m);
  assert.match(low.text, new RegExp(`^⚠️ /exec-cycle · /exec-review — .*${LOW}`, 'm'));
  assert.doesNotMatch(low.text, /^⛔ \/exec-cycle/m);
  assert.match(all('2.1.332 (Claude Code)').text, /^\| a \| .*\| ✅ 사용 가능 \| ⛔ \|$/m);
});

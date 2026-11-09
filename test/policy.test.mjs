import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeSettings, POLICY, readJson } from '../tools/policy-apply.mjs';
import { target } from './scene.mjs';

const APPLY = fileURLToPath(new URL('../tools/policy-apply.mjs', import.meta.url));
const P = {
  _note: '주석',
  permissions: { allow: ['Read', 'Bash(node .harness/tools/verify.mjs)'], deny: ['Bash(git push *)'], ask: ['Bash(*--force*)'] },
  env: { PONYTAIL_DEFAULT_MODE: 'off' },
  enabledPlugins: { 'superpowers@claude-plugins-official': true, 'ponytail@ponytail': true },
  extraKnownMarketplaces: { ponytail: { source: { source: 'github', repo: 'DietrichGebert/ponytail' } } },
};

test('⭐ 권한은 합집합이다 — 대상의 기존 규칙을 지우지 않는다', () => {
  const out = mergeSettings({ permissions: { allow: ['Bash(npm test)', 'Read'] } }, P);
  assert.deepEqual(out.permissions.allow, ['Bash(npm test)', 'Read', 'Bash(node .harness/tools/verify.mjs)']);
  assert.deepEqual(out.permissions.deny, ['Bash(git push *)']);
});

test('⭐ 정책 밖의 키를 보존한다', () => {
  const out = mergeSettings(
    { permissions: { defaultMode: 'acceptEdits' }, hooks: { Stop: [{ x: 1 }] }, env: { FOO: '1' }, enabledPlugins: { 'other@m': true } },
    P,
  );
  assert.equal(out.permissions.defaultMode, 'acceptEdits');
  assert.deepEqual(out.hooks, { Stop: [{ x: 1 }] });
  assert.deepEqual(out.env, { FOO: '1', PONYTAIL_DEFAULT_MODE: 'off' });
  assert.equal(out.enabledPlugins['other@m'], true);
  assert.equal(out.enabledPlugins['ponytail@ponytail'], true);
});

test('정책의 env 값이 대상의 같은 키를 이긴다', () => {
  assert.equal(mergeSettings({ env: { PONYTAIL_DEFAULT_MODE: 'full' } }, P).env.PONYTAIL_DEFAULT_MODE, 'off');
});

test('⛔ 원본을 변형하지 않고, _ 로 시작하는 주석 키를 옮기지 않는다', () => {
  const src = { permissions: { allow: ['Read'] } };
  const out = mergeSettings(src, P);
  assert.deepEqual(src, { permissions: { allow: ['Read'] } });
  assert.equal(out._note, undefined);
});

test('⭐ 배포 정책은 superpowers 만 켠다 — ponytail 은 플러그인이 아니라 리뷰 스킬(PC 에서 plugin-plan)이고 모드 설정도 없다', () => {
  const p = readJson(POLICY);
  assert.deepEqual(p.enabledPlugins, { 'superpowers@harness-kit': true });
  assert.equal(p.env, undefined);
  assert.ok(p.permissions.allow.includes('Bash(node .harness/tools/verify.mjs)'));
});

test('⭐ 정책이 켜는 플러그인은 키트 마켓에서 커밋으로 고정된다 — 새로 설치해도 실측한 버전이다', () => {
  const m = readJson(fileURLToPath(new URL('../.claude-plugin/marketplace.json', import.meta.url)));
  for (const id of Object.keys(readJson(POLICY).enabledPlugins)) {
    const [name, market] = id.split('@');
    assert.equal(market, m.name, id);
    // 공식 마켓은 자동 업데이트가 켜져 있고, 출처에 sha 가 없으면 설치한 날의 최신이 들어온다
    assert.match(m.plugins.find((x) => x.name === name)?.source?.sha ?? '', /^[0-9a-f]{40}$/, id);
  }
});

test('⛔ 배포 정책의 allow 에는 인자로 쓰기·실행에 닿는 명령이 없다 — 자동 승인이 거부 목록을 우회한다', () => {
  // find -exec · sort -o/--compress-program · git diff/log/show --output · node 경로 와일드카드(../ 로 아무 스크립트나 연다)
  const allow = readJson(POLICY).permissions.allow;
  assert.deepEqual(allow.filter((r) => /^Bash\((find|sort|git (diff|log|show))\b/.test(r)), []);
  const node = allow.filter((r) => /^Bash\(node\b/.test(r));
  assert.deepEqual(node.filter((r) => !/^Bash\(node \.harness\/tools\/[\w-]+\.mjs( \*)?\)$/.test(r)), []);
});

test('⛔ 그래프는 읽기 도구만 자동 승인한다 — 쓰기(append·alias)는 사람이 본다', () => {
  const allow = readJson(POLICY).permissions.allow;
  assert.ok(allow.includes('Bash(node .harness/tools/graph-find.mjs *)'));
  assert.ok(allow.includes('Bash(node .harness/tools/graph-find.mjs)'));
  assert.deepEqual(allow.filter((r) => /graph-(append|alias|view|hook)/.test(r)), []);
});

const HOOK = { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.harness/tools/graph-hook.mjs'], timeout: 30 }] }] };
const OLD = { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.harness/tools/graph-hook.mjs"', timeout: 30 };

test('⭐ 훅은 이벤트별로 더하고, 같은 command·args 가 있으면 다시 더하지 않는다 — 기존 훅 보존', () => {
  const mine = { hooks: [{ type: 'command', command: 'node lint.mjs' }] };
  const once = mergeSettings({ hooks: { UserPromptSubmit: [mine], Stop: [{ x: 1 }] } }, { hooks: HOOK });
  assert.deepEqual(once.hooks.UserPromptSubmit, [mine, HOOK.UserPromptSubmit[0]]);
  assert.deepEqual(once.hooks.Stop, [{ x: 1 }]);
  assert.deepEqual(mergeSettings(once, { hooks: HOOK }), once);
});

test('⭐ 명시적으로 끈 플러그인은 다시 켜지 않는다 — 중복 처리(로컬 false)가 재실행에 되살아나지 않는다', () => {
  const out = mergeSettings({ enabledPlugins: { 'superpowers@claude-plugins-official': false } }, P);
  assert.equal(out.enabledPlugins['superpowers@claude-plugins-official'], false);
  assert.equal(out.enabledPlugins['ponytail@ponytail'], true);
});

test('⭐ 옛 셸 형식 키트 훅은 새 형식으로 바꿔 끼운다 — 둘 다 남으면 두 번 돈다 · 같은 그룹의 사용자 훅은 남긴다', () => {
  const mine = { type: 'command', command: 'node lint.mjs' };
  const out = mergeSettings({ hooks: { UserPromptSubmit: [{ hooks: [OLD] }, { hooks: [mine, OLD] }] } }, { hooks: HOOK });
  assert.deepEqual(out.hooks.UserPromptSubmit, [{ hooks: [mine] }, HOOK.UserPromptSubmit[0]]);
  assert.deepEqual(mergeSettings(out, { hooks: HOOK }), out);
});

test('훅 정책은 셸 없이 node 를 바로 띄운다(exec 형식) — 이 PC 실측 bash 경유 1.61초 → 1.13초', () => {
  const hook = (name, event) => readJson(fileURLToPath(new URL(`../policy/${name}.json`, import.meta.url))).hooks[event][0].hooks[0];
  for (const [name, event, timeout] of [['graph-hook', 'UserPromptSubmit', 30], ['gate-hook', 'Stop', 10]]) {
    const h = hook(name, event);
    assert.equal(h.command, 'node');
    assert.deepEqual(h.args, [`\${CLAUDE_PROJECT_DIR}/.harness/tools/${name}.mjs`]);
    assert.equal(h.timeout, timeout);
  }
});

test('⭐ CLI --local --with graph-hook: settings.local.json 에 정책과 훅을 병합하고, 다시 돌려도 같다', () => {
  const dir = target(null, { '.claude/settings.json': '{"team":1}' });
  const path = join(dir, '.claude', 'settings.local.json');
  assert.equal(spawnSync(process.execPath, [APPLY, dir, '--local', '--with', 'graph-hook']).status, 0);
  const once = readFileSync(path, 'utf8');
  const s = JSON.parse(once);
  assert.ok(s.permissions.allow.includes('Bash(node .harness/tools/verify.mjs)'));
  assert.equal(s.enabledPlugins, undefined);
  assert.equal(s.hooks.UserPromptSubmit.length, 1);
  assert.equal(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'), '{"team":1}');
  assert.equal(spawnSync(process.execPath, [APPLY, '--local', dir, '--with', 'graph-hook']).status, 0);
  assert.equal(readFileSync(path, 'utf8'), once);
});

test('⛔ CLI --with 의 이름은 policy/ 안의 파일만 — 경로를 받지 않는다', () => {
  const r = spawnSync(process.execPath, [APPLY, target(null), '--with', '../package'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--with/);
});

test('⭐ CLI: 기존 설정을 보존하며 반영하고, 다시 돌려도 같다 — 이탈은 재실행으로 복구한다', () => {
  const dir = target(null, { '.claude/settings.json': JSON.stringify({ hooks: { Stop: [] }, permissions: { allow: ['Bash(npm test)'] } }) });
  const path = join(dir, '.claude', 'settings.json');
  assert.equal(spawnSync(process.execPath, [APPLY, dir]).status, 0);
  const once = readFileSync(path, 'utf8');
  const s = JSON.parse(once);
  assert.deepEqual(s.hooks, { Stop: [] });
  assert.ok(s.permissions.allow.includes('Bash(npm test)'));
  assert.deepEqual(s.enabledPlugins, { 'superpowers@harness-kit': true });
  assert.equal(spawnSync(process.execPath, [APPLY, dir]).status, 0);
  assert.equal(readFileSync(path, 'utf8'), once);
});

// 옛 정책이 프로젝트에 쓴 것 — 옛 마켓 id 의 켬 · 끔(--off) · 10-03 판 마켓 선언. 다른 플러그인 · env · 마켓은 사용자 것이다
const OLD_SETTINGS = {
  env: { PONYTAIL_DEFAULT_MODE: 'off', MINE: '1' },
  enabledPlugins: { 'superpowers@harness-kit': true, 'ponytail@harness-kit': true, 'ponytail@ponytail': false, 'superpowers@claude-plugins-official': false, 'mine@m': true },
  extraKnownMarketplaces: { ponytail: { source: { source: 'github', repo: 'DietrichGebert/ponytail' } }, mine: { source: { source: 'github', repo: 'me/m' } } },
};

test('⭐ CLI --local: 프로젝트의 superpowers · ponytail 항목을 켬 · 끔 모두 묻지 않고 걷는다 — 플러그인은 PC 에서만 관리한다', () => {
  const dir = target(null, { '.claude/settings.local.json': JSON.stringify(OLD_SETTINGS) });
  const r = apply(dir, '--local');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /걷음.*superpowers@claude-plugins-official.*extraKnownMarketplaces\.ponytail.*env\.PONYTAIL_DEFAULT_MODE/);
  const s = readJson(join(dir, '.claude', 'settings.local.json'));
  assert.deepEqual(s.enabledPlugins, { 'mine@m': true });
  assert.deepEqual(s.extraKnownMarketplaces, { mine: OLD_SETTINGS.extraKnownMarketplaces.mine });
  assert.deepEqual(s.env, { MINE: '1' });
});

test('⭐ 정책이 뺀 rm · rmdir 차단을 걷는다 — 남으면 PC 의 전역 allow 를 이긴다 · 프로젝트가 더한 deny 는 둔다', () => {
  assert.ok(!readJson(POLICY).permissions.deny.some((r) => /^Bash\(rm(dir)? /.test(r)));
  const dir = target(null, { '.claude/settings.local.json': JSON.stringify({ permissions: { deny: ['Bash(rm *)', 'Bash(rmdir *)', 'Bash(kill *)'] } }) });
  const r = apply(dir, '--local');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /걷음.*permissions\.deny: Bash\(rm \*\)/);
  const deny = readJson(join(dir, '.claude', 'settings.local.json')).permissions.deny;
  assert.ok(deny.includes('Bash(kill *)'));
  assert.ok(!deny.includes('Bash(rm *)') && !deny.includes('Bash(rmdir *)'));
});

test('⭐ 키트에서 지운 도구의 allow 줄(policy/removed.json)을 걷는다 — 합집합 병합이라 남는다 · 프로젝트가 더한 allow 는 둔다', () => {
  const gone = readJson(join(dirname(POLICY), 'removed.json')).allow;
  assert.ok(gone.length > 0);
  const dir = target(null, { '.claude/settings.local.json': JSON.stringify({ permissions: { allow: [...gone, 'Bash(npm test)'] } }) });
  const r = apply(dir, '--local');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /걷음.*permissions\.allow: Bash\(node \.harness\/tools\/state-check\.mjs\)/);
  const allow = readJson(join(dir, '.claude', 'settings.local.json')).permissions.allow;
  assert.ok(allow.includes('Bash(npm test)'));
  for (const g of gone) assert.ok(!allow.includes(g), g);
});

test('⭐ CLI 공유: settings.json 에는 팀원 PC 용으로 superpowers 만 선언하고 ponytail 선언 · 모드는 걷는다', () => {
  const dir = target(null, { '.claude/settings.json': JSON.stringify({ env: { PONYTAIL_DEFAULT_MODE: 'off' }, enabledPlugins: { 'ponytail@harness-kit': true } }) });
  assert.equal(apply(dir).status, 0);
  const s = readJson(join(dir, '.claude', 'settings.json'));
  assert.deepEqual(s.enabledPlugins, { 'superpowers@harness-kit': true });
  assert.equal(s.env, undefined);
});

test('⛔ CLI --only gate-hook 은 걷지 않는다 — 지시 파일이 ponytail 모드 · 플러그인을 정한 대상이다', () => {
  const dir = target(null, { '.claude/settings.local.json': JSON.stringify(OLD_SETTINGS) });
  assert.equal(apply(dir, '--local', '--only', 'gate-hook').status, 0);
  const s = readJson(join(dir, '.claude', 'settings.local.json'));
  assert.deepEqual(s.enabledPlugins, OLD_SETTINGS.enabledPlugins);
  assert.deepEqual(s.env, OLD_SETTINGS.env);
});

test('⭐ CLI --only gate-hook: 관문 훅만 건다 — 기존 체계(권한 · ponytail 모드 · 플러그인)를 지켜야 하는 대상', () => {
  const before = { permissions: { allow: ['Read'] }, env: { MINE: '1' }, hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node guard.mjs' }] }] } };
  const dir = target(null, { '.claude/settings.local.json': JSON.stringify(before) });
  const r = apply(dir, '--local', '--only', 'gate-hook');
  assert.equal(r.status, 0, r.stderr);
  const s = readJson(join(dir, '.claude', 'settings.local.json'));
  assert.deepEqual(s.permissions, before.permissions);
  assert.deepEqual(s.env, before.env);
  assert.equal(s.enabledPlugins, undefined);
  assert.deepEqual(s.hooks.PreToolUse, before.hooks.PreToolUse);
  assert.match(JSON.stringify(s.hooks.Stop), /gate-hook\.mjs/);
});

test('⛔ CLI: 대상 설정이 깨진 JSON 이면 덮어쓰지 않고 실패한다', () => {
  const dir = target(null, { '.claude/settings.json': '{ 깨짐' });
  const r = spawnSync(process.execPath, [APPLY, dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /읽지 못했다/);
  assert.equal(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'), '{ 깨짐');
});

const OFF = 'superpowers@harness-kit';
const apply = (...args) => spawnSync(process.execPath, [APPLY, ...args], { encoding: 'utf8' });

test('⭐ CLI --local --off: settings.local.json 에 그 플러그인을 false 로 두고, 다시 돌려도 파일이 같다', () => {
  const dir = target(null);
  const path = join(dir, '.claude', 'settings.local.json');
  const r = apply(dir, '--local', '--off', OFF);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /끈 플러그인 \(.*settings\.local\.json\): superpowers@harness-kit/);
  const once = readFileSync(path, 'utf8');
  const s = JSON.parse(once);
  assert.equal(s.enabledPlugins[OFF], false);
  assert.equal(apply(dir, '--local', '--off', OFF).status, 0);
  assert.equal(readFileSync(path, 'utf8'), once);
});

test('⭐ CLI 공유 + --off: settings.json 은 정책대로 켜고, 끈 것은 settings.local.json 에만 — 그 파일의 기존 키를 보존한다', () => {
  const dir = target(null, {
    '.claude/settings.json': '{"team":1}',
    '.claude/settings.local.json': '{"env":{"MINE":"1"},"enabledPlugins":{"mine@m":true}}',
  });
  const [shared, local] = ['settings.json', 'settings.local.json'].map((f) => join(dir, '.claude', f));
  assert.equal(apply(dir, '--off', OFF).status, 0);
  const once = [shared, local].map((p) => readFileSync(p, 'utf8'));
  const s = JSON.parse(once[0]);
  assert.equal(s.team, 1);
  assert.equal(s.enabledPlugins[OFF], true);
  assert.deepEqual(JSON.parse(once[1]), { env: { MINE: '1' }, enabledPlugins: { 'mine@m': true, [OFF]: false } });
  assert.equal(apply(dir, '--off', OFF).status, 0);
  assert.deepEqual([shared, local].map((p) => readFileSync(p, 'utf8')), once);
});

test('⛔ CLI --off 가 정책이 켜는 플러그인이 아니면 아무 파일도 쓰지 않고 실패한다 — 쓸 수 있는 id 를 알려 준다', () => {
  const fresh = target(null);
  const kept = target(null, { '.claude/settings.local.json': '{"a":1}' });
  const ids = Object.keys(readJson(POLICY).enabledPlugins);
  for (const [dir, args] of [
    [fresh, ['--off', 'other@x']],
    [fresh, ['--local', '--off', 'other@x']],
    [fresh, ['--off']],
    [kept, ['--off', OFF, '--off', 'other@x']], // 앞의 올바른 값도 쓰이지 않는다
  ]) {
    const r = apply(dir, ...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /--off/);
    for (const id of ids) assert.ok(r.stderr.includes(id), `${args.join(' ')} → ${id}`);
  }
  assert.equal(existsSync(join(fresh, '.claude')), false);
  assert.equal(readFileSync(join(kept, '.claude', 'settings.local.json'), 'utf8'), '{"a":1}');
  assert.equal(existsSync(join(kept, '.claude', 'settings.json')), false);
});

test('⛔ CLI 공유 + --off 에서 settings.local.json 이 깨졌으면 settings.json 도 쓰지 않는다 — 읽기를 모두 끝낸 뒤 쓴다', () => {
  const dir = target(null, { '.claude/settings.local.json': '{ 깨짐' });
  const r = apply(dir, '--off', OFF);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /읽지 못했다/);
  assert.equal(existsSync(join(dir, '.claude', 'settings.json')), false);
  assert.equal(readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8'), '{ 깨짐');
});

test('⛔ CLI 는 모르는 -- 인자를 대상 폴더로 읽지 않는다 — --off=<id> 같은 등호 꼴은 아무것도 쓰지 않고 실패한다', () => {
  const cwd = target(null);
  for (const arg of [`--off=${OFF}`, '--with=graph-hook', '--nope']) {
    const r = spawnSync(process.execPath, [APPLY, arg], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 1, arg);
    assert.match(r.stderr, /옵션 값은 띄어 쓴다 \(예: --off <id>\)/, arg);
  }
  assert.deepEqual(readdirSync(cwd), []);
});

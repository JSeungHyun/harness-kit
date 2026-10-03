import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

test('⭐ 배포 정책이 superpowers·ponytail 을 켜고 ponytail 모드를 끈다', () => {
  const p = readJson(POLICY);
  assert.equal(p.env.PONYTAIL_DEFAULT_MODE, 'off');
  assert.equal(p.enabledPlugins['superpowers@claude-plugins-official'], true);
  assert.equal(p.enabledPlugins['ponytail@ponytail'], true);
  assert.equal(p.extraKnownMarketplaces.ponytail.source.repo, 'DietrichGebert/ponytail');
  assert.ok(p.permissions.allow.includes('Bash(node .harness/tools/verify.mjs)'));
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

const HOOK = { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.harness/tools/graph-hook.mjs"', timeout: 30 }] }] };

test('⭐ 훅은 이벤트별로 더하고, 같은 command 가 있으면 다시 더하지 않는다 — 기존 훅 보존', () => {
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

test('훅 정책이 그래프 훅을 timeout 30 으로 선언한다', () => {
  const h = readJson(fileURLToPath(new URL('../policy/graph-hook.json', import.meta.url))).hooks.UserPromptSubmit[0].hooks[0];
  assert.equal(h.command, 'node "$CLAUDE_PROJECT_DIR/.harness/tools/graph-hook.mjs"');
  assert.equal(h.timeout, 30);
});

test('⭐ CLI --local --with graph-hook: settings.local.json 에 정책과 훅을 병합하고, 다시 돌려도 같다', () => {
  const dir = target(null, { '.claude/settings.json': '{"team":1}' });
  const path = join(dir, '.claude', 'settings.local.json');
  assert.equal(spawnSync(process.execPath, [APPLY, dir, '--local', '--with', 'graph-hook']).status, 0);
  const once = readFileSync(path, 'utf8');
  const s = JSON.parse(once);
  assert.equal(s.env.PONYTAIL_DEFAULT_MODE, 'off');
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
  assert.equal(s.env.PONYTAIL_DEFAULT_MODE, 'off');
  assert.equal(spawnSync(process.execPath, [APPLY, dir]).status, 0);
  assert.equal(readFileSync(path, 'utf8'), once);
});

test('⛔ CLI: 대상 설정이 깨진 JSON 이면 덮어쓰지 않고 실패한다', () => {
  const dir = target(null, { '.claude/settings.json': '{ 깨짐' });
  const r = spawnSync(process.execPath, [APPLY, dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /읽지 못했다/);
  assert.equal(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'), '{ 깨짐');
});

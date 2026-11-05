#!/usr/bin/env node
// 설치 — 정책(.harness/policy/*.json)을 대상 Claude 설정에 병합한다. 설계안.
// ⛔ 덮어쓰지 않는다: 권한은 합집합, env·플러그인·마켓은 정책의 키만 정하고 나머지는 보존한다.
//   node .harness/tools/policy-apply.mjs [대상] [--local] [--with <이름>]… [--off <정책 id>]…
//   --local: .claude/settings.local.json 에 (로컬 전용 모드) · --with: policy/<이름>.json 도 병합 (예: graph-hook) · --only: 기본 정책 없이 그것만
//   --off: 그 플러그인 id 를 settings.local.json 에 false 로 — 모드와 무관하게 local 파일. 정책 id(다른 마켓으로 이미 켠 같은 플러그인이 있을 때) 또는 같은 플러그인의 옛 마켓 id(갱신)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { cli } from '../lib/config.mjs';

const policyFile = (name) => fileURLToPath(new URL(`../policy/${name}.json`, import.meta.url));
export const POLICY = policyFile('settings');
const MAPS = ['env', 'enabledPlugins', 'extraKnownMarketplaces'];
const PERMS = ['allow', 'deny', 'ask'];

const hookKey = (h) => [h.command, ...(h.args ?? [])].join(' ');
const commands = (groups = []) => groups.flatMap((g) => (g.hooks ?? []).map(hookKey));
const kitTool = (key) => key.match(/\.harness\/tools\/[\w-]+\.mjs/)?.[0];

export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

// 옛 정책이 프로젝트에 쓴 것을 걷는다 — 플러그인은 PC 에서만 관리하므로 켬 · 끔(--off 가 쓴 옛 마켓 id) 모두 묻지 않고 걷는다
const KIT_PLUGINS = ['superpowers', 'ponytail'];
const OLD_MARKETS = { ponytail: 'DietrichGebert/ponytail' }; // 10-03 판 정책이 쓴 마켓 선언
// 정책에서 뺀 권한 — 합집합 병합이라 남고, 프로젝트 deny 는 전역 allow 를 이긴다(rm 은 PC 가 정한다 · 2026-11-05)
const OLD_RULES = { deny: ['Bash(rm *)', 'Bash(rmdir *)'] };
export function dropOld(settings, declared = {}) {
  const out = structuredClone(settings);
  const gone = [];
  for (const [k, rules] of Object.entries(OLD_RULES)) {
    const hit = (out.permissions?.[k] ?? []).filter((r) => rules.includes(r));
    if (hit.length) { out.permissions[k] = out.permissions[k].filter((r) => !rules.includes(r)); gone.push(...hit.map((r) => `permissions.${k}: ${r}`)); }
  }
  for (const id of Object.keys(out.enabledPlugins ?? {})) {
    if (KIT_PLUGINS.includes(id.split('@')[0]) && !(id in declared)) { delete out.enabledPlugins[id]; gone.push(id); }
  }
  for (const [k, repo] of Object.entries(OLD_MARKETS)) {
    if (out.extraKnownMarketplaces?.[k]?.source?.repo === repo) { delete out.extraKnownMarketplaces[k]; gone.push(`extraKnownMarketplaces.${k}`); }
  }
  if (out.env?.PONYTAIL_DEFAULT_MODE === 'off') { delete out.env.PONYTAIL_DEFAULT_MODE; gone.push('env.PONYTAIL_DEFAULT_MODE'); }
  for (const k of ['enabledPlugins', 'env', 'extraKnownMarketplaces']) if (out[k] && !Object.keys(out[k]).length) delete out[k];
  return { settings: out, gone };
}

export function mergeSettings(settings, policy) {
  const out = { ...settings };
  if (policy.permissions) {
    out.permissions = { ...settings.permissions };
    for (const k of PERMS) {
      if (policy.permissions[k]) out.permissions[k] = [...new Set([...(settings.permissions?.[k] ?? []), ...policy.permissions[k]])];
    }
  }
  for (const k of MAPS) if (policy[k]) out[k] = { ...settings[k], ...policy[k] };
  // 명시적으로 끈 플러그인은 켜지 않는다 — 다른 마켓의 같은 플러그인을 끈 중복 처리가 재실행에 되살아나지 않게
  for (const [id, on] of Object.entries(settings.enabledPlugins ?? {})) if (on === false) out.enabledPlugins[id] = false;
  if (policy.hooks) {
    out.hooks = { ...settings.hooks };
    for (const [event, groups] of Object.entries(policy.hooks)) {
      // 같은 키트 도구의 옛 등록(셸 형식 등)은 빼고 새 것으로 — 둘 다 남으면 두 번 돈다
      const fresh = commands(groups);
      const tools = fresh.map(kitTool).filter(Boolean);
      const stale = (h) => tools.includes(kitTool(hookKey(h))) && !fresh.includes(hookKey(h));
      const have = (out.hooks[event] ?? []).flatMap((g) => {
        if (!g.hooks?.some(stale)) return [g];
        const hooks = g.hooks.filter((h) => !stale(h));
        return hooks.length ? [{ ...g, hooks }] : [];
      });
      const add = groups.filter((g) => !commands([g]).some((c) => commands(have).includes(c)));
      out.hooks[event] = [...have, ...add];
    }
  }
  return out;
}

export const settingsPath = (root, local = false) => join(root, '.claude', local ? 'settings.local.json' : 'settings.json');

export function readJson(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`JSON 을 읽지 못했다: ${path}\n  ${e.message}`);
  }
}

cli(import.meta.url, () => {
  const args = process.argv.slice(2);
  const extra = [];
  const off = new Set();
  const rest = [];
  let only = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--off') {
      off.add(args[++i]);
      continue;
    }
    if (args[i] !== '--with' && args[i] !== '--only') {
      // --off=<id> 같은 꼴이 대상 폴더로 읽혀 엉뚱한 곳에 설정이 생기지 않게
      if (args[i].startsWith('--') && args[i] !== '--local') throw new Error(`알 수 없는 옵션: ${args[i]} — 옵션 값은 띄어 쓴다 (예: --off <id>)`);
      rest.push(args[i]);
      continue;
    }
    only ||= args[i] === '--only';
    const name = args[++i];
    if (!/^[\w-]+$/.test(name ?? '')) throw new Error(`--with 에는 policy/ 안의 정책 이름만 준다 (예: graph-hook): ${name}`);
    extra.push(name);
  }
  // 정책 id, 또는 같은 플러그인의 다른 마켓 id(갱신 때 옛 id 정리) — 이름이 다른 것은 오타로 본다
  const known = Object.keys(readJson(POLICY).enabledPlugins ?? {});
  const names = new Set(known.map((id) => id.split('@')[0]));
  if ([...off].some((id) => !known.includes(id) && !(/^[\w-]+@[\w.-]+$/.test(id ?? '') && names.has(id.split('@')[0])))) {
    throw new Error(`--off 에는 정책이 켜는 플러그인 id(${known.join(', ')}) 나 같은 플러그인의 다른 마켓 id 만 준다`);
  }

  const local = rest.includes('--local');
  const root = rest.find((a) => a !== '--local') ?? process.cwd();
  const path = settingsPath(root, local);
  const personal = settingsPath(root, true);
  let merged = readJson(path);
  const notes = [];
  // --only: 기본 정책(권한 · 플러그인)을 빼고 그 정책만 — 기존 체계를 지켜야 하는 대상
  for (const p of [...(only ? [] : [POLICY]), ...extra.map(policyFile)]) {
    if (!existsSync(p)) throw new Error(`정책이 없다: ${p}`);
    const policy = readJson(p);
    // 로컬 설치는 플러그인을 PC(사용자 범위)에서만 켠다 — 프로젝트에 선언하면 프로젝트마다 관리해야 한다
    if (p === POLICY && local) delete policy.enabledPlugins;
    merged = mergeSettings(merged, policy);
    if (p !== POLICY) continue;
    const { settings, gone } = dropOld(merged, policy.enabledPlugins);
    merged = settings;
    if (gone.length) notes.push(`걷음(옛 정책이 쓴 것 — 플러그인 · rm 은 PC 에서 정한다): ${gone.join(', ')}`);
  }
  // --local 이면 두 경로가 같아 한 번만 쓴다. 읽기는 모두 쓰기 앞에 — 어느 파일이 깨졌어도 반쯤 쓰지 않는다
  const out = new Map([[path, merged]]);
  if (off.size) {
    const offPolicy = { enabledPlugins: Object.fromEntries([...off].map((id) => [id, false])) };
    out.set(personal, mergeSettings(out.get(personal) ?? readJson(personal), offPolicy));
  }
  for (const [p, s] of out) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(s, null, 2)}\n`);
  }
  const offLine = off.size ? [`끈 플러그인 (${personal}): ${[...off].join(', ')}`] : [];
  console.log([`반영: ${path}`, ...offLine, ...notes, '⛔ git diff 로 의도한 것만 바뀌었는지 직접 확인한다'].join('\n'));
});

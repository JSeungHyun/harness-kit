#!/usr/bin/env node
// 설치 — 정책(.harness/policy/*.json)을 대상 Claude 설정에 병합한다. 설계안.
// ⛔ 덮어쓰지 않는다: 권한은 합집합, env·플러그인·마켓은 정책의 키만 정하고 나머지는 보존한다.
//   node .harness/tools/policy-apply.mjs [대상] [--local] [--with <이름>]…
//   --local: .claude/settings.local.json 에 (로컬 전용 모드) · --with: policy/<이름>.json 도 병합 (예: graph-hook)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli } from '../lib/config.mjs';

const policyFile = (name) => fileURLToPath(new URL(`../policy/${name}.json`, import.meta.url));
export const POLICY = policyFile('settings');
const MAPS = ['env', 'enabledPlugins', 'extraKnownMarketplaces'];
const PERMS = ['allow', 'deny', 'ask'];

const commands = (groups = []) => groups.flatMap((g) => (g.hooks ?? []).map((h) => h.command));

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
      const have = out.hooks[event] ?? [];
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
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--with') {
      rest.push(args[i]);
      continue;
    }
    const name = args[++i];
    if (!/^[\w-]+$/.test(name ?? '')) throw new Error(`--with 에는 policy/ 안의 정책 이름만 준다 (예: graph-hook): ${name}`);
    extra.push(name);
  }
  const local = rest.includes('--local');
  const path = settingsPath(rest.find((a) => a !== '--local') ?? process.cwd(), local);
  let merged = readJson(path);
  for (const p of [POLICY, ...extra.map(policyFile)]) {
    if (!existsSync(p)) throw new Error(`정책이 없다: ${p}`);
    merged = mergeSettings(merged, readJson(p));
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`반영: ${path}\n⛔ git diff 로 의도한 것만 바뀌었는지 직접 확인한다`);
});

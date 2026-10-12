#!/usr/bin/env node
// 설치 — 정책(.harness/policy/*.json)을 대상 Claude 설정에 병합한다. 설계안.
// ⛔ 덮어쓰지 않는다: 권한은 합집합, env·플러그인·마켓은 정책의 키만 정하고 나머지는 보존한다.
//   node .harness/tools/policy-apply.mjs [대상] [--local] [--with <이름>]… [--off <정책 id>]…
//   --local: .claude/settings.local.json 에 (로컬 전용 모드) · --with: policy/<이름>.json 도 병합 (예: graph-hook)
//   --off: 정책이 켜는 그 플러그인을 settings.local.json 에 false 로 — 다른 마켓 id 로 이미 켠 같은 플러그인용, 모드와 무관하게 local 파일

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
  const off = new Set();
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--off') {
      off.add(args[++i]);
      continue;
    }
    if (args[i] !== '--with') {
      // --off=<id> 같은 꼴이 대상 폴더로 읽혀 엉뚱한 곳에 설정이 생기지 않게
      if (args[i].startsWith('--') && args[i] !== '--local') throw new Error(`알 수 없는 옵션: ${args[i]} — 옵션 값은 띄어 쓴다 (예: --off <id>)`);
      rest.push(args[i]);
      continue;
    }
    const name = args[++i];
    if (!/^[\w-]+$/.test(name ?? '')) throw new Error(`--with 에는 policy/ 안의 정책 이름만 준다 (예: graph-hook): ${name}`);
    extra.push(name);
  }
  const known = Object.keys(readJson(POLICY).enabledPlugins ?? {});
  if ([...off].some((id) => !known.includes(id))) throw new Error(`--off 에는 정책이 켜는 플러그인 id 만 준다: ${known.join(', ')}`);

  const local = rest.includes('--local');
  const root = rest.find((a) => a !== '--local') ?? process.cwd();
  const path = settingsPath(root, local);
  const personal = settingsPath(root, true);
  let merged = readJson(path);
  for (const p of [POLICY, ...extra.map(policyFile)]) {
    if (!existsSync(p)) throw new Error(`정책이 없다: ${p}`);
    merged = mergeSettings(merged, readJson(p));
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
  const offLine = off.size ? `\n끈 플러그인 (${personal}): ${[...off].join(', ')}` : '';
  console.log(`반영: ${path}${offLine}\n⛔ git diff 로 의도한 것만 바뀌었는지 직접 확인한다`);
});

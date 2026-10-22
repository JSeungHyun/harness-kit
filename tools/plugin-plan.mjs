#!/usr/bin/env node
// 플러그인 이전 — 이 PC 의 사용자 범위 superpowers · ponytail 을 키트 마켓의 고정 커밋으로 옮길 명령을 낸다. 설계안.
//   node <kit>/tools/plugin-plan.mjs
// ⛔ 실행하지 않는다 — 사용자 범위는 이 PC 의 모든 프로젝트에 걸리므로 사용자가 보고 승인한다.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cli } from '../lib/config.mjs';
import { skillInstead } from './policy-apply.mjs';

// 슬래시로 — Git Bash 에 그대로 붙이면 백슬래시가 사라진다
const KIT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');

// 새 것을 먼저 깔고 옛 것을 지운다 — 중간에 실패해도 플러그인이 빠진 채로 남지 않는다
export function plan(list, ids, kit) {
  const user = list.filter((x) => x.scope === 'user');
  const install = [];
  const enable = [];
  const remove = [];
  for (const id of ids) {
    const name = id.split('@')[0];
    const mine = user.find((x) => x.id === id);
    if (!mine) install.push(`claude plugin install ${id}`);
    else if (!mine.enabled) enable.push(`claude plugin enable ${id}`);
    for (const x of user.filter((u) => u.id !== id && u.id.split('@')[0] === name)) remove.push(`claude plugin uninstall ${x.id} --scope user`);
  }
  const add = install.length ? [`claude plugin marketplace add ${kit}`] : [];
  return [...add, ...install, ...enable, ...remove];
}

cli(import.meta.url, () => {
  const raw = execSync('claude plugin list --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const list = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
  // 사용자 스킬로 대신하는 플러그인(ponytail-review)은 옮기지 않는다 — policy-apply --local 도 선언하지 않는다
  const ids = Object.keys(JSON.parse(readFileSync(new URL('../policy/settings.json', import.meta.url), 'utf8')).enabledPlugins ?? {})
    .filter((id) => !skillInstead(id));
  const cmds = plan(list, ids, KIT);
  if (!cmds.length) return console.log(`✅ 이 PC 의 사용자 범위 플러그인이 키트 마켓의 고정 커밋이다 (${ids.join(' · ')}) — 옮길 것 없다`);
  console.log('⚠️ 이 PC 의 사용자 범위 플러그인을 키트 마켓의 고정 커밋으로 옮긴다 — 이 PC 의 모든 프로젝트에 걸리므로 사용자에게 보여 주고 승인받은 뒤 이 순서로:');
  for (const c of cmds) console.log(`  ${c}`);
});

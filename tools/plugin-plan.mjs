#!/usr/bin/env node
// 플러그인 이전 — 이 PC 의 사용자 범위 superpowers · ponytail 을 키트 마켓의 고정 커밋으로 옮길 명령을 낸다. 설계안.
//   node <kit>/tools/plugin-plan.mjs [--upstream]   --upstream: 고정 커밋과 각 플러그인 저장소의 최신 커밋을 비교
// ⛔ 실행하지 않는다 — 사용자 범위는 이 PC 의 모든 프로젝트에 걸리므로 사용자가 보고 승인한다.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cli } from '../lib/config.mjs';
import { skillInstead } from './policy-apply.mjs';

// 슬래시로 — Git Bash 에 그대로 붙이면 백슬래시가 사라진다
const KIT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');

// 새 것을 먼저 깔고 옛 것을 지운다 — 중간에 실패해도 플러그인이 빠진 채로 남지 않는다
// pinned: 키트 마켓이 고정한 버전 { id: version } — 다르면 키트가 고정을 올린 것이다
export function plan(list, ids, kit, pinned = {}) {
  const user = list.filter((x) => x.scope === 'user');
  const install = [];
  const enable = [];
  const update = [];
  const remove = [];
  for (const id of ids) {
    const name = id.split('@')[0];
    const mine = user.find((x) => x.id === id);
    if (!mine) install.push(`claude plugin install ${id}`);
    else if (!mine.enabled) enable.push(`claude plugin enable ${id}`);
    if (mine && pinned[id] && mine.version !== pinned[id]) update.push(`claude plugin update ${id}`);
    for (const x of user.filter((u) => u.id !== id && u.id.split('@')[0] === name)) remove.push(`claude plugin uninstall ${x.id} --scope user`);
  }
  const market = install.length ? [`claude plugin marketplace add ${kit}`] : update.length ? ['claude plugin marketplace update harness-kit'] : [];
  return [...market, ...install, ...enable, ...update, ...remove];
}

// 키트가 고정한 커밋과 각 플러그인 저장소의 최신 커밋을 비교한다 — 올릴지는 바뀐 내용을 읽고 판단한다
async function upstream(market) {
  const out = [];
  for (const { name, version, source } of market.plugins) {
    const head = execSync(`git ls-remote ${source.url} HEAD`, { encoding: 'utf8', timeout: 20000 }).split(/\s/)[0];
    if (head === source.sha) { out.push(`✅ ${name} ${version} — 고정 커밋이 최신이다`); continue; }
    const repo = source.url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
    let latest = '?';
    for (const f of ['.claude-plugin/plugin.json', 'plugin.json']) {
      const r = await fetch(`https://raw.githubusercontent.com/${repo}/${head}/${f}`).catch(() => null);
      if (r?.ok) { latest = (await r.json()).version; break; }
    }
    out.push(`⚠️ ${name} — 고정 ${version} (${source.sha.slice(0, 7)}) · 최신 ${latest} (${head.slice(0, 7)}) · 바뀐 것: https://github.com/${repo}/compare/${source.sha.slice(0, 7)}...${head.slice(0, 7)}`);
  }
  return out;
}

cli(import.meta.url, async () => {
  // 대상의 .harness/tools 사본은 마켓 경로를 자기 위치로 낸다
  if (!existsSync(new URL('../.claude-plugin/marketplace.json', import.meta.url))) throw new Error('키트 저장소의 plugin-plan 을 돌린다 — node <kit>/tools/plugin-plan.mjs');
  const market = JSON.parse(readFileSync(new URL('../.claude-plugin/marketplace.json', import.meta.url), 'utf8'));
  if (process.argv.includes('--upstream')) return console.log((await upstream(market)).join('\n'));
  const pinned = Object.fromEntries(market.plugins.map((x) => [`${x.name}@${market.name}`, x.version]));
  const raw = execSync('claude plugin list --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const list = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
  // 사용자 스킬로 대신하는 플러그인(ponytail-review)은 옮기지 않는다 — policy-apply --local 도 선언하지 않는다
  const ids = Object.keys(JSON.parse(readFileSync(new URL('../policy/settings.json', import.meta.url), 'utf8')).enabledPlugins ?? {})
    .filter((id) => !skillInstead(id));
  const cmds = plan(list, ids, KIT, pinned);
  if (!cmds.length) return console.log(`✅ 이 PC 의 사용자 범위 플러그인이 키트 마켓의 고정 커밋이다 (${ids.join(' · ')}) — 옮길 것 없다`);
  console.log('⚠️ 이 PC 의 사용자 범위 플러그인을 키트 마켓의 고정 커밋으로 옮긴다 — 이 PC 의 모든 프로젝트에 걸리므로 사용자에게 보여 주고 승인받은 뒤 이 순서로:');
  for (const c of cmds) console.log(`  ${c}`);
});

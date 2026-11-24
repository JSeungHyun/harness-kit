#!/usr/bin/env node
// 플러그인 이전 — 이 PC 의 사용자 범위 플러그인을 키트 마켓의 고정 커밋으로 맞출 명령을 낸다. 설계안.
//   node <kit>/tools/plugin-plan.mjs [--upstream | --review-skill]
//   --upstream: 고정 커밋과 각 플러그인 저장소의 최신 커밋을 비교 · --review-skill: 고정 커밋의 ponytail-review 를 사용자 스킬로 둔다
// ⛔ 명령은 실행하지 않는다 — 사용자 범위는 이 PC 의 모든 프로젝트에 걸리므로 사용자가 보고 승인한다.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli } from '../lib/config.mjs';
import { claudeDir, readJson } from './policy-apply.mjs';
import { pluginEntries, skillFile } from './cycle-skill.mjs';

// ponytail 은 플러그인으로 켜지 않는다 — 관문이 쓰는 것은 /ponytail-review 뿐이라 그 스킬만 사용자 범위에 둔다
const REVIEW_SKILL = 'ponytail-review';
const reviewSkillPath = () => join(claudeDir(), 'skills', REVIEW_SKILL, 'SKILL.md');
// 받은 커밋과 내용 해시 — 키트가 ponytail 고정을 올렸거나 받은 뒤 고쳤으면 다시 받는다
const pinnedPath = () => join(claudeDir(), 'skills', REVIEW_SKILL, '.pinned.json');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const readMarket = () => JSON.parse(readFileSync(new URL('../.claude-plugin/marketplace.json', import.meta.url), 'utf8'));
const repoOf = (url) => url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

// 슬래시로 — Git Bash 에 그대로 붙이면 백슬래시가 사라진다
const KIT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');

// 새 것을 먼저 깔고 옛 것을 지운다 — 중간에 실패해도 플러그인이 빠진 채로 남지 않는다
// pinned: 키트 마켓이 고정한 버전 { id: version } — 다르면 키트가 고정을 올린 것이다
// off: 사용자 범위에서 꺼 두는 id(ponytail) — 지우지 않는다. 모드를 쓰는 프로젝트가 자기 설정에서 켤 수 있게
export function plan(list, ids, kit, pinned = {}, off = [], hasSkill = true) {
  const user = list.filter((x) => x.scope === 'user');
  const install = [];
  const update = [];
  const disable = [];
  const remove = [];
  for (const id of [...ids, ...off]) {
    const name = id.split('@')[0];
    const mine = user.find((x) => x.id === id);
    const keepOff = off.includes(id);
    if (!mine && !keepOff) install.push(`claude plugin install ${id}`);
    else if (mine?.enabled && keepOff) disable.push(`claude plugin disable ${id} --scope user`);
    // --scope 없이 돌리면 그 폴더의 local 범위 기록만 오른다(2.1.318 실측)
    if (mine && pinned[id] && mine.version !== pinned[id]) update.push(`claude plugin update ${id} --scope user`);
    for (const x of user.filter((u) => u.id !== id && u.id.split('@')[0] === name)) remove.push(`claude plugin uninstall ${x.id} --scope user`);
  }
  const market = install.length ? [`claude plugin marketplace add ${kit}`] : update.length ? ['claude plugin marketplace update harness-kit'] : [];
  // 리뷰 스킬을 먼저 — ponytail 을 끄기 전에 /ponytail-review 가 있어야 관문이 비지 않는다
  const skill = off.length && !hasSkill ? [`node ${kit}/tools/plugin-plan.mjs --review-skill`] : [];
  return [...skill, ...market, ...install, ...update, ...disable, ...remove];
}

// 고정 커밋의 리뷰 스킬 한 파일을 사용자 스킬로 — 다른 파일에 기대지 않는다(2026-11-05 확인)
async function reviewSkill(market) {
  const { source, version } = market.plugins.find((x) => x.name === 'ponytail');
  const r = await fetch(`https://raw.githubusercontent.com/${repoOf(source.url)}/${source.sha}/skills/${REVIEW_SKILL}/SKILL.md`).catch(() => null);
  const text = r?.ok ? await r.text() : '';
  if (!new RegExp(`^name: ${REVIEW_SKILL}$`, 'm').test(text)) throw new Error(`고정 커밋(${source.sha.slice(0, 7)})에서 ${REVIEW_SKILL} 를 받지 못했다 — 네트워크를 확인한다`);
  mkdirSync(join(reviewSkillPath(), '..'), { recursive: true });
  writeFileSync(reviewSkillPath(), text);
  writeFileSync(pinnedPath(), JSON.stringify({ sha: source.sha, sha256: sha256(text) }));
  return `✅ ${reviewSkillPath()} — ponytail ${version} (${source.sha.slice(0, 7)}) 의 리뷰 스킬. /${REVIEW_SKILL} 로 부른다`;
}

export function reviewSkillPinned(market = readMarket()) {
  try {
    const mark = JSON.parse(readFileSync(pinnedPath(), 'utf8'));
    return mark.sha === market.plugins.find((x) => x.name === 'ponytail').source.sha && mark.sha256 === sha256(readFileSync(reviewSkillPath(), 'utf8'));
  } catch { return false; }
}

// 이 PC 가 키트 마켓의 고정 커밋인가 — 낼 명령이 없으면 맞다. 이식 검사 ⑥ 도 이 판정을 쓴다
export function pcPlan(list) {
  const market = readMarket();
  const pinned = Object.fromEntries(market.plugins.map((x) => [`${x.name}@${market.name}`, x.version]));
  // 정책이 켜는 것(superpowers)은 켜고, 마켓의 나머지(ponytail)는 사용자 범위에서 꺼 두고 리뷰 스킬만 쓴다
  const ids = Object.keys(JSON.parse(readFileSync(new URL('../policy/settings.json', import.meta.url), 'utf8')).enabledPlugins ?? {});
  const off = market.plugins.map((x) => `${x.name}@${market.name}`).filter((id) => !ids.includes(id));
  return { ids, cmds: plan(list, ids, KIT, pinned, off, reviewSkillPinned(market)) };
}

// /exec-cycle · /exec-review 를 바로 쓸 수 있나 — superpowers 가 키트 고정 판으로 설치돼 있고(켬/끔 무관) 사이클이 읽는 스킬 파일이 다 있고 ponytail-review 가 있다.
// problems: ⛔ + 고칠 명령 · warns: ⚠️(켜져 있으면 세션마다 시작 글이 자동 주입된다 — 사이클만 쓰려면 끈다 · 사용자 승인 몫). list: claude plugin list --json (없으면 사용자 settings 의 enabledPlugins)
// 사이클이 읽는 스킬은 두 스킬 본문(templates/skills/exec-cycle · exec-review)에서 뽑는다 — 이름을 두 곳에 적지 않는다
const SP = 'superpowers@harness-kit';
export const cycleSkills = () => [...new Set(['exec-cycle', 'exec-review'].flatMap((s) => [...readFileSync(new URL(`../templates/skills/${s}/SKILL.md`, import.meta.url), 'utf8').matchAll(/`((?:superpowers|ponytail) [a-z-]+)`/g)].map((m) => m[1])))].map((k) => k.split(' '));
export function cycleReady(list) {
  const pin = readMarket().plugins.find((x) => x.name === 'superpowers').version;
  const problems = [];
  const warns = [];
  const mine = pluginEntries('superpowers', SP).find((e) => e.scope === 'user');
  if (!mine) problems.push(`superpowers 가 이 PC 에 없다 — claude plugin install ${SP}(plugin-plan 의 명령)`);
  else if (mine.version !== pin) problems.push(`superpowers ${mine.version} 은 키트 고정 판(${pin})이 아니다 — claude plugin update ${SP} --scope user`);
  const missing = cycleSkills().filter(([plugin, skill]) => !skillFile(plugin, skill)).map(([plugin, skill]) => `${plugin} ${skill}`);
  if (mine && missing.some((m) => m.startsWith('superpowers'))) problems.push(`사이클이 읽는 superpowers 스킬 파일이 없다: ${missing.filter((m) => m.startsWith('superpowers')).join(' · ')} — 플러그인을 다시 깐다(claude plugin install ${SP})`);
  if (missing.some((m) => m.startsWith('ponytail'))) problems.push(`ponytail-review 스킬이 없다 — node <kit>/tools/plugin-plan.mjs --review-skill`);
  let on;
  if (list) on = list.some((x) => x.id === SP && x.scope === 'user' && x.enabled);
  else try { on = readJson(join(claudeDir(), 'settings.json')).enabledPlugins?.[SP] === true; } catch { on = false; }
  if (mine && on) warns.push(`superpowers 가 켜져 있다 — 자동 주입(세션마다 시작 글 약 6k자)이 붙는다. /exec-cycle · /exec-review 안에서만 쓰면 끈다: claude plugin disable ${SP} --scope user · superpowers 스킬을 단독으로도 부르면 켜 둔다 (사용자 승인 몫 · 끄기는 설치를 남긴다 — 사이클이 스킬 파일을 읽는다 · uninstall 하면 /exec-cycle · /exec-review 가 멈춘다)`);
  return { problems, warns };
}

// 키트 폴더에서 읽는다 — 프로젝트 폴더에서는 그 프로젝트 설정이 사용자 범위를 덮은 값이 나온다(2026-11-05 실측)
export function pluginList() {
  const raw = execSync('claude plugin list --json', { cwd: KIT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
}

// 키트가 고정한 커밋과 각 플러그인 저장소의 최신 커밋을 비교한다 — 올릴지는 바뀐 내용을 읽고 판단한다
async function upstream(market) {
  const out = [];
  for (const { name, version, source } of market.plugins) {
    const head = execSync(`git ls-remote ${source.url} HEAD`, { encoding: 'utf8', timeout: 20000 }).split(/\s/)[0];
    if (head === source.sha) { out.push(`✅ ${name} ${version} — 고정 커밋이 최신이다`); continue; }
    const repo = repoOf(source.url);
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
  const market = readMarket();
  if (process.argv.includes('--upstream')) return console.log((await upstream(market)).join('\n'));
  if (process.argv.includes('--review-skill')) return console.log(await reviewSkill(market));
  const list = pluginList();
  const { ids, cmds } = pcPlan(list);
  if (!cmds.length) console.log(`✅ 이 PC 가 키트 마켓의 고정 커밋이다 — 설치 ${ids.join(' · ')} · 리뷰 스킬만 ${REVIEW_SKILL} — 옮길 것 없다`);
  else {
    console.log('⚠️ 이 PC 의 사용자 범위 플러그인을 키트 마켓의 고정 커밋으로 옮긴다 — 이 PC 의 모든 프로젝트에 걸리므로 사용자에게 보여 주고 승인받은 뒤 이 순서로:');
    for (const c of cmds) console.log(`  ${c}`);
  }
  const cycle = cycleReady(list);
  for (const p of cycle.problems) console.log(`⛔ /exec-cycle · /exec-review — ${p}`);
  for (const w of cycle.warns) console.log(`⚠️ /exec-cycle · /exec-review — ${w}`);
  if (!cycle.problems.length) console.log('✅ /exec-cycle · /exec-review 를 바로 쓸 수 있다 — superpowers 스킬 · ponytail-review 파일이 있다');
});

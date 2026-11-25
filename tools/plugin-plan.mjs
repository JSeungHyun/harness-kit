#!/usr/bin/env node
// 플러그인 이전 — 이 PC 의 사용자 범위 플러그인을 키트 마켓의 고정 커밋으로 맞출 명령을 낸다. 설계안.
//   node <kit>/tools/plugin-plan.mjs [--upstream | --review-skill]
//   --upstream: 고정 커밋과 각 플러그인 저장소의 최신 커밋을 비교 · --review-skill: 키트의 ponytail-review(templates/user-skills)를 사용자 스킬로 둔다
// ⛔ 명령은 실행하지 않는다 — 사용자 범위는 이 PC 의 모든 프로젝트에 걸리므로 사용자가 보고 승인한다.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli } from '../lib/config.mjs';
import { claudeDir, readJson } from './policy-apply.mjs';
import { pluginEntries, skillFile } from './cycle-skill.mjs';

// ponytail 플러그인은 쓰지 않는다 — 쓰는 것은 리뷰 지시문 한 장이라 키트 파일(MIT 원본에서 앞머리 한 줄만 다름)을 사용자 스킬로 깐다
const REVIEW_SKILL = 'ponytail-review';
const reviewSkillDir = () => join(claudeDir(), 'skills', REVIEW_SKILL);
const kitSkillDir = () => fileURLToPath(new URL(`../templates/user-skills/${REVIEW_SKILL}`, import.meta.url));
const lf = (s) => s.replace(/\r\n/g, '\n');
const readMarket = () => JSON.parse(readFileSync(new URL('../.claude-plugin/marketplace.json', import.meta.url), 'utf8'));
const repoOf = (url) => url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

// 슬래시로 — Git Bash 에 그대로 붙이면 백슬래시가 사라진다
const KIT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');

// 새 것을 먼저 깔고 옛 것을 지운다 — 중간에 실패해도 플러그인이 빠진 채로 남지 않는다
// pinned: 키트 마켓이 고정한 버전 { id: version } — 다르면 키트가 고정을 올린 것이다
export function plan(list, ids, kit, pinned = {}, hasSkill = true) {
  const user = list.filter((x) => x.scope === 'user');
  const install = [];
  const update = [];
  const remove = [];
  for (const id of ids) {
    const name = id.split('@')[0];
    const mine = user.find((x) => x.id === id);
    if (!mine) install.push(`claude plugin install ${id}`);
    // --scope 없이 돌리면 그 폴더의 local 범위 기록만 오른다(2.1.318 실측)
    if (mine && pinned[id] && mine.version !== pinned[id]) update.push(`claude plugin update ${id} --scope user`);
    for (const x of user.filter((u) => u.id !== id && u.id.split('@')[0] === name)) remove.push(`claude plugin uninstall ${x.id} --scope user`);
  }
  const market = install.length ? [`claude plugin marketplace add ${kit}`] : update.length ? ['claude plugin marketplace update harness-kit'] : [];
  const skill = hasSkill ? [] : [`node ${kit}/tools/plugin-plan.mjs --review-skill`];
  return [...skill, ...market, ...install, ...update, ...remove];
}

// 키트 파일(SKILL.md · LICENSE)을 사용자 스킬 폴더에 — 같지 않으면 덮는다. 옛 .pinned.json(고정 커밋 기록)은 걷는다
function reviewSkill() {
  cpSync(kitSkillDir(), reviewSkillDir(), { recursive: true });
  rmSync(join(reviewSkillDir(), '.pinned.json'), { force: true });
  return `✅ ${join(reviewSkillDir(), 'SKILL.md')} — 키트의 리뷰 지시문(ponytail MIT). /${REVIEW_SKILL} 로 부른다`;
}

// 사용자 스킬이 키트 판과 같은가 — none: 없음 · diff: 다름(줄바꿈 차이는 같다)
export function reviewSkillState() {
  try { return lf(readFileSync(join(reviewSkillDir(), 'SKILL.md'), 'utf8')) === lf(readFileSync(join(kitSkillDir(), 'SKILL.md'), 'utf8')) ? 'ok' : 'diff'; } catch { return 'none'; }
}

// 옛 PC — 쓰지 않는 ponytail 플러그인(사용자 범위)과 전역 env 의 PONYTAIL_DEFAULT_MODE. ⚠️ 줄과 걷는 명령 · 지우는 것은 사용자 승인 몫이라 ⛔ 가 아니다
export function ponytailLeft(list) {
  const out = list.filter((x) => x.scope === 'user' && x.id.split('@')[0] === 'ponytail').map((x) => `ponytail 플러그인이 남아 있다(${x.id}) — 쓰지 않는다(리뷰 지시문은 키트 사용자 스킬): claude plugin uninstall ${x.id} --scope user`);
  let env;
  try { env = readJson(join(claudeDir(), 'settings.json')).env; } catch { /* 설정 없음 */ }
  if (env && 'PONYTAIL_DEFAULT_MODE' in env) out.push('전역 env 에 PONYTAIL_DEFAULT_MODE 가 남아 있다 — ~/.claude/settings.json 의 env 에서 그 줄을 지운다(플러그인이 없으면 아무 일도 하지 않는다)');
  return out;
}

// 이 PC 가 키트 마켓의 고정 커밋인가 — 낼 명령이 없으면 맞다. 이식 검사 ⑥ 도 이 판정을 쓴다
export function pcPlan(list) {
  const market = readMarket();
  const pinned = Object.fromEntries(market.plugins.map((x) => [`${x.name}@${market.name}`, x.version]));
  const ids = Object.keys(JSON.parse(readFileSync(new URL('../policy/settings.json', import.meta.url), 'utf8')).enabledPlugins ?? {});
  return { ids, cmds: plan(list, ids, KIT, pinned, reviewSkillState() === 'ok'), warns: ponytailLeft(list) };
}

// /exec-cycle · /exec-review 를 바로 쓸 수 있나 — superpowers 가 키트 고정 판으로 설치돼 있고(켬/끔 무관) 사이클이 읽는 스킬 파일이 다 있고 ponytail-review 가 있다.
// problems: ⛔ + 고칠 명령 · warns: ⚠️(켜져 있으면 세션마다 시작 글이 자동 주입된다 — 사이클만 쓰려면 끈다 · 사용자 승인 몫). list: claude plugin list --json (없으면 사용자 settings 의 enabledPlugins)
// 사이클이 읽는 스킬은 두 스킬 본문(templates/skills/exec-cycle · exec-review)에서 뽑는다 — 이름을 두 곳에 적지 않는다
const SP = 'superpowers@harness-kit';
export const cycleSkills = () => [...new Set(['exec-cycle', 'exec-review'].flatMap((s) => [...readFileSync(new URL(`../templates/skills/${s}/SKILL.md`, import.meta.url), 'utf8').matchAll(/`((?:superpowers|user) [a-z-]+)`/g)].map((m) => m[1])))].map((k) => k.split(' '));
// 설치된 superpowers 의 hooks/hooks.json 이벤트 이름 — 없거나 깨지면 빈 목록
const hookEvents = (installPath) => { try { return Object.keys(JSON.parse(readFileSync(join(installPath, 'hooks', 'hooks.json'), 'utf8')).hooks ?? {}); } catch { return []; } };
export function cycleReady(list, version) {
  const pin = readMarket().plugins.find((x) => x.name === 'superpowers').version;
  const problems = [];
  const warns = [];
  const notes = [];
  const mine = pluginEntries('superpowers', SP).find((e) => e.scope === 'user');
  if (!mine) problems.push(`superpowers 가 이 PC 에 없다 — claude plugin install ${SP}(plugin-plan 의 명령)`);
  else if (mine.version !== pin) problems.push(`superpowers ${mine.version} 은 키트 고정 판(${pin})이 아니다 — claude plugin update ${SP} --scope user`);
  const missing = cycleSkills().filter(([plugin, skill]) => plugin === 'superpowers' && !skillFile(plugin, skill)).map(([plugin, skill]) => `${plugin} ${skill}`);
  if (mine && missing.length) problems.push(`사이클이 읽는 superpowers 스킬 파일이 없다: ${missing.join(' · ')} — 플러그인을 다시 깐다(claude plugin install ${SP})`);
  const review = reviewSkillState();
  if (review !== 'ok') problems.push(`사용자 스킬 ${REVIEW_SKILL} 가 ${review === 'none' ? '없다' : '키트 판과 다르다'} — node ${KIT}/tools/plugin-plan.mjs --review-skill`);
  let on;
  if (list) on = list.some((x) => x.id === SP && x.scope === 'user' && x.enabled);
  else try { on = readJson(join(claudeDir(), 'settings.json')).enabledPlugins?.[SP] === true; } catch { on = false; }
  if (mine && on) warns.push(`superpowers 가 켜져 있다 — 자동 주입(세션마다 시작 글 약 6k자)이 붙는다. /exec-cycle · /exec-review 안에서만 쓰면 끈다: claude plugin disable ${SP} --scope user · superpowers 스킬을 단독으로도 부르면 켜 둔다 (사용자 승인 몫 · 끄기는 설치를 남긴다 — 사이클이 스킬 파일을 읽는다 · uninstall 하면 /exec-cycle · /exec-review 가 멈춘다)`);
  // 켜 둔 판이 훅을 더했으면 끈 상태에서는 안 도는 것이 생긴다 — 키트가 확인한 것은 SessionStart(자동 주입) 하나
  const more = mine ? hookEvents(mine.installPath).filter((e) => e !== 'SessionStart') : [];
  if (more.length) notes.push(`superpowers 판이 훅을 더했다(${more.join(' · ')}) — 끈 상태에서는 돌지 않는다 · /exec-cycle 영향을 검토`);
  if (version && older(version, GATE_MIN)) notes.push(`Claude Code ${version} 은 스킬 앞머리 훅(종료 훅)이 안 돌 수 있다 — 확인한 판 ${GATE_MIN} · 올린다: claude update`);
  return { problems, warns, notes };
}

// 스킬 앞머리 훅(종료 훅)이 도는 것을 확인한 Claude Code 판 — 이보다 낮으면 ⚠️(⛔ 아님). 읽지 못하면 판정하지 않는다
export const GATE_MIN = '2.1.331';
const older = (a, b) => { const [x, y] = [a, b].map((v) => v.split('.').map(Number)); const i = x.findIndex((n, k) => n !== y[k]); return i >= 0 && x[i] < y[i]; };
export function claudeVersion() {
  try { return /(\d+\.\d+\.\d+)/.exec(execSync('claude --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }))?.[1] ?? null; } catch { return null; }
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
  if (process.argv.includes('--review-skill')) return console.log(reviewSkill());
  const list = pluginList();
  const { ids, cmds, warns } = pcPlan(list);
  if (!cmds.length) console.log(`✅ 이 PC 가 키트 마켓의 고정 커밋이다 — 설치 ${ids.join(' · ')} · 사용자 스킬 ${REVIEW_SKILL} 이 키트 판 — 옮길 것 없다`);
  else {
    console.log('⚠️ 이 PC 의 사용자 범위 플러그인을 키트 마켓의 고정 커밋으로 옮긴다 — 이 PC 의 모든 프로젝트에 걸리므로 사용자에게 보여 주고 승인받은 뒤 이 순서로:');
    for (const c of cmds) console.log(`  ${c}`);
  }
  for (const w of warns) console.log(`⚠️ ${w}`);
  const cycle = cycleReady(list, claudeVersion());
  for (const p of cycle.problems) console.log(`⛔ /exec-cycle · /exec-review — ${p}`);
  for (const w of [...cycle.warns, ...cycle.notes]) console.log(`⚠️ /exec-cycle · /exec-review — ${w}`);
  if (!cycle.problems.length) console.log('✅ /exec-cycle · /exec-review 를 바로 쓸 수 있다 — superpowers 스킬 · 사용자 스킬 ponytail-review 가 있다');
});

#!/usr/bin/env node
// /exec-cycle 이 읽을 스킬 파일의 경로를 낸다 — 플러그인이 꺼져 있어도(자동 주입 없이) 파일로 읽게. 설계안.
//   node .harness/tools/cycle-skill.mjs <플러그인> <스킬>   없으면 exit 1
// 플러그인은 installed_plugins.json 의 설치 경로(켬/끔은 보지 않는다) — 판이 여럿이면 사용자 범위, 없으면 가장 최근 갱신. 없으면 ~/.claude/skills 의 사용자 스킬
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli } from '../lib/config.mjs';
import { claudeDir } from './policy-apply.mjs';

const slash = (p) => p.replace(/\\/g, '/');

// 사용자 범위 · 또는 projectPath 가 지금 작업 폴더(상위 포함)인 설치만 — 다른 프로젝트 전용 설치의 지시문을 읽지 않는다
const norm = (p) => slash(String(p)).replace(/\/$/, '').toLowerCase();
const mine = (e) => e.scope === 'user' || (e.projectPath && (`${norm(process.cwd())}/`).startsWith(`${norm(e.projectPath)}/`));

// 설치 기록 — id 가 <플러그인> 또는 <플러그인>@<마켓> 인 것, 사용자 범위 먼저 → 최근 갱신 먼저. 이식 · 갱신 검사(plugin-plan cycleReady)도 쓴다
export function pluginEntries(plugin, id = null) {
  let all = {};
  try { all = JSON.parse(readFileSync(join(claudeDir(), 'plugins', 'installed_plugins.json'), 'utf8')).plugins ?? {}; } catch { /* 없거나 깨짐 — 사용자 스킬만 */ }
  const entries = Object.entries(all).filter(([k]) => (id ? k === id : k === plugin || k.startsWith(`${plugin}@`))).flatMap(([, v]) => v).filter(mine);
  const rank = (e) => [e.scope === 'user' ? 1 : 0, Date.parse(e.lastUpdated) || 0];
  return entries.sort((a, b) => rank(b)[0] - rank(a)[0] || rank(b)[1] - rank(a)[1]);
}

// 스킬 파일 경로 — 플러그인 설치 경로 → 사용자 스킬. 없으면 undefined
export const skillFile = (plugin, skill) => [...pluginEntries(plugin).map((e) => join(e.installPath, 'skills', skill, 'SKILL.md')), join(claudeDir(), 'skills', skill, 'SKILL.md')].find(existsSync);

cli(import.meta.url, () => {
  const [plugin, skill] = process.argv.slice(2);
  if (!plugin || !skill) throw new Error('쓰는 법: node .harness/tools/cycle-skill.mjs <플러그인> <스킬>');
  const found = skillFile(plugin, skill);
  if (!found) throw new Error(plugin === 'user' ? `스킬 ${skill} 파일이 없다 — ~/.claude/skills/${skill} 이 없다. 키트 판을 깔려면 node <키트>/tools/plugin-plan.mjs --review-skill` : `스킬 ${skill} 파일이 없다 — 플러그인 ${plugin} 이 설치돼 있지 않거나(claude plugin install) 그 스킬이 없다. ~/.claude/skills/${skill} 도 없다`);
  console.log(slash(found));
});

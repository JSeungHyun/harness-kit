#!/usr/bin/env node
// ④ LESSONS 승격 후보 — 같은 분류가 반복됐고 아직 막는 것이 없으면 올린다. 설계안.
// ⛔ 승격은 자동으로 하지 않는다 — 규약을 고치는 것은 사람의 판단이다. exit 0 고정.

import { readFileSync } from 'node:fs';
import { loadConfig, cli } from '../lib/config.mjs';
import { cells } from '../lib/mdtable.mjs';
import { NO_GUARD } from './lesson-append.mjs';

export function promotionCandidates(cfg, threshold = 2) {
  if (!cfg.state.lessons) throw new Error('.harness/harness.json 에 state.lessons 가 없다');
  const byCategory = new Map();
  for (const line of readFileSync(cfg.state.lessons, 'utf8').split(/\r?\n/)) {
    const c = cells(line);
    if (!c || c.length < 5 || !/^L\d+$/.test(c[0])) continue;
    const [id, category, , , guard] = c;
    if (guard !== NO_GUARD) continue; // 막는 것이 생겼으면 승격이 끝났다
    byCategory.set(category, [...(byCategory.get(category) ?? []), id]);
  }
  return [...byCategory]
    .filter(([, ids]) => ids.length >= threshold)
    .map(([category, ids]) => ({ category, count: ids.length, ids }))
    .sort((a, b) => b.count - a.count);
}

cli(import.meta.url, () => {
  const found = promotionCandidates(loadConfig(process.argv[2] ?? process.cwd()));
  if (found.length === 0) {
    console.log('승격 후보 없음');
    return;
  }
  console.log('승격 후보 — 같은 분류가 반복됐고 아직 막는 것이 없다:');
  for (const c of found) console.log(`  ${c.category} ×${c.count} (${c.ids.join(' ')})`);
  console.log('\n⇒ 규칙(.claude/rules/ 등)이나 테스트로 막고, 각 행의 「무엇이 막는가」에 그 위치를 적는다.');
});

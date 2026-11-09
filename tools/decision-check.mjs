#!/usr/bin/env node
// ④ DECISIONS — 묻지 않고 넘어간 가정 중 답을 기다리는 것(1절)을 목록으로 낸다. 설계안.
// ⛔ exit 1 하지 않는다 — 답을 기다리는 것은 결함이 아니다. 날짜 경고는 지웠다 — 파일 갱신일 기준이라 어느 항목을 고쳐도 다시 시작해 0번 울렸다(plan 11차).

import { readFileSync } from 'node:fs';
import { loadConfig, cli } from '../lib/config.mjs';

export function auditDecisions(cfg) {
  if (!cfg.state.decisions) throw new Error('.harness/harness.json 에 state.decisions 가 없다');
  const text = readFileSync(cfg.state.decisions, 'utf8');
  const open = [];
  let inOpen = false;
  for (const line of text.split(/\r?\n/)) {
    const h1 = line.match(/^#\s+(\d+)\./);
    if (h1) {
      inOpen = h1[1] === '1';
      continue;
    }
    const q = inOpen && line.match(/^##\s+(Q\d+)\s*·\s*(.+?)\s*$/);
    if (q) open.push({ id: q[1], title: q[2] });
  }
  return { open };
}

cli(import.meta.url, () => {
  const cfg = loadConfig(process.argv[2] ?? process.cwd());
  if (!cfg.state.decisions) {
    console.log('가정 장부가 없다 (.harness/harness.json 의 state.decisions) — 건너뛴다');
    return;
  }
  const r = auditDecisions(cfg);
  console.log(`열린 결정 ${r.open.length}건`);
  for (const q of r.open) console.log(`  · ${q.id} ${q.title}`);
});

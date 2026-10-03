#!/usr/bin/env node
// ④ DECISIONS — 묻지 않고 넘어간 가정이 답 없이 묵고 있는지 본다. 설계안.
// ⛔ exit 1 하지 않는다 — 답을 기다리는 것은 결함이 아니다. 경고는 임계를 넘겼을 때만 낸다.

import { readFileSync } from 'node:fs';
import { loadConfig, cli } from '../lib/config.mjs';

export const STALE_DAYS = 14;

export function auditDecisions(cfg, today = new Date()) {
  if (!cfg.state.decisions) throw new Error('.harness/harness.json 에 state.decisions 가 없다');
  const text = readFileSync(cfg.state.decisions, 'utf8');
  const updated = text.match(/\|\s*갱신일\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|/);
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
  const staleDays = updated ? Math.round((today - new Date(updated[1])) / 86400000) : null;
  return { open, staleDays, warn: open.length > 0 && staleDays !== null && staleDays > STALE_DAYS };
}

cli(import.meta.url, () => {
  const cfg = loadConfig(process.argv[2] ?? process.cwd());
  if (!cfg.state.decisions) {
    console.log('가정 장부가 없다 (.harness/harness.json 의 state.decisions) — 건너뛴다');
    return;
  }
  const r = auditDecisions(cfg);
  console.log(`열린 결정 ${r.open.length}건 · 갱신 후 ${r.staleDays ?? '?'}일`);
  for (const q of r.open) console.log(`  · ${q.id} ${q.title}`);
  if (r.warn) console.log(`⚠️ ${STALE_DAYS}일을 넘겼다 — 되돌리기 비용이 오르고 있다. 사용자에게 1절을 보여준다`);
});

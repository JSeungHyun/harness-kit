#!/usr/bin/env node
// ④ STATE — 진행 상태 대장이 거짓말하는지 본다. 설계안.
// ⛔ 진행도 게이트가 아니다: 무결성 위반(대장이 가리키는 파일 소멸)만 exit 1, 재작업·잔량은 보고만 한다.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, cli } from '../lib/config.mjs';
import { parseAuditRows, hash12 } from '../lib/mdtable.mjs';

const CLAIMED = new Set(['분석완료', '부분분석']);

export function auditState(cfg) {
  if (!cfg.state.current) throw new Error('.harness/harness.json 에 state.current 가 없다');
  const base = cfg.state.currentRoot ?? cfg.root;
  const rows = parseAuditRows(readFileSync(cfg.state.current, 'utf8'));
  if (rows.length === 0) throw new Error(`대장에서 행을 읽지 못했다: ${cfg.state.current}`);

  const stale = [];
  const missing = [];
  let remaining = 0;
  for (const r of rows) {
    if (r.status === '해당없음') continue;
    const path = join(base, r.target);
    if (!existsSync(path) || !statSync(path).isFile()) {
      missing.push(r.target);
      continue;
    }
    if (!CLAIMED.has(r.status)) {
      remaining += 1;
      continue;
    }
    const now = hash12(readFileSync(path));
    if (now !== r.hash) stale.push({ target: r.target, hash: now });
  }
  return { total: rows.length, stale, missing, remaining, integrityOk: missing.length === 0 };
}

cli(import.meta.url, () => {
  const cfg = loadConfig(process.argv[2] ?? process.cwd());
  if (!cfg.state.current) {
    console.log('대장이 없다 (.harness/harness.json 의 state.current) — 건너뛴다');
    return;
  }
  const r = auditState(cfg);
  console.log(`대장 ${r.total}행 · 잔량 ${r.remaining} · 재작업 ${r.stale.length} · 소멸 ${r.missing.length}`);
  for (const s of r.stale) console.log(`  ↻ ${s.target} — 원본이 바뀌었다 (현재 해시 ${s.hash})`);
  for (const t of r.missing) console.log(`  ⛔ ${t} — 대장이 가리키는 파일이 없다`);
  if (!r.integrityOk) process.exit(1);
});

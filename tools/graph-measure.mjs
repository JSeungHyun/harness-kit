#!/usr/bin/env node
// 그래프 검색 품질 측정 — 수치를 말하기 전에 잰다. 판정은 graph-hook 과 같다(대체·사무 기록 제외, 확신 = 정확일치 | 식별자 | 5점↑). 설계안.
//   node .harness/tools/graph-measure.mjs "<주제 정규식>"…  [--tickets <json>]   # 이슈 제목 → 확신·정본 1위·상위3 점유 (기본 ./tickets.json — [{title}] · [{subj}] · {tasks:[{subj}]})
//   node .harness/tools/graph-measure.mjs --self                                 # 살아있는 기록의 req 를 질의로 → 그 기록이 1위인가 (회귀)
import { readFileSync, existsSync } from 'node:fs';
import { load, scoreDetail, sup, tokenizeKo, tokenizeIds } from './graph-find.mjs';

const args = process.argv.slice(2);
const ti = args.indexOf('--tickets');
const ticketsPath = ti >= 0 ? args.splice(ti, 2)[1] : 'tickets.json';
const self = args.includes('--self');
const patterns = args.filter((a) => a !== '--self');

const all = load();
const dead = new Set(all.flatMap(sup));
const BOOK = /^TODO 갱신|^TODO:/;
const recs = all.filter((r) => !BOOK.test(r.req) && !dead.has(r.req));
const rank = (q) => {
  const ko = tokenizeKo(q), ids = tokenizeIds(q);
  const hits = recs.map((r) => ({ r, ...scoreDetail(r, [...ko, ...ids]) })).filter((x) => x.s > 0)
    .sort((a, b) => (b.exact > 0 ? 1 : 0) - (a.exact > 0 ? 1 : 0) || b.s - a.s || (b.r.date || '').localeCompare(a.r.date || ''));
  const top = hits[0];
  const confident = !!top && (top.exact >= 1 || (ids.length > 0 && scoreDetail(top.r, ids).s > 0) || top.s >= 5);
  return { top, confident };
};

if (self) {
  let ok = 0; const miss = [];
  for (const r of recs) { const { top } = rank(r.req); if (top && top.r === r) ok++; else miss.push(r.req.slice(0, 48)); }
  console.log(`req 자기검색 1위 ${ok}/${recs.length}${miss.length ? `\n  미적중: ${miss.join(' | ')}` : ''}`);
}
if (patterns.length) {
  if (!existsSync(ticketsPath)) { console.error(`티켓 파일 없음: ${ticketsPath}`); process.exit(1); }
  const d = JSON.parse(readFileSync(ticketsPath, 'utf8'));
  const list = Array.isArray(d) ? d : d.tasks;
  const subj = (Array.isArray(list) ? list : []).map((t) => t?.title || t?.subj || t?.subject || '').filter(Boolean);
  // 조용한 0 은 「측정했더니 효과 없음」으로 오독된다 — 하나도 못 읽었으면 실패로 알린다
  if (!subj.length) { console.error(`⛔ 티켓 형식을 못 읽었다: ${ticketsPath} — [{title}] · [{subj}] · {tasks:[{subj}]} 중 하나여야 한다`); process.exit(1); }
  for (const p of patterns) {
    const re = new RegExp(p);
    const qs = subj.filter((s) => re.test(s));
    let conf = 0, canon = 0; const tops = new Map(); const wins = new Map();
    for (const q of qs) {
      const { top, confident } = rank(q);
      if (!confident) continue;
      conf++;
      if (/^정본:/.test(top.r.req)) canon++;
      const k = top.r.req.slice(0, 28); tops.set(k, (tops.get(k) || 0) + 1);
      wins.set(top.r, (wins.get(top.r) || 0) + 1);
    }
    const topStr = [...tops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k}×${v}`).join(' , ');
    // 상위 3 점유 — 확신 질의 중 가장 자주 1위를 한 기록 3개가 1위인 비율. 훅을 켜는 조건은 < 50% (건수는 대리 지표다)
    const top3 = [...wins.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
    console.log(`/${p}/ 질의 ${qs.length} · 확신 ${conf} · 정본1위 ${canon} · 상위3 점유 ${conf ? `${Math.round((top3 / conf) * 100)}%` : '—'} · 확신 1위 상위: ${topStr}`);
  }
}
if (!self && !patterns.length) { console.error('사용법: node .harness/tools/graph-measure.mjs "<주제 정규식>"… | --self  [--tickets <json>]'); process.exit(1); }

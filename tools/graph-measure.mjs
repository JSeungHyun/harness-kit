#!/usr/bin/env node
// 그래프 검색 품질 측정 — 수치를 말하기 전에 잰다. 판정은 graph-hook 과 같다(대체·사무 기록 제외, 확신 = 정확일치 | 식별자 | 5점↑). 설계안.
//   node .harness/tools/graph-measure.mjs "<주제 정규식>"…  [--tickets <json>]   # 이슈 제목 → 확신·정본 1위·상위3 점유 (기본 ./tickets.json — [{title}] · [{subj}] · {tasks:[{subj}]})
//   node .harness/tools/graph-measure.mjs --self                                 # 살아있는 기록의 req 를 질의로 → 그 기록이 1위인가 (회귀)
//   node .harness/tools/graph-measure.mjs --baseline <도구 폴더> [--tickets <json>] [--guard self,share]
//     # 두 판 비교 — 같은 기록에 그 폴더의 graph-find · graph-hook 과 이 판을 돌려 지표를 나란히. --guard 지표가 기준선보다 나쁘면 exit 1 (기본 self)
//   --store <jsonl>: 기록 위치를 바꾼다(설치 사본 등) — 모든 모드
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as kit from './graph-find.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : dflt; };
const hasTickets = args.includes('--tickets');
const ticketsPath = opt('--tickets', 'tickets.json');
const store = resolve(opt('--store', kit.STORE));
const baseline = opt('--baseline');
const guard = opt('--guard', 'self').split(',');
const self = args.includes('--self');
const patterns = args.filter((a) => a !== '--self');

const all = kit.load(store);
const dead = new Set(all.flatMap(kit.sup));
const BOOK = /^TODO 갱신|^TODO:/;
const recs = all.filter((r) => !BOOK.test(r.req) && !dead.has(r.req));

// 판(graph-find 모듈)마다 같은 정렬 · 확신 판정 — 두 판 비교가 기준선 판의 채점으로 돈다
const ranker = (m) => (q) => {
  const ko = m.tokenizeKo(q), ids = m.tokenizeIds(q);
  const hits = recs.map((r) => ({ r, ...m.scoreDetail(r, [...ko, ...ids]) })).filter((x) => x.s > 0)
    .sort((a, b) => (b.exact > 0 ? 1 : 0) - (a.exact > 0 ? 1 : 0) || b.s - a.s || (b.r.date || '').localeCompare(a.r.date || ''));
  const top = hits[0];
  const confident = !!top && (top.exact >= 1 || (ids.length > 0 && m.scoreDetail(top.r, ids).s > 0) || top.s >= 5);
  return { top, confident };
};
const rank = ranker(kit);

function titles(path) {
  if (!existsSync(path)) { console.error(`티켓 파일 없음: ${path}`); process.exit(1); }
  const d = JSON.parse(readFileSync(path, 'utf8'));
  const list = Array.isArray(d) ? d : d.tasks;
  const subj = (Array.isArray(list) ? list : []).map((t) => t?.title || t?.subj || t?.subject || '').filter(Boolean);
  // 조용한 0 은 「측정했더니 효과 없음」으로 오독된다 — 하나도 못 읽었으면 실패로 알린다
  if (!subj.length) { console.error(`⛔ 티켓 형식을 못 읽었다: ${path} — [{title}] · [{subj}] · {tasks:[{subj}]} 중 하나여야 한다`); process.exit(1); }
  return subj;
}

// 훅은 판마다 출력이 지표다(단계 · 카드 · 크기) — 그 폴더의 graph-hook 을 실제로 돌린다. 기록은 --store 로 맞춘다(스스로 위치를 정하는 판은 그 위치가 같아야 한다)
const hookOut = (dir, prompt) => new Promise((done) => {
  const c = spawn(process.execPath, [join(dir, 'graph-hook.mjs')], { env: { ...process.env, HARNESS_GRAPH_STORE: store } });
  let out = '';
  c.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
  c.on('close', () => done(out));
  c.stdin.end(JSON.stringify({ prompt }));
});
async function each(items, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(availableParallelism(), items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

const METRICS = [
  // [키, 이름, 표시, 나은 방향]
  ['self', '자기검색 1위', (v) => `${v.self}/${recs.length}`, 1],
  ['conf', '확신 1단', (v) => `${v.conf}/${v.n}`, 1],
  ['silent', '침묵', (v) => `${v.silent}/${v.n}`, -1],
  ['avg', '주입 평균', (v) => `${v.avg}자`, -1],
  ['p90', '주입 p90', (v) => `${v.p90}자`, -1],
  ['share', '상위3 점유', (v) => `${v.share}%`, -1],
];
const CONFIDENT = /^\[그래프 자동조회\] 유사 기록/;
// 경로 표기만 다른 출력(.harness/tools/ ↔ tools/)은 같은 출력이다
const norm = (o) => o.replace(/node \S*?graph-(\w+)\.mjs/g, 'node graph-$1.mjs');

if (baseline) {
  const unknown = guard.filter((g) => !METRICS.some(([k]) => k === g));
  if (unknown.length) { console.error(`⛔ --guard 에는 ${METRICS.map(([k]) => k).join(' · ')} 만 준다: ${unknown.join(', ')}`); process.exit(1); }
  const tickets = hasTickets ? titles(ticketsPath) : [];
  const replay = [...tickets, ...all.map((r) => r.req)];
  const version = async (dir) => {
    const top = ranker(await import(pathToFileURL(join(dir, 'graph-find.mjs')).href));
    const outs = await each(replay, (q) => hookOut(dir, q));
    // 지표의 질의 묶음 — 티켓이 있으면 티켓, 없으면 기록 req
    const qs = tickets.length ? outs.slice(0, tickets.length) : outs;
    const sizes = qs.map((o) => o.length).sort((a, b) => a - b);
    const confident = qs.filter((x) => CONFIDENT.test(x));
    const wins = new Map();
    for (const o of confident) {
      const req = (o.match(/^· \[[^\]]*\] \S+ (.*)$/m) ?? [])[1];
      wins.set(req, (wins.get(req) || 0) + 1);
    }
    const conf = confident.length;
    const top3 = [...wins.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
    return {
      outs, n: qs.length, conf, silent: qs.filter((o) => !o.trim()).length,
      self: recs.filter((r) => top(r.req).top?.r === r).length,
      avg: qs.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / qs.length) : 0,
      p90: sizes[Math.max(0, Math.ceil(qs.length * 0.9) - 1)] ?? 0,
      share: conf ? Math.round((top3 / conf) * 100) : 0,
    };
  };
  const base = await version(resolve(baseline));
  const now = await version(fileURLToPath(new URL('.', import.meta.url)));
  const same = replay.filter((_, i) => norm(base.outs[i]) === norm(now.outs[i])).length;
  console.log(`두 판 비교 — 기록 ${store} (살아있는 ${recs.length}건) · 질의 묶음 ${tickets.length ? `티켓 ${tickets.length}` : `기록 req ${replay.length}`}\n`);
  console.log(`| 지표 | 기준선 (${baseline}) | 지금 |\n|---|---|---|`);
  for (const [k, name, show] of METRICS) console.log(`| ${name} (${k}) | ${show(base)} | ${show(now)} |`);
  console.log(`| 훅 출력 같음 | ${same}/${replay.length} (티켓 ${tickets.length} + 기록 req ${all.length}) | |`);
  const worse = METRICS.filter(([k, , , dir]) => guard.includes(k) && (now[k] - base[k]) * dir < 0);
  for (const [k, , show] of worse) console.log(`⛔ 기준선보다 나쁨 — ${k} ${show(base)} → ${show(now)}`);
  if (!worse.length) console.log(`\n✅ 지킨 지표(${guard.join(' · ')})가 기준선보다 나쁘지 않다`);
  process.exit(worse.length ? 1 : 0);
}

if (self) {
  let ok = 0; const miss = [];
  for (const r of recs) { const { top } = rank(r.req); if (top && top.r === r) ok++; else miss.push(r.req.slice(0, 48)); }
  console.log(`req 자기검색 1위 ${ok}/${recs.length}${miss.length ? `\n  미적중: ${miss.join(' | ')}` : ''}`);
}
if (patterns.length) {
  const subj = titles(ticketsPath);
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
if (!self && !patterns.length) { console.error('사용법: node .harness/tools/graph-measure.mjs "<주제 정규식>"… | --self | --baseline <도구 폴더>  [--tickets <json>] [--store <jsonl>] [--guard <지표,…>]'); process.exit(1); }

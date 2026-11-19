#!/usr/bin/env node
// 그래프 검색 품질 측정 — 수치를 말하기 전에 잰다. 판정은 graph-hook 과 같다(대체·사무 기록 제외, 확신 = 정확일치 | 식별자 | 5점↑). 설계안.
//   node .harness/tools/graph-measure.mjs "<주제 정규식>"…  [--tickets <json>]   # 이슈 제목 → 확신·정본 1위·상위3 점유 (기본 ./tickets.json — [{title}] · [{subj}] · {tasks:[{subj}]})
//   node .harness/tools/graph-measure.mjs --self                                 # 살아있는 기록의 req 를 질의로 → 그 기록이 1위인가 (회귀)
//   node .harness/tools/graph-measure.mjs --baseline <도구 폴더> [--tickets <json>] [--guard self,share]
//     # 두 판 비교 — 같은 기록에 그 폴더의 graph-find · graph-hook 과 이 판을 돌려 지표를 나란히. --guard 지표가 기준선보다 나쁘면 exit 1 (기본 self)
//   node .harness/tools/graph-measure.mjs --prompts <세션 기록 폴더|.jsonl> [--limit 300] [--baseline <도구 폴더>] [--guard inject]  # 두 판이면 종류마다 출력 같음 n/N
//     # 질문당 비용 — 프롬프트 훅을 부른 실입력 최근 N개를 그 판의 graph-hook 으로 재생해 종류별 주입 · 단계 · 훅 시간. inject: 주입 평균이 기준선보다 늘면 exit 1
//   node .harness/tools/graph-measure.mjs --gate <세션 기록 폴더|.jsonl> [--limit 300] [--baseline <도구 폴더>]
//     # 관문 훅 시간 — 사람 턴이 끝날 때마다 그때까지 잘린 기록으로 그 판의 gate-hook 을 실제로 띄워 기록 크기별 p50 · p90 · 되돌림. 두 판이면 판정 같음 n/N
//   --freeze <파일>(--prompts): 재생하지 않고 고른 입력 줄만 그 파일에 쓴다 — 그 파일을 다시 --prompts 에 주면 같은 입력이다(proof/bench.mjs 가 얼린다)
//   --dump <파일>(--prompts · --gate): 지금 판의 입력마다 [{ id, hash }](출력 해시)를 쓴다 — 차수를 건너 출력이 같은지 견준다
//   --store <jsonl>: 기록 위치를 바꾼다(설치 사본 등) — 모든 모드
//   --asof <YYYY-MM-DD>: 되감기 — recorded 가 그 날짜 전인 기록만 남긴 판으로 잰다(모든 모드 · 날짜를 바꿔 돌리면 성장 곡선). 제자리 수정은 되감지 못한다
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdtempSync, appendFileSync, symlinkSync, rmdirSync, unlinkSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as kit from './graph-find.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : dflt; };
const hasTickets = args.includes('--tickets');
const ticketsPath = opt('--tickets', 'tickets.json');
let store = resolve(opt('--store', kit.STORE));
const asof = opt('--asof');
const baseline = opt('--baseline');
const prompts = opt('--prompts');
const gate = opt('--gate');
const limit = Number(opt('--limit', 300));
const freeze = opt('--freeze');
const dump = opt('--dump');
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);
const guard = opt('--guard', prompts ? 'inject' : 'self').split(',');
const self = args.includes('--self');
const patterns = args.filter((a) => a !== '--self');

// 되감기 — recorded(없으면 date)가 그 날짜 전인 기록만 임시 파일에 두고 모든 모드가 그것을 읽는다. 대체 사슬은 남은 기록으로 다시 선다(뒤에 온 대체가 빠지면 옛 기록이 산다)
if (asof) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asof)) { console.error(`⛔ --asof 는 YYYY-MM-DD 다: ${asof}`); process.exit(1); }
  const full = kit.load(store), kept = full.filter((r) => (r.recorded || r.date || '') < asof);
  const undated = kept.filter((r) => !r.recorded).length;
  const dir = mkdtempSync(join(tmpdir(), 'graph-asof-'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  store = join(dir, 'requests.jsonl');
  writeFileSync(store, kept.map((r) => `${JSON.stringify(r)}\n`).join(''));
  console.log(`되감기 — recorded 가 ${asof} 전인 기록 ${kept.length}/${full.length}건 · ⚠️ 제자리 수정은 되감지 못함(그 뒤에 고쳐 쓴 줄은 지금 내용 그대로다)${undated ? ` · recorded 없는 ${undated}건은 date 로` : ''}`);
}
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
const pipe = (file, input) => new Promise((done) => {
  const c = spawn(process.execPath, [file], { env: { ...process.env, HARNESS_GRAPH_STORE: store } });
  let out = '';
  c.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
  c.on('close', () => done(out));
  c.stdin.end(JSON.stringify(input));
});
const hookOut = (dir, prompt) => pipe(join(dir, 'graph-hook.mjs'), { prompt });
const timed = async (run) => { const t = performance.now(); const out = await run(); return { out, ms: performance.now() - t }; };
const HERE = fileURLToPath(new URL('.', import.meta.url));
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
const pct = (sorted, q) => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? 0;
const jsonlFiles = (path) => { const st = statSync(path, { throwIfNoEntry: false }); return !st ? [] : st.isDirectory() ? readdirSync(path).filter((f) => f.endsWith('.jsonl')).map((f) => join(path, f)) : [path]; };

// 관문 훅이 「이번 턴의 시작」으로 보는 줄 — gate-hook 의 turn() 과 같은 판정. 턴 끝은 다음 사람 줄 바로 앞과 파일 끝이다
const HUMAN = (o) => o.type === 'user' && !o.isMeta && (o.origin ? o.origin.kind === 'human' : typeof o.message?.content === 'string');
function turnEnds(file) {
  const buf = readFileSync(file), ends = [];
  let open = null;
  for (let at = 0, next; at < buf.length; at = next) {
    const nl = buf.indexOf(10, at);
    next = nl < 0 ? buf.length : nl + 1;
    const line = buf.toString('utf8', at, next);
    if (!line.includes('"type":"user"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!HUMAN(o)) continue;
    if (open !== null) ends.push({ file, size: at, ts: open });
    open = o.timestamp ?? '';
  }
  if (open !== null) ends.push({ file, size: buf.length, ts: open });
  return ends;
}

if (gate) {
  const files = jsonlFiles(resolve(gate));
  const ends = files.flatMap(turnEnds).sort((a, b) => a.ts.localeCompare(b.ts));
  if (!ends.length) { console.error(`⛔ 사람 턴을 하나도 못 찾았다: ${gate} — Claude Code 세션 기록(.jsonl 또는 그 폴더)이어야 한다`); process.exit(1); }
  const picked = ends.length <= limit ? ends : Array.from({ length: limit }, (_, i) => ends[Math.floor((i * ends.length) / limit)]);
  const dirs = [...(baseline ? [resolve(baseline)] : []), HERE];
  const work = mkdtempSync(join(tmpdir(), 'gate-measure-'));
  process.on('exit', () => rmSync(work, { recursive: true, force: true }));
  const stop = (dir, transcript_path) => timed(() => pipe(join(dir, 'gate-hook.mjs'), { transcript_path, stop_hook_active: false, background_tasks: [] }));
  let warm = false;
  for (const file of new Set(picked.map((e) => e.file))) {
    const buf = readFileSync(file), copy = join(work, basename(file));
    // 서브에이전트의 파일 변경은 <기록 이름>/subagents/ 에서 읽힌다 — 원본 폴더를 잇고, 지울 때는 이음만 뗀다(rmdir 는 안을 지우지 않는다)
    const side = file.replace(/\.jsonl$/, ''), link = copy.replace(/\.jsonl$/, '');
    if (existsSync(side)) symlinkSync(side, link, 'junction');
    let written = 0;
    for (const [i, e] of picked.filter((x) => x.file === file).entries()) {
      appendFileSync(copy, buf.subarray(written, e.size));
      written = e.size;
      // 예열 1회는 버리고 두 판을 턴마다 번갈아 잰다(--prompts 와 같다)
      if (!warm) { for (const d of dirs) await stop(d, copy); warm = true; }
      e.runs = [];
      for (const k of i % 2 ? [...dirs.keys()].reverse() : dirs.keys()) e.runs[k] = await stop(dirs[k], copy);
    }
    if (existsSync(side)) { try { rmdirSync(link); } catch { unlinkSync(link); } }
    rmSync(copy, { force: true });
  }
  if (dump) writeFileSync(dump, JSON.stringify(picked.map((e) => ({ id: `${basename(e.file)}@${e.size}`, hash: sha(e.runs.at(-1).out) }))));
  const MB = 1 << 20;
  const blocked = (r) => r.out.includes('"decision":"block"');
  const cell = (rows, f) => dirs.map((_, k) => f(rows.map((e) => e.runs[k]))).join(' → ');
  const ms = (q) => (runs) => `${Math.round(pct(runs.map((r) => r.ms).sort((a, b) => a - b), q))}ms`;
  console.log(`관문 훅 재생 — 세션 기록 ${gate} (파일 ${files.length} · 턴 끝 ${ends.length}) · 고르게 ${picked.length}개${baseline ? ` · 칸은 기준선(${baseline}) → 지금` : ''}`);
  console.log('되돌림은 지금 설치 상태(harness.json · 기록 파일 시각)로 다시 낸 판정이다 — 그때의 판정이 아니다\n');
  console.log(`| 기록 크기 | 턴 끝 | 훅 p50 | 훅 p90 | 되돌림 |${baseline ? ' 판정 같음 |' : ''}\n|${'---|'.repeat(baseline ? 6 : 5)}`);
  for (const [name, lo, hi] of [['<1MB', 0, 1], ['1~4MB', 1, 4], ['4~8MB', 4, 8], ['8~32MB', 8, 32], ['32MB~', 32, Infinity], ['전체', 0, Infinity]]) {
    const rows = picked.filter((e) => e.size >= lo * MB && e.size < hi * MB);
    if (!rows.length) continue;
    const same = baseline ? ` ${rows.filter((e) => e.runs[0].out === e.runs[1].out).length}/${rows.length} |` : '';
    console.log(`| ${name} | ${rows.length} | ${cell(rows, ms(0.5))} | ${cell(rows, ms(0.9))} | ${cell(rows, (runs) => runs.filter(blocked).length)} |${same}`);
  }
  process.exit(0);
}

// 프롬프트 훅을 부른 입력 — 사람 줄 · 대기 입력(queued_command). 도구 결과 · 압축 요약 · 메타 · 셸 줄은 훅을 부르지 않는다
// 세션 메시지는 기록에만 앞머리 · 뒤 안내문이 붙는다 — 훅은 감쌈 하나만 받는다(원천 실측: 기록이 안 바뀐 구간에서 훅 출력 전문 일치)
const PEER = /^Another Claude session sent a message:\n(<([\w-]+)[\s\S]*?<\/\2>)/;
const COMMAND = /^<command-(name|message)>/;
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '');
function opening(o) {
  let origin, prompt, unsure = false;
  if (o.type === 'attachment' && o.attachment?.type === 'queued_command') { origin = o.attachment.origin; prompt = textOf(o.attachment.prompt); } else {
    const c = o.message?.content;
    if (o.type !== 'user' || o.isSidechain || o.isCompactSummary || (Array.isArray(c) && c.some((b) => b.type === 'tool_result'))) return null;
    origin = o.origin; prompt = textOf(c);
    if (!origin && !o.promptSource && !COMMAND.test(prompt)) return null;
    if (origin?.kind === 'peer') { const m = prompt.match(PEER); unsure = !m; if (m) prompt = m[1]; }
  }
  const kind = COMMAND.test(prompt) ? '명령' : origin?.kind === 'peer' ? '세션 메시지'
    : origin?.kind === 'task-notification' || /^<task-notification>/.test(prompt) ? '알림' : origin?.kind === 'human' ? '사람' : '기타';
  return { ts: o.timestamp ?? '', origin, prompt, kind, unsure: unsure || kind === '기타' };
}
// 주입 글의 토큰/글자 — 추정: 그래프 원천 · 다른 설치 세션 기록에서 턴이 열릴 때의 입력 증가분을 사람 글 · 주입 글자에 최소제곱(162턴 · R² 0.996 · 사분위 0.81~0.87). 한글 비중이 다르면 달라진다
const TOKENS_PER_CHAR = 0.83;
function sessionInputs(path) {
  const files = jsonlFiles(path);
  const inputs = [];
  const sessions = [];
  let skipped = 0;
  for (const f of files) {
    // 파일 순서 그대로 — 입력 · 되돌림(압축 · /clear) · API 호출(message.id 하나에 입력 합 하나 · 사이드체인 제외)
    const events = [];
    const seen = new Set();
    const got = readFileSync(f, 'utf8').split('\n').flatMap((l) => {
      let o;
      try { o = JSON.parse(l); } catch { return []; }
      if (!o) return [];
      if (!o.isSidechain && ((o.type === 'system' && o.subtype === 'compact_boundary') || o.isCompactSummary)) events.push({ reset: true });
      const u = o.type === 'assistant' && !o.isSidechain && o.message?.model !== '<synthetic>' && o.message?.usage;
      const total = u ? (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) : 0;
      if (total && !seen.has(o.message.id)) { seen.add(o.message.id); events.push({ total }); }
      const p = opening(o);
      if (!p) return [];
      if (p.prompt.includes('<command-name>/clear</command-name>')) events.push({ reset: true });
      events.push({ input: p });
      p.raw = l;
      return [p];
    });
    // -p 한 건짜리 세션은 사람과의 대화가 아니다
    if (got.length === 1 && !got[0].origin) skipped++;
    else { inputs.push(...got); sessions.push(events); }
  }
  return { files: files.length, skipped, sessions, inputs: inputs.sort((a, b) => a.ts.localeCompare(b.ts)) };
}

if (prompts) {
  if (guard.some((g) => g !== 'inject')) { console.error(`⛔ --prompts 의 --guard 는 inject 만 받는다: ${guard.join(', ')}`); process.exit(1); }
  const { files, skipped, sessions, inputs } = sessionInputs(resolve(prompts));
  const picked = inputs.slice(-limit);
  if (!picked.length) { console.error(`⛔ 턴을 연 입력을 하나도 못 찾았다: ${prompts} — Claude Code 세션 기록(.jsonl 또는 그 폴더)이어야 한다`); process.exit(1); }
  const dirs = [...(baseline ? [resolve(baseline)] : []), HERE];
  if (freeze) { writeFileSync(freeze, picked.map((p) => `${p.raw.trimEnd()}\n`).join('')); console.log(`얼림 — 턴을 연 입력 ${inputs.length} 중 최근 ${picked.length}개 → ${freeze}`); process.exit(0); }
  // 시간은 PC 부하로 흔들린다 — 예열 1회는 버리고(첫 읽기가 수십 배 느리다) 두 판을 입력마다 번갈아 같은 조건에서 잰다
  for (const d of dirs) await hookOut(d, picked[0].prompt);
  const runs = dirs.map(() => []);
  for (const [i, p] of picked.entries()) for (const k of i % 2 ? [...dirs.keys()].reverse() : dirs.keys()) runs[k][i] = await timed(() => hookOut(dirs[k], p.prompt));

  if (dump) writeFileSync(dump, JSON.stringify(picked.map((p, i) => ({ id: sha(p.ts + p.prompt), hash: sha(norm(runs.at(-1)[i].out)) }))));
  const COLS = [['inj', '주입률', '%'], ['conf', '1단', '%'], ['silent', '침묵', '%'], ['avg', '주입 평균', '자'], ['p90', '주입 p90', '자'], ['t50', '훅 p50', 'ms'], ['t90', '훅 p90', 'ms']];
  const GROUPS = [['사람', (p) => p.kind === '사람'], ['사람 · 짧은 말(≤20자)', (p) => p.kind === '사람' && p.prompt.length <= 20],
    ['사람 · 긴 글(>500자)', (p) => p.kind === '사람' && p.prompt.length > 500], ...['세션 메시지', '알림', '명령', '기타'].map((k) => [k, (p) => p.kind === k]), ['전체', () => true]];
  // 주입 글자 · 비율은 입력당(침묵은 0자) — 질문 한 번의 비용
  const sum = (rows) => {
    const rate = (f) => Math.round((rows.filter(f).length / rows.length) * 100);
    const sizes = rows.map((r) => r.out.length).sort((a, b) => a - b), ms = rows.map((r) => r.ms).sort((a, b) => a - b);
    return { inj: rate((r) => r.out.trim()), conf: rate((r) => CONFIDENT.test(r.out)), silent: rate((r) => !r.out.trim()), avg: Math.round(sizes.reduce((a, b) => a + b, 0) / rows.length),
      p90: pct(sizes, 0.9), t50: Math.round(pct(ms, 0.5)), t90: Math.round(pct(ms, 0.9)) };
  };
  console.log(`실입력 재생 — 세션 기록 ${prompts} (파일 ${files} · 턴을 연 입력 ${inputs.length} · 뺀 -p 세션 ${skipped}) · 최근 ${picked.length}개 · 기록 ${store} (살아있는 ${recs.length}건)${baseline ? ` · 칸은 기준선(${baseline}) → 지금` : ''}\n`);
  // 두 판이면 종류마다 출력이 같은 입력 수 — 한 종류만 바꾸려는 변경이 다른 종류를 건드렸는지 본다
  const same = (at) => (baseline ? [`${at.filter((i) => norm(runs[0][i].out) === norm(runs[1][i].out)).length}/${at.length}`] : []);
  console.log(`| 종류 | 입력 | ${[...COLS.map(([, h]) => h), ...(baseline ? ['출력 같음'] : [])].join(' | ')} |\n|${'---|'.repeat(COLS.length + 2 + (baseline ? 1 : 0))}`);
  let total;
  for (const [name, f] of GROUPS) {
    const at = picked.flatMap((p, i) => (f(p) ? [i] : []));
    if (!at.length) continue;
    total = runs.map((r) => sum(at.map((i) => r[i])));
    console.log(`| ${name} | ${at.length} | ${[...COLS.map(([k, , u]) => total.map((x) => `${x[k]}${u}`).join(' → ')), ...same(at)].join(' | ')} |`);
  }
  // 세션 누적 주입 — 훅이 넣은 글은 그 질문에서 끝나지 않고 압축 · /clear 까지 문맥에 남아 뒤 호출마다 입력으로 다시 들어간다
  const slot = new Map(picked.map((p, i) => [p, i]));
  const carried = runs.map((run) => {
    const per = [];
    let kept = 0, input = 0, max = 0;
    for (const events of sessions) {
      // whole — 되돌림 뒤 입력이 모두 창 안. 창 밖 입력이 끼면 덜 쌓인 값이라 다음 되돌림까지 세지 않는다
      let live = 0, whole = true;
      for (const e of events) {
        if (e.reset) { live = 0; whole = true; }
        else if (e.input) { if (slot.has(e.input)) live += run[slot.get(e.input)].out.length; else whole = false; }
        else if (whole) { kept += live; input += e.total; max = Math.max(max, live); per.push(((live * TOKENS_PER_CHAR) / e.total) * 100); }
      }
    }
    return { n: per.length, share: input ? ((kept * TOKENS_PER_CHAR) / input) * 100 : 0, p90: pct(per.sort((a, b) => a - b), 0.9), max };
  });
  const last = carried.at(-1);
  console.log(last.n
    ? `\n세션 누적 주입 — 입력 토큰의 ${carried.map((c) => `${c.share.toFixed(1)}%`).join(' → ')} (추정 · 주입 글 ${TOKENS_PER_CHAR} 토큰/자) · API 호출 ${last.n} · 호출별 p90 ${last.p90.toFixed(1)}% · 문맥에 남은 주입 최대 ${last.max}자 — 압축 · /clear 까지 쌓인 주입 ÷ 호출마다의 입력 합(input + cache_creation + cache_read)`
    : '\n세션 누적 주입 — 잴 API 호출 0 (최근 창 안에 usage 가 있는 assistant 줄이 없다)');
  console.log(`\n재생 불일치 가능 ${picked.filter((p) => p.unsure).length}건 — 감쌈을 못 벗긴 세션 메시지 · 기타(훅이 받은 글과 같은지 확인 못 한 모양)`);
  if (!baseline) process.exit(0);
  const [base, now] = total;
  if (now.avg > base.avg) { console.log(`⛔ 기준선보다 나쁨 — inject ${base.avg}자 → ${now.avg}자`); process.exit(1); }
  console.log('\n✅ 주입 평균(inject)이 기준선보다 늘지 않았다');
  process.exit(0);
}

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
      p90: pct(sizes, 0.9),
      share: conf ? Math.round((top3 / conf) * 100) : 0,
    };
  };
  const base = await version(resolve(baseline));
  const now = await version(HERE);
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
if (!self && !patterns.length) { console.error('사용법: node .harness/tools/graph-measure.mjs "<주제 정규식>"… | --self | --baseline <도구 폴더> | --prompts <세션 기록> [--limit N] | --gate <세션 기록> [--limit N]  [--tickets <json>] [--store <jsonl>] [--asof <YYYY-MM-DD>] [--guard <지표,…>]'); process.exit(1); }

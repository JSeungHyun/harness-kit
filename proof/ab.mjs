#!/usr/bin/env node
// 효과 A/B 틀 — 같은 질문을 팔마다(둘 이상 · 사본) `claude -p` 로 돌려 기준 팔과 질문 단위 짝으로 견준다. 설계안.
// 질문 집합 · 사본 · 팔 정의는 계획 파일(JSON)로 받는다 — 형식은 docs/proof.md 「발표 측정」 절.
//   node proof/ab.mjs prereg <계획.json>                          사전 등록 — 지문을 남긴다(본 실행 전)
//   node proof/ab.mjs run <계획.json> --claude <실행 파일> [--pilot]  ⛔ 토큰을 쓴다 — 사람 승인 뒤에만
//     [--reps N]  미리 적은 연장 규칙(「차 2~3 이면 연장」)일 때만 — 등록 반복보다 큰 N · 앞 회차는 그대로 두고 새 회차만 돈다
//   node proof/ab.mjs agg <계획.json>                             집계 · 판정 — 숫자 · id 만
//   node proof/ab.mjs recompute <표.md> [--plan <계획.json>]        질문별 표에서 짝 비율 · 판정을 다시 낸다
// 사전 등록 지문이 어긋나거나, 다시 돌려도 오염 · 무효가 남으면 exit 1.

import { spawn, execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cli } from '../lib/config.mjs';
import { graphOf } from '../lib/parts.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
const TASK = `# 이번 과제
사용자 메시지는 이 저장소에 들어온 요청이다. 이 요청을 처리하려면 어느 파일을 고쳐야 하는지 찾아, 파일 목록과 각 파일을 고쳐야 하는 이유를 답하라.
- 파일을 수정하거나 만들지 않는다. 빌드 · 실행도 하지 않는다.
- 답의 맨 끝에 \`FILES:\` 한 줄을 쓰고, 그 아래에 고칠 파일의 저장소 상대 경로를 한 줄에 하나씩 적는다.
- 이 과제에서는 되물을 수 없다. 고칠 곳이 확정되지 않으면 가장 가능성이 높은 파일을 적고 이유에 불확실하다고 쓴다. FILES 아래를 비우지 않는다.
`;

// ── 짝 통계 ─────────────────────────────────────────────────────────
export function median(xs) {
  const s = xs.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
}

// 정확 Wilcoxon 부호 순위(양측) — 표본이 작아 정규 근사를 쓰지 않는다. 0 차는 빼고 동순위는 평균 순위
export function wilcoxon(diffs) {
  const d = diffs.filter((x) => x !== 0 && x != null);
  const n = d.length;
  if (!n) return { n, p: null };
  const order = d.map((x, i) => [Math.abs(x), i]).sort((a, b) => a[0] - b[0]);
  const rank = new Array(n);
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) rank[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  const wPlus = d.reduce((a, x, i) => a + (x > 0 ? rank[i] : 0), 0);
  const mean = (n * (n + 1)) / 4;
  // 부분합 개수 DP(순위 ×2 = 정수) — 전수 열거는 n > 30 에서 넘친다
  let ways = [1];
  for (const r of rank.map((x) => Math.round(x * 2))) {
    const next = ways.concat(new Array(r).fill(0));
    for (let s = 0; s < ways.length; s++) next[s + r] += ways[s];
    ways = next;
  }
  let extreme = 0;
  ways.forEach((c, s) => { if (c && Math.abs(s / 2 - mean) >= Math.abs(wPlus - mean) - 1e-9) extreme += c; });
  return { n, wPlus, p: extreme / 2 ** n };
}

// ── 실행 한 번(stream-json) → 지표 ───────────────────────────────────
const events = (raw) => String(raw || '').split(/\r?\n/).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });

function filesOf(text) {
  const at = String(text || '').lastIndexOf('FILES:');
  if (at < 0) return [];
  const out = [];
  for (const l of text.slice(at + 'FILES:'.length).split(/\r?\n/)) {
    const m = l.replace(/[`*]/g, '').match(/[A-Za-z0-9_.\-\\/:]+\.[A-Za-z0-9]+/);
    if (m) out.push(m[0].replace(/:\d+(-\d+)?$/, ''));
  }
  return [...new Set(out)];
}

export function parseRun(raw) {
  const evs = events(raw);
  // 백그라운드 작업 알림이 답 뒤에 후속 턴을 깨우면 result 가 여럿이다 — usage · duration_ms · num_turns 는 구간 값이라 합치고, total_cost_usd 만 누적이라 마지막 것
  const all = evs.filter((e) => e.type === 'result');
  const res = all.at(-1);
  const init = evs.find((e) => e.type === 'system' && e.subtype === 'init');
  const add = (k) => all.reduce((a, r) => a + (r.usage?.[k] || 0), 0);
  const t = { input: add('input_tokens'), cacheCreate: add('cache_creation_input_tokens'), cacheRead: add('cache_read_input_tokens'), output: add('output_tokens') };
  t.total = t.input + t.cacheCreate + t.cacheRead + t.output;
  t.fresh = t.total - t.cacheRead;
  // Stop 한 번에 돈 훅 수 — 훅 이벤트가 아닌 줄이 끼면 다음 Stop 이다
  let streak = 0, stopBatch = 0;
  for (const e of evs) {
    if (e.type !== 'system' || !/^hook_/.test(e.subtype || '')) streak = 0;
    else if (e.subtype === 'hook_started' && e.hook_event === 'Stop') stopBatch = Math.max(stopBatch, ++streak);
  }
  const tools = new Set(evs.filter((e) => e.type === 'assistant' && !e.parent_tool_use_id).flatMap((e) => (e.message?.content || []).filter((c) => c.type === 'tool_use').map((c) => c.id)));
  return {
    // 최대 턴에 닿은 실행도 실제 결과다 — 무효는 결과 줄이 없거나 실행 오류인 것만
    valid: !!res && ['success', 'error_max_turns'].includes(res.subtype),
    subtype: res?.subtype ?? null,
    tokens: t,
    ms: res ? all.reduce((a, r) => a + (r.duration_ms || 0), 0) : null,
    cost: res?.total_cost_usd ?? 0,
    turns: res ? all.reduce((a, r) => a + (r.num_turns || 0), 0) : null,
    results: all.length,
    toolCalls: tools.size,
    files: filesOf(all.findLast((r) => (r.result || '').includes('FILES:'))?.result ?? res?.result),
    hookEvents: [...new Set(evs.filter((e) => e.type === 'system' && /^hook_/.test(e.subtype || '') && e.hook_event).map((e) => e.hook_event))],
    answer: res?.result ?? '',
    denials: all.reduce((a, r) => a + (r.permission_denials?.length || 0), 0),
    // 관문 되돌림 줄 — Stop 훅 응답의 출력에서만 본다(도구 결과에는 훅 소스가 실릴 수 있다)
    gateBlocks: evs.filter((e) => e.type === 'system' && e.subtype === 'hook_response' && e.hook_event === 'Stop' && `${e.stdout ?? ''}${e.output ?? ''}`.includes('[관문]')).length,
    stopBatch,
    init: init ? { session: init.session_id ?? null, memory: init.memory_paths ?? null, mcp: init.mcp_servers || [] } : null,
  };
}

// 경로는 / · 소문자 · 경로 경계 접미 일치 — 절대 · 저장소 상대 · 파일명만 모두 같은 파일로 본다
function hit(files, gold) {
  const norm = (p) => String(p).replace(/\\/g, '/').toLowerCase().replace(/^\.\//, '').replace(/\/+$/, '');
  const fs = files.map(norm);
  return gold.map(norm).some((g) => fs.some((f) => f === g || f.endsWith(`/${g}`) || g.endsWith(`/${f}`)));
}

// ── 오염 검사 — 어긴 항목 이름 목록(빈 배열 = 깨끗). 보는 것은 모델이 낸 도구 입력과 init ──
// JSON 안의 역슬래시는 두 겹이다 — 슬래시로 바꾼 뒤 겹친 것을 하나로
const slash = (s) => String(s).replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase();
// C:/x 와 /c/x 를 같은 경로로. 뒤에 이름이 이어지면(x-copy) 다른 폴더다
function mentions(text, path) {
  const d = slash(path).replace(/\/+$/, '').replace(/^([a-z]):/, '/$1').replace(/[.*+?^${}()|[\]]/g, '\\$&').replace(/^\/([a-z])(?=\/)/, '(?:/$1|$1:)');
  return new RegExp(`${d}(?![\\w-])`).test(text);
}
// 세션 기록 폴더 이름 — 사본 경로의 영숫자 아닌 글자를 - 로
const slug = (p) => String(p).replace(/[^A-Za-z0-9]/g, '-');
const GRAPH = /graph-(find|hook|append|alias|measure|view|read-hook)|requests\.jsonl|\.harness\/graph/;

export function checkRun(parsed, raw, arm, paths) {
  const inputs = events(raw).filter((e) => e.type === 'assistant')
    .flatMap((e) => (e.message?.content || []).filter((c) => c.type === 'tool_use').map((c) => slash(JSON.stringify(c.input))));
  const any = (f) => inputs.some(f);
  const bad = [];
  if (!arm.graph && any((t) => GRAPH.test(t))) bad.push('그래프 도구');
  if (paths.source && any((t) => mentions(t, paths.source))) bad.push('실제 저장소');
  // 넘친 도구 출력은 그 실행 자신의 세션 폴더(<사본 경로 이름>/<session_id>/)에 저장된다 — 거기만 다시 읽은 것은 오염이 아니다
  const own = parsed.init?.session ? `${slug(paths.self)}/${parsed.init.session}/`.toLowerCase() : null;
  const refs = inputs.flatMap((t) => [...t.matchAll(/\.claude\/projects\/?([^\s"'`|;<>)]*)/g)].map((m) => m[1]));
  if (refs.some((r) => !own || !r.startsWith(own))) bad.push('세션 기록');
  if (any((t) => paths.others.some((p) => mentions(t, p)))) bad.push('다른 팔');
  if (any((t) => paths.scratch.some((p) => mentions(t, p)))) bad.push('측정 자료');
  if ((parsed.hookEvents || []).includes('UserPromptSubmit') !== !!arm.graph) bad.push('훅 이벤트');
  if (parsed.init?.memory) bad.push('메모리');
  if (parsed.init?.mcp?.length) bad.push('MCP');
  return bad;
}

// 관문 훅 — 끈 팔(gate: false)에 되돌림 줄이 있으면 오염, 켠 팔(gate: true)에 실행 흔적이 없으면 무효. gate 를 안 적은 팔은 보지 않는다
// 흔적 = 되돌림 줄, 또는 Stop 한 번에 돈 훅 수가 같은 쌍의 끈 팔보다 많다 — 조용히 통과한 관문 훅은 출력이 없고 Stop 이벤트는 전역 플러그인도 낸다
export function gateCheck(runs) {
  const off = Math.max(0, ...runs.filter((r) => r.gate === false).map((r) => r.stopBatch));
  return runs.map((r) => (r.gate === false ? (r.gateBlocks ? ['관문 훅'] : []) : r.gate === true && !r.gateBlocks && !(r.stopBatch > off) ? ['관문 훅 흔적 없음'] : []));
}

// 세션 기록을 남긴 실행(sessionPersistence) — 관문 훅이 읽은 뒤 그 실행 것만 지운다. 못 찾으면 false
function dropSession(copy, sid) {
  if (!/^[\w-]+$/.test(sid ?? '')) return false;
  const dir = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects', slug(copy));
  const had = existsSync(join(dir, `${sid}.jsonl`));
  rmSync(join(dir, `${sid}.jsonl`), { force: true });
  rmSync(join(dir, sid), { recursive: true, force: true });
  try { rmdirSync(dir); } catch { /* 다른 기록이 남아 있다 */ }
  return had;
}

// ── 계획 · 사전 등록 지문 ────────────────────────────────────────────
const sha = (x) => createHash('sha256').update(x).digest('hex').slice(0, 16);
const real = (d) => realpathSync.native(d).replace(/\\/g, '/');

// Claude Code 는 자기 임시 폴더(<임시>/claude…) 안에서 프로젝트 CLAUDE.md · 규칙을 싣지 않는다(23차 실측) — 그 안 사본은 지침 없는 팔이 된다
export function inClaudeTemp(dir, tmp = real(tmpdir())) {
  const n = (x) => x.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return n(dir).startsWith(`${n(tmp)}/claude`);
}

function storeOf(dir) {
  let raw = {};
  try { raw = JSON.parse(readFileSync(join(dir, '.harness/harness.json'), 'utf8')); } catch { /* 설정 없음 — 기본 위치 */ }
  return join(dir, graphOf(raw).store);
}
// 실행 전후로 같아야 하는 것 — HEAD · 추적 파일 변경 · 기록 파일. full(사본을 바꾸는 과제가 있는 계획)이면 미추적 · 무시 파일까지
function copyState(dir, full) {
  // git 한 번으로 — 「# branch.oid <HEAD>」 줄 + 바뀐 추적 파일 줄
  const out = execFileSync('git', ['-C', dir, 'status', '--porcelain=v2', '--branch', ...(full ? ['--untracked-files=all', '--ignored'] : ['--untracked-files=no'])], { encoding: 'utf8' }).split('\n');
  const store = storeOf(dir);
  return { head: out.find((l) => l.startsWith('# branch.oid '))?.slice(13) ?? null, status: out.filter((l) => l && !l.startsWith('#')).join('\n'), store: existsSync(store) ? sha(readFileSync(store)) : null };
}

const sameState = (a, b) => a.head === b.head && a.status === b.status && a.store === b.store;
// 미추적(?) · 무시(!) 줄을 뺀 추적 파일 변경만
const tracked = (s) => ({ ...s, status: s.status.split('\n').filter((l) => !/^[?!] /.test(l)).join('\n') });
// 사본 초기화 — 추적 파일 · (full) 미추적 파일 · 기록 파일
function restore(dir, b, full) {
  execFileSync('git', ['-C', dir, 'checkout', '-f', '-q', b.head]);
  if (full) execFileSync('git', ['-C', dir, 'clean', '-fdxq']);
  if (b.bytes) writeFileSync(storeOf(dir), b.bytes);
}

const DENY = ['Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task'];
// 묶음별 값(sets.<묶음>) → 계획 값 → 기본값
const opt = (plan, q, k, d) => plan.sets?.[q.set]?.[k] ?? plan[k] ?? d;

function loadPlan(file) {
  const home = dirname(resolve(file));
  const raw = readFileSync(file, 'utf8');
  const p = JSON.parse(raw);
  const abs = (x) => (isAbsolute(x) ? x : join(home, x));
  if (!(p.arms?.length >= 2) || new Set(p.arms.map((a) => a.name)).size !== p.arms.length) throw new Error('팔은 둘 이상이고 이름이 겹치지 않는다 — 두 팔이면 arms[0] 이 처치, arms[1] 이 대조');
  const baseline = p.baseline ?? (p.arms.length === 2 ? p.arms[1].name : null);
  if (!p.arms.some((a) => a.name === baseline)) throw new Error('팔이 셋 이상이면 기준 팔 이름을 baseline 에 적는다');
  if (!(p.cap > 0)) throw new Error('비용 상한 cap($)을 적는다');
  mkdirSync(abs(p.work), { recursive: true });
  const work = real(abs(p.work));
  const questionsFile = abs(p.questions);
  const questions = JSON.parse(readFileSync(questionsFile, 'utf8'));
  if (questions.some((q) => opt(p, q, 'mutates') && !opt(p, q, 'score'))) throw new Error('사본을 바꾸는 과제(mutates)에는 채점 명령 score 를 적는다');
  // 채점 명령이나 사람 채점이 있는 질문은 정답 파일이 없어도 된다
  if (new Set(questions.map((q) => q.id)).size !== questions.length || questions.some((q) => !q.q || !q.set || (!q.gold?.length && q.grade !== 'manual' && !opt(p, q, 'score')))) throw new Error('질문마다 겹치지 않는 id · set · q · gold(정답 파일)가 있어야 한다');
  // 채점 명령의 node 는 이 틀의 node 로, 계획 옆 파일은 절대 경로로
  const scoreOf = (s) => s && [s[0] === 'node' ? process.execPath : s[0], ...s.slice(1).map((x) => (existsSync(abs(x)) ? abs(x) : x))];
  const sets = Object.fromEntries(Object.entries(p.sets ?? {}).map(([k, v]) => [k, { ...v, ...(v.score ? { score: scoreOf(v.score) } : {}) }]));
  const scorers = [...new Set([p.score, ...Object.values(p.sets ?? {}).map((v) => v.score)].flatMap((s) => scoreOf(s)?.slice(1) ?? []).filter((x) => existsSync(x)))];
  const full = [p, ...Object.values(p.sets ?? {})].some((x) => x.mutates);
  const common = p.common ? readFileSync(abs(p.common), 'utf8') : '';
  const task = p.task ? readFileSync(abs(p.task), 'utf8') : TASK;
  const arms = p.arms.map((a) => {
    // kit:graph = 키트가 설치에 심는 규칙(templates/rules/graph.md) 그대로
    const rules = (a.rules ?? []).map((r) => readFileSync(r.startsWith('kit:') ? join(KIT, 'templates/rules', `${r.slice(4)}.md`) : abs(r), 'utf8'));
    const copies = a.copies.map((c) => real(abs(c)));
    if (copies.some((c) => `${c}/`.startsWith(`${work}/`))) throw new Error('사본을 작업 폴더(work) 안에 두지 않는다 — 작업 폴더를 읽으면 오염이다');
    if (copies.some((c) => inClaudeTemp(c))) throw new Error('사본을 Claude 임시 폴더(<임시>/claude…) 밖에 둔다 — 그 안에서는 프로젝트 CLAUDE.md · 규칙이 안 실린다');
    return { name: a.name, graph: !!a.graph, gate: a.gate ?? null, copies, settings: a.settings ? abs(a.settings) : null, prompt: [common, ...rules, task].filter(Boolean).join('\n\n') };
  });
  if (arms.some((a) => a.copies.length !== arms[0].copies.length)) throw new Error('팔마다 사본 수가 같아야 한다');
  const parts = {
    plan: sha(raw),
    questions: sha(readFileSync(questionsFile)),
    prompts: sha(arms.map((a) => a.prompt).join('\0')),
    settings: sha(arms.map((a) => (a.settings ? readFileSync(a.settings, 'utf8') : '')).join('\0')),
    copies: sha(JSON.stringify(arms.map((a) => a.copies.map((c) => copyState(c, full))))),
    ...(scorers.length ? { score: sha(scorers.map((f) => readFileSync(f, 'utf8')).join('\0')) } : {}),
  };
  return { ...p, work, questions, arms, baseline, sets, score: scoreOf(p.score), full, parts, fingerprint: sha(JSON.stringify(parts)), source: p.source ? abs(p.source) : null,
    scratch: [work, questionsFile, ...scorers, ...(p.scratch ?? []).map(abs)], reps: p.reps ?? 2, seed: p.seed ?? 1, model: p.model ?? 'sonnet', maxTurns: p.maxTurns ?? 60 };
}

const readLog = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const mainLog = (plan) => join(plan.work, 'log.jsonl');
// 본 실행 + 파일럿 비용 합 — 상한은 둘을 합쳐 본다
const spent = (plan) => [mainLog(plan), join(plan.work, 'pilot-log.jsonl')].flatMap(readLog).reduce((a, r) => a + (r.cost || 0), 0);

// 사전 등록 뒤 질문 · 지침 · 판정 기준 · 사본이 바뀌었으면 멈춘다
function guard(plan) {
  const file = join(plan.work, 'prereg.json');
  if (!existsSync(file)) throw new Error(`사전 등록이 없다 — 먼저 node proof/ab.mjs prereg <계획.json>`);
  const reg = JSON.parse(readFileSync(file, 'utf8'));
  const changed = Object.keys(plan.parts).filter((k) => plan.parts[k] !== reg.parts[k]);
  if (changed.length) throw new Error(`사전 등록 지문이 어긋난다 — 등록 ${reg.fingerprint}(${reg.at}) 뒤 바뀐 것: ${changed.join(' · ')}`);
}

const DIRTY = '사본에 커밋 안 된 변경이나 미추적 · 무시 파일이 있다 — 초기화가 지운다. 커밋하거나 치운다';

function prereg(plan) {
  if (readLog(mainLog(plan)).length) throw new Error('본 실행이 시작됐다 — 사전 등록을 바꿀 수 없다');
  if (plan.arms.some((a) => a.copies.some((c) => copyState(c, plan.full).status))) throw new Error(plan.full ? DIRTY : '사본에 커밋 안 된 추적 파일 변경이 있다 — 실행 뒤 되돌릴 기준이 없다');
  writeFileSync(join(plan.work, 'prereg.json'), `${JSON.stringify({ at: new Date().toISOString(), fingerprint: plan.fingerprint, parts: plan.parts }, null, 1)}\n`);
  const n = plan.questions.length * plan.reps;
  console.log(`사전 등록 지문 ${plan.fingerprint} — 질문 ${plan.questions.length} · 반복 ${plan.reps} · 쌍 ${n}(실행 ${n * plan.arms.length}) · 상한 $${plan.cap}`);
  console.log('이 지문을 보고서에 적는다. 이 뒤로 질문 · 지침 · 판정 기준 · 사본을 바꾸면 run · agg 가 exit 1 이다.');
}

// ── 실행 ────────────────────────────────────────────────────────────
function shuffle(xs, seed) {
  let a = seed;
  const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
const okRow = (r) => r.valid && !r.bad.length;
// 쌍 → 모든 팔(n)이 유효한 마지막 시도(없으면 null)
function pairs(log, n) {
  const out = new Map();
  for (const pair of new Set(log.map((r) => r.pair))) {
    const tries = log.filter((r) => r.pair === pair);
    const attempts = [...new Set(tries.map((r) => r.attempt))];
    const good = attempts.filter((a) => tries.filter((r) => r.attempt === a).length === n && tries.filter((r) => r.attempt === a).every(okRow));
    out.set(pair, { attempts: attempts.length, used: good.length ? tries.filter((r) => r.attempt === Math.max(...good)) : null });
  }
  return out;
}
const dropped = (log, n) => [...pairs(log, n)].filter(([, v]) => !v.used && v.attempts >= 2).map(([k]) => k);

function runOne(plan, claude, job, arm, slot, attempt) {
  const copy = arm.copies[slot];
  const q = plan.questions.find((x) => x.id === job.id);
  const deny = opt(plan, q, 'deny', DENY);
  // 세션 기록을 남기는 계획은 관문 훅이 그 기록을 읽게 하려는 것이다 — 실행 뒤 지운다
  const args = ['-p', q.q, '--append-system-prompt-file', join(plan.work, `prompt-${arm.name}.md`), '--model', plan.model,
    '--output-format', 'stream-json', '--verbose', '--include-hook-events', ...(plan.sessionPersistence ? [] : ['--no-session-persistence']), '--strict-mcp-config', '--max-turns', String(plan.maxTurns),
    '--permission-mode', opt(plan, q, 'permissionMode', 'default'), ...(deny.length ? ['--disallowedTools', ...deny] : []),
    ...(arm.settings ? ['--settings', arm.settings] : [])];
  const script = /\.[cm]?js$/.test(claude);
  const paths = { source: plan.source, self: copy, others: plan.arms.flatMap((a) => a.copies).filter((c) => c !== copy), scratch: plan.scratch };
  return new Promise((done) => {
    const t0 = Date.now();
    const chunks = [];
    const finish = (extra) => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const name = `${job.pair}-${arm.name}-${attempt}`;
      writeFileSync(join(plan.work, 'runs', `${name}.jsonl`), raw);
      const p = parseRun(raw);
      if (plan.sessionPersistence && !dropSession(copy, p.init?.session) && p.valid) extra.push('세션 기록 못 찾음');
      // 사람이 읽는 채점 — 답 본문은 작업 폴더에만 두고 표에는 경로만 낸다
      if (q.grade === 'manual') { mkdirSync(join(plan.work, 'answers'), { recursive: true }); writeFileSync(join(plan.work, 'answers', `${name}.md`), p.answer); }
      done({ ...(q.grade === 'manual' ? { answer: `answers/${name}.md` } : {}), run: `runs/${name}.jsonl`, denials: p.denials, gateBlocks: p.gateBlocks, stopBatch: p.stopBatch,
        pair: job.pair, id: job.id, set: q.set, kind: q.kind ?? null, rep: job.rep, arm: arm.name, slot, attempt, fp: plan.fingerprint, wallMs: Date.now() - t0,
        valid: p.valid, subtype: p.subtype, bad: [...checkRun(p, raw, arm, paths), ...extra], cost: p.cost, ms: p.ms, turns: p.turns, results: p.results,
        tokens: p.tokens, toolCalls: p.toolCalls, hit: q.gold?.length ? hit(p.files, q.gold) : null });
    };
    const c = spawn(script ? process.execPath : claude, script ? [claude, ...args] : args, { cwd: copy, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } });
    c.stdout.on('data', (d) => chunks.push(d));
    const kill = setTimeout(() => c.kill(), 30 * 60 * 1000);
    c.on('error', () => { clearTimeout(kill); finish(['기동 실패']); });
    c.on('close', () => { clearTimeout(kill); finish([]); });
  });
}

// 채점 명령 — 뒤에 <사본> <실행 기록> <질문 id> 를 붙여 부른다. stdout 마지막 줄이 {"metrics":{이름:0|1}} 이 아니면 null
async function scoreRun(score, copy, runFile, id) {
  try {
    const { stdout } = await promisify(execFile)(score[0], [...score.slice(1), copy, runFile, id], { encoding: 'utf8', timeout: 10 * 60 * 1000 });
    const m = JSON.parse(stdout.trim().split(/\r?\n/).at(-1)).metrics;
    return Object.keys(m).length && Object.values(m).every((v) => v === 0 || v === 1) ? m : null;
  } catch { return null; }
}

async function run(plan, claude, pilot, reps = plan.reps) {
  if (!claude) throw new Error('--claude <claude 실행 파일> 을 적는다 — 실제 실행은 토큰을 쓴다(사람 승인 뒤에만)');
  if (!pilot) guard(plan);
  mkdirSync(join(plan.work, 'runs'), { recursive: true });
  for (const a of plan.arms) writeFileSync(join(plan.work, `prompt-${a.name}.md`), a.prompt);
  const file = pilot ? join(plan.work, 'pilot-log.jsonl') : mainLog(plan);
  const ids = plan.questions.map((q) => q.id);
  // 파일럿 = 묶음마다 한 쌍(집계 밖). 본 실행 = 회차 우선 — 상한에서 멈춰도 질문마다 앞 회차가 남는다
  const jobs = pilot
    ? [...new Set(plan.questions.map((q) => q.set))].map((s) => ({ id: shuffle(plan.questions.filter((q) => q.set === s).map((q) => q.id), plan.seed)[0], rep: 1 }))
    : Array.from({ length: reps }, (_, r) => shuffle(ids, plan.seed + r + 1).map((id) => ({ id, rep: r + 1 }))).flat();
  const N = plan.arms.length;
  const done = pairs(readLog(file), N);
  const queue = jobs.map((j) => ({ ...j, pair: `${pilot ? 'pilot-' : ''}${j.id}-${j.rep}` })).filter((j) => !done.get(j.pair)?.used && (done.get(j.pair)?.attempts ?? 0) < 2)
    .map((j) => ({ j, attempt: (done.get(j.pair)?.attempts ?? 0) + 1 }));
  const base = plan.arms.map((a) => a.copies.map((c) => ({ ...copyState(c, plan.full), bytes: existsSync(storeOf(c)) ? readFileSync(storeOf(c)) : null })));
  if (plan.full && base.flat().some((b) => b.status)) throw new Error(DIRTY);
  console.log(`${pilot ? '파일럿' : '본 실행'}: 남은 쌍 ${queue.length} · 지금까지 $${spent(plan).toFixed(2)} · 상한 $${plan.cap}`);
  let stopped = false, halt = null;
  await Promise.all(plan.arms[0].copies.map(async (_, slot) => {
    while (queue.length && !halt) {
      if (spent(plan) >= plan.cap) { stopped = true; break; }
      const { j, attempt } = queue.shift();
      // 같은 질문의 모든 팔을 같은 순간에 띄운다 — 부하가 팔마다 같게 걸린다
      const rows = await Promise.all(plan.arms.map((a) => runOne(plan, claude, j, a, slot, attempt)));
      const q = plan.questions.find((x) => x.id === j.id);
      const score = opt(plan, q, 'score'), mutates = opt(plan, q, 'mutates');
      gateCheck(rows.map((r, i) => ({ ...r, gate: plan.arms[i].gate }))).forEach((bad, i) => rows[i].bad.push(...bad));
      for (const [i, r] of rows.entries()) {
        const dir = plan.arms[i].copies[slot], b = base[i][slot];
        // 순서: 채점(바뀐 사본을 본다) → 초기화 → 등록 때 상태와 대조
        if (score) {
          r.metrics = await scoreRun(score, dir, join(plan.work, r.run), j.id);
          if (!r.metrics) r.bad.push('채점 실패');
        }
        const now = copyState(dir, plan.full);
        if (!mutates && !sameState(tracked(now), tracked(b))) r.bad.push('사본 변경');
        if (!sameState(now, b)) {
          if (!plan.full) restore(dir, b);
          else {
            try { restore(dir, b, true); } catch { /* 아래 대조가 잡는다 */ }
            // 초기화가 안 되는 사본에서 더 돌리면 뒤 실행이 모두 물든다 — 멈춘다
            if (!sameState(copyState(dir, true), b)) { r.bad.push('초기화 어긋남'); halt = dir; }
          }
        }
        appendFileSync(file, `${JSON.stringify(r)}\n`);
      }
      console.log(`${j.pair} #${attempt} ${rows.map((r) => `${r.arm}:${okRow(r) ? '유효' : `무효[${r.valid ? r.bad : '결과 없음'}]`} $${r.cost.toFixed(3)} ${r.toolCalls}도구`).join(' · ')}`);
      if (!rows.every(okRow) && attempt === 1) queue.push({ j, attempt: 2 });
    }
  }));
  const lost = dropped(readLog(file), N);
  if (halt) console.log(`⛔ 사본이 초기화 뒤에도 등록 때와 다르다 — 새 쌍을 멈췄다: ${halt}`);
  console.log(`${stopped ? `⛔ 누적 $${spent(plan).toFixed(2)} ≥ 상한 $${plan.cap} — 새 쌍을 멈췄다` : '끝'} · 뺀 쌍 ${lost.length}${lost.length ? `(${lost.join(' · ')})` : ''} · 누적 $${spent(plan).toFixed(2)}`);
  if (stopped || halt || lost.length) process.exitCode = 1;
}

// ── 집계 — 질문마다 팔별 반복 중앙값 → 질문 단위 짝 ──────────────────────
const METRICS = { total: '총 토큰', fresh: '새로 처리 토큰', sec: '시간(초)', tools: '도구 호출', cost: '비용($)' };
const fmt = (k, v) => (v == null ? '—' : k === 'cost' ? v.toFixed(3) : k === 'sec' || k === 'tools' ? v.toFixed(1) : Math.round(v).toLocaleString('en-US'));

function compare(rows) {
  const out = { n: rows.length, m: {} };
  for (const k of Object.keys(METRICS).filter((x) => rows[0]?.per[x])) {
    const ratios = rows.map((x) => (x.per[k].b ? x.per[k].a / x.per[k].b : null)).filter((v) => v != null);
    out.m[k] = { a: median(rows.map((x) => x.per[k].a)), b: median(rows.map((x) => x.per[k].b)), ratio: median(ratios),
      less: rows.filter((x) => x.per[k].a < x.per[k].b).length, p: wilcoxon(rows.map((x) => x.per[k].a - x.per[k].b)).p };
  }
  // 정답 파일이 없는 질문(채점 명령 · 사람 채점)은 적중에서 뺀다
  const gold = rows.filter((x) => !x.noGold);
  const sum = (f, rs = gold) => rs.reduce((a, x) => a + f(x), 0);
  // 채점 명령이 낸 이진 지표 — 실행 합
  const met = {};
  for (const k of new Set(rows.flatMap((x) => Object.keys(x.met ?? {})))) {
    const rs = rows.filter((x) => x.met?.[k]);
    met[k] = { a: sum((x) => x.met[k].a, rs), b: sum((x) => x.met[k].b, rs), nA: sum((x) => x.nA, rs), nB: sum((x) => x.nB, rs) };
  }
  return { ...out, met, gold: gold.length, hitA: sum((x) => x.hitA), hitB: sum((x) => x.hitB), nA: sum((x) => x.nA), nB: sum((x) => x.nB),
    majA: gold.filter((x) => x.hitA * 2 > x.nA).length, majB: gold.filter((x) => x.hitB * 2 > x.nB).length };
}

// 질문 행 → 묶음별 표와 판정 줄. 판정은 계획의 judge(짝 비율 상한 · 적중 여유)만 쓴다
export function render(rows, [a, b], judge = []) {
  const sets = [...new Set(rows.map((r) => r.set))];
  const block = (label, rs) => {
    const c = compare(rs);
    return [`### ${label} (${c.n}건)`, `| 지표 | ${a} 중앙 | ${b} 중앙 | 짝 비율(${a}/${b}) | ${a} < ${b} 인 질문 | Wilcoxon p(참고) |`, '|---|---|---|---|---|---|',
      ...Object.entries(c.m).map(([k, v]) => `| ${METRICS[k]} | ${fmt(k, v.a)} | ${fmt(k, v.b)} | **${v.ratio?.toFixed(2) ?? '—'}** | ${v.less}/${c.n} | ${v.p?.toFixed(3) ?? '—'} |`),
      ...(c.gold ? [`| 정답 적중(실행) | ${c.hitA}/${c.nA} | ${c.hitB}/${c.nB} | — | 과반 적중 질문 ${a} ${c.majA} · ${b} ${c.majB} | — |`] : []),
      ...Object.entries(c.met).map(([k, v]) => `| ${k}(실행) | ${v.a}/${v.nA} | ${v.b}/${v.nB} | — | — | — |`), ''];
  };
  const out = [];
  for (const s of sets) {
    const rs = rows.filter((r) => r.set === s);
    out.push(...block(s, rs));
    for (const j of judge.filter((x) => x.set === s)) {
      const c = compare(rs);
      const checks = [...Object.entries(j.ratioMax ?? {}).map(([k, max]) => [`${METRICS[k]} 짝 비율 ${c.m[k]?.ratio?.toFixed(2)} ≤ ${max.toFixed(2)}`, c.m[k]?.ratio <= max]),
        ...(j.hitSlack == null ? [] : [[`적중 실행 ${a} ${c.hitA} ≥ ${b} ${c.hitB} − ${j.hitSlack}`, c.hitA >= c.hitB - j.hitSlack]]),
        // 지표별 여유 — lower 는 적을수록(거짓 완료 등), higher 는 많을수록(과제 성공 등) 좋다. 지표가 안 나왔으면 미달
        ...Object.entries(j.metrics ?? {}).map(([k, { better, slack = 0 }]) => {
          const v = c.met[k];
          return better === 'lower' ? [`${k} ${a} ${v?.a} ≤ ${b} ${v?.b} + ${slack}`, v?.a <= v?.b + slack] : [`${k} ${a} ${v?.a} ≥ ${b} ${v?.b} − ${slack}`, v?.a >= v?.b - slack];
        })];
      out.push(`판정(사전 등록 「${j.pass}」): ${checks.map(([t, ok]) => `${t} ${ok ? '✅' : '❌'}`).join(' · ')} → **${checks.every(([, ok]) => ok) ? j.pass : j.fail}**`, '');
    }
    const kinds = [...new Set(rs.map((r) => r.kind))];
    if (kinds.length > 1) for (const k of kinds) out.push(...block(`${s} · ${k}`, rs.filter((r) => r.kind === k)));
  }
  if (sets.length > 1) out.push(...block('전체', rows));
  return out.join('\n');
}

const perQuestion = (rows, [a, b]) => [`| 질문 | 묶음 | ${a} 시간 | ${b} 시간 | ${a} 도구 | ${b} 도구 | ${a} 새 토큰 | ${b} 새 토큰 | ${a} 적중 | ${b} 적중 |`, '|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((x) => `| ${x.id} | ${x.set}${x.kind ? ` · ${x.kind}` : ''} | ${fmt('sec', x.per.sec.a)} | ${fmt('sec', x.per.sec.b)} | ${fmt('tools', x.per.tools.a)} | ${fmt('tools', x.per.tools.b)} | ${fmt('fresh', x.per.fresh.a)} | ${fmt('fresh', x.per.fresh.b)} | ${x.noGold ? '—' : `${x.hitA}/${x.nA}`} | ${x.noGold ? '—' : `${x.hitB}/${x.nB}`} |`)].join('\n');

// 채점 지표의 질문별 표 — 실행 합/실행 수
function perMetric(rows, [a, b]) {
  const names = [...new Set(rows.flatMap((x) => Object.keys(x.met ?? {})))];
  if (!names.length) return [];
  return ['## 질문별 지표 (id 만 · 실행 합)', `| 질문 | 묶음 | ${names.map((k) => `${a} ${k} | ${b} ${k}`).join(' | ')} |`, `|---|---|${names.map(() => '---|---|').join('')}`,
    ...rows.filter((x) => x.met).map((x) => `| ${x.id} | ${x.set} | ${names.map((k) => (x.met[k] ? `${x.met[k].a}/${x.nA} | ${x.met[k].b}/${x.nB}` : '— | —')).join(' | ')} |`), ''];
}

// 질문별 표(위 perQuestion 형식) → 질문 행. 표에 있는 지표(시간 · 도구 · 새 토큰 · 적중)만 다시 낼 수 있다
export function parseTable(md) {
  const lines = String(md).split(/\r?\n/);
  const at = lines.findIndex((l) => /^\| 질문 \| 묶음 \|/.test(l));
  if (at < 0) throw new Error('질문별 표(| 질문 | 묶음 | …)가 없다');
  const cells = (l) => l.split('|').slice(1, -1).map((c) => c.trim());
  const head = cells(lines[at]);
  const num = (s) => Number(s.replace(/,/g, ''));
  const rows = [];
  for (const l of lines.slice(at + 2)) {
    if (!l.startsWith('|')) break;
    const c = cells(l);
    const [set, kind = null] = c[1].split(' · ');
    const [hitA, nA] = c[8].split('/').map(Number), [hitB, nB] = c[9].split('/').map(Number);
    rows.push({ id: c[0], set, kind, per: { fresh: { a: num(c[6]), b: num(c[7]) }, sec: { a: num(c[2]), b: num(c[3]) }, tools: { a: num(c[4]), b: num(c[5]) } }, ...(c[8] === '—' ? { noGold: true } : {}), hitA, nA, hitB, nB });
  }
  return { rows, arms: [head[2].split(' ')[0], head[3].split(' ')[0]] };
}

function agg(plan) {
  guard(plan);
  const log = readLog(mainLog(plan));
  if (log.some((r) => r.fp !== plan.fingerprint)) throw new Error('사전 등록 지문이 어긋난다 — 다른 등록에서 돈 실행이 기록에 섞였다');
  const N = plan.arms.length;
  const used = [...pairs(log, N).values()].flatMap((v) => v.used ?? []);
  // 판정은 기준 팔 대 각 팔의 짝으로 낸다 — 두 팔이면 한 짝이다
  const b = plan.baseline, treats = plan.arms.map((x) => x.name).filter((x) => x !== b);
  const value = { total: (r) => r.tokens.total, fresh: (r) => r.tokens.fresh, sec: (r) => (r.ms ?? r.wallMs) / 1000, tools: (r) => r.toolCalls, cost: (r) => r.cost };
  const rowsOf = (a) => plan.questions.map((q) => {
    const of = (arm) => used.filter((r) => r.id === q.id && r.arm === arm);
    const names = [...new Set([...of(a), ...of(b)].flatMap((r) => Object.keys(r.metrics ?? {})))];
    const met = (arm, k) => of(arm).reduce((s, r) => s + (r.metrics?.[k] ?? 0), 0);
    return { id: q.id, set: q.set, kind: q.kind ?? null, per: Object.fromEntries(Object.entries(value).map(([k, f]) => [k, { a: median(of(a).map(f)), b: median(of(b).map(f)) }])),
      ...(q.gold?.length ? {} : { noGold: true }), ...(names.length ? { met: Object.fromEntries(names.map((k) => [k, { a: met(a, k), b: met(b, k) }])) } : {}),
      hitA: of(a).filter((r) => r.hit).length, nA: of(a).length, hitB: of(b).filter((r) => r.hit).length, nB: of(b).length };
  }).filter((x) => x.nA && x.nB);
  const sides = treats.map((a) => ({ a, rows: rowsOf(a) }));
  if (!sides.some((s) => s.rows.length)) throw new Error('집계할 유효한 쌍이 없다');
  const bad = log.filter((r) => !okRow(r));
  const lost = dropped(log, N);
  const manual = used.filter((r) => r.answer);
  const ext = Math.max(0, ...used.map((r) => r.rep)) - plan.reps;
  const body = sides.flatMap(({ a, rows }) => [...(N > 2 ? [`## ${a} 대 ${b}`, ''] : []),
    render(rows, [a, b], (plan.judge ?? []).filter((j) => !j.arm || j.arm === a)), `## 질문별 (id 만 · 반복 중앙값)${N > 2 ? ` — ${a} 대 ${b}` : ''}`, perQuestion(rows, [a, b]), '', ...perMetric(rows, [a, b])]);
  const md = [`# A/B 집계 — ${treats.join(' · ')} 대 ${b} (숫자 · id 만)`, '',
    `- 사전 등록 지문 ${plan.fingerprint} · 모델 ${plan.model} · 반복 ${plan.reps}${ext > 0 ? ` + 연장 ${ext}` : ''}`,
    `- 실행 ${log.length}회(다시 돌린 것 포함) · 집계에 쓴 ${used.length}회 · 무효 ${bad.length}(${[...new Set(bad.flatMap((r) => (r.valid ? r.bad : ['결과 없음'])))].join(' · ') || '없음'}) · 뺀 쌍 ${lost.length} · 최대 턴 도달 ${used.filter((r) => r.subtype === 'error_max_turns').length}`,
    `- 비용(파일럿 포함) $${spent(plan).toFixed(2)} · 상한 $${plan.cap}`,
    '- 값: 질문마다 팔별 반복 중앙값 → 그 중앙값들의 중앙값. 짝 비율 = 질문별 비율의 중앙값', '',
    ...body,
    // 사람이 읽는 채점 — 기준표는 지휘 세션이 사전 등록해 두고, 여기는 답 본문 경로(작업 폴더 기준)만
    ...(manual.length ? ['## 사람이 읽는 채점 (답 본문 경로 — 작업 폴더 기준)', '| 질문 | 반복 | 팔 | 답 본문 |', '|---|---|---|---|', ...manual.map((r) => `| ${r.id} | ${r.rep} | ${r.arm} | ${r.answer} |`), ''] : [])].join('\n');
  writeFileSync(join(plan.work, 'out.md'), md);
  console.log(md);
}

await cli(import.meta.url, async () => {
  const [cmd, file, ...rest] = process.argv.slice(2);
  const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : null);
  if (!file || !['prereg', 'run', 'agg', 'recompute'].includes(cmd)) throw new Error('사용법: node proof/ab.mjs prereg|run|agg <계획.json> [--claude <실행 파일>] [--pilot] [--reps N] · recompute <표.md> [--plan <계획.json>]');
  // --reps=3 같은 꼴은 값이 읽히지 않고 조용히 무시된다
  const glued = rest.find((a) => /^--[\w-]+=/.test(a));
  if (glued) throw new Error(`알 수 없는 옵션: ${glued} — 옵션 값은 띄어 쓴다 (예: --reps 3)`);
  if (cmd === 'recompute') {
    const { rows, arms } = parseTable(readFileSync(file, 'utf8'));
    return console.log(render(rows, arms, flag('--plan') ? JSON.parse(readFileSync(flag('--plan'), 'utf8')).judge : []));
  }
  const plan = loadPlan(file);
  if (cmd === 'prereg') return prereg(plan);
  const reps = flag('--reps');
  if (rest.includes('--reps') && !(/^\d+$/.test(reps ?? '') && +reps > plan.reps)) throw new Error(`--reps 는 등록 반복(${plan.reps})보다 큰 수만 — 미리 적은 연장 규칙일 때만 쓴다`);
  if (cmd === 'run') return run(plan, flag('--claude'), rest.includes('--pilot'), reps ? +reps : plan.reps);
  return agg(plan);
});

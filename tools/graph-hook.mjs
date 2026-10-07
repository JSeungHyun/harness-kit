#!/usr/bin/env node
// UserPromptSubmit 훅 — 질문마다 graph-find 를 대신 돌려 과거 기록을 상한 걸린 양만 넣는다. 설계안.
// ⭐ 탐색 1번 단계를 모델의 규율에 맡기지 않는 것이 목적이다. 실패는 조용히 통과 — 프롬프트를 막지 않는다.
import { load, scoreDetail, sup, tokenizeKo, tokenizeIds } from './graph-find.mjs';

const MAX = 2;   // 프롬프트마다 붙는 비용이므로 상위 2건만

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  try { const out = render(JSON.parse(raw || '{}').prompt || ''); if (out) console.log(out); } catch { /* 실패는 조용히 통과 — 프롬프트를 막지 않는다 */ }
  process.exit(0);
});

// 찍을 문장을 돌려준다 — 침묵이면 ''
function render(prompt) {
  const ko = tokenizeKo(prompt);
  const ids = tokenizeIds(prompt);
  if (!ko.size && !ids.length) return '';

  // 대체된 기록 제외(두 단 모두) — 빼기 전 1단 확신 453건 중 대체 기록이 1위 97건 · 상위2 186건(41%), 뺀 뒤 0 · 자기검색 103/106 불변. 바꾸려면 다시 잰다
  const all = load();
  const superseded = new Set(all.flatMap(sup));
  const recs = all.filter((r) => !BOOKKEEPING.test(r.req) && !superseded.has(r.req));
  // 정렬은 graph-find 와 같다 — 정확일치 유무가 첫 키다
  const hits = recs.map((r) => ({ r, ...scoreDetail(r, [...ko, ...ids]) }))
    .filter((x) => x.s > 0).sort((a, b) => (b.exact > 0 ? 1 : 0) - (a.exact > 0 ? 1 : 0) || b.s - a.s || (b.r.date || '').localeCompare(a.r.date || ''));

  // 1단 판정은 점수 합이 아니라 신호의 종류로 — 정확일치 · 식별자 적중 · 5점 이상. 아니면 2단(압축 색인)
  const top = hits[0];
  const idHit = top && ids.length > 0 && scoreDetail(top.r, ids).s > 0;
  const confident = top && (top.exact >= 1 || idHit || top.s >= 5);
  if (!confident) return fallbackIndex(recs, hits, [...ko, ...ids]);

  // ⛔ 1단에도 탈출구를 둔다 — 「걸렸다」가 「답이다」는 아니다
  // 정본이 1위면 1장 — 절차 질의에서 정본 + 무관한 광역 카드로 7,128자가 나갔다. 바꾸려면 다시 잰다
  const take = /^정본:/.test(top.r.req) ? 1 : MAX;
  const out = [`[그래프 자동조회] 유사 기록 ${hits.length}건 — 상위 ${Math.min(take, hits.length)}건만 표시.`,
    `⚠️ 아래는 과거 작업에서 실측한 것이다. 함정과 「용어 → 실체」 매핑 둘 다 근거로 쓴다 — 추측으로 대체하지 않는다.`,
    `⛔ 값이 「제거됨」·「바뀜」으로 시작하면 그게 답이다. 코드에 안 보인다고 「모름」이라 하지 않는다.`,
    `⭐ 다만 위 기록이 이 질문에 답하지 않으면 그렇다고 말하고 평소대로 코드를 탐색한다 — 걸린 것이 답이라는 뜻은 아니다.`];
  // 2위 카드는 정본 · 사전만 전문 — 1위가 광역 사전이고 2위 정본이 실제 답인 경우가 1단의 12.9%(이슈 제목 실측)라 그 둘은 지키고, 작업 이력 · 조사는 제목 + 함정만
  for (const [i, { r, s }] of hits.slice(0, take).entries()) {
    const kind = kindOf(r);
    out.push(`· [${kind} · ${s}점] ${r.date} ${r.req}`);
    // 함정을 맨 앞에 — 카드 끝에 두면 묻혀서 모델이 추측으로 답한다
    if (r.note) out.push(`    ⚠️ 함정: ${r.note}`);
    if (i > 0 && !['절차', '사전'].includes(kind)) continue;
    const { hit, rest } = splitTerms(r, ko, ids);
    for (const [k, v] of hit) out.push(`    ${k} → ${clip(v)}`);
    if (rest.length) out.push(`    … 이 질의와 안 걸린 항목 ${rest.length}개(키만): ${rest.map(([k]) => k).join(' · ')}`);
    for (const f of (r.files || []).slice(0, 6)) out.push(`    ${f}`);
  }
  out.push(...openWork(recs, [...ko, ...ids], hits.slice(0, take).map((h) => h.r)));
  out.push(`더 볼 것: node .harness/tools/graph-find.mjs <어근>  (어근은 짧게, 여러 개)`);
  return out.join('\n');
}

// 카드 용어는 채점 규칙 ③과 같다 — 한글 토큰은 키에만, 식별자는 값까지. 값까지 보면 2글자 어근이 광역 사전을 거의 다 펼쳤다(1단 바이트의 61%). 8줄 · 160자 — 바꾸려면 다시 잰다. ⛔ 기록 선택에 되먹이지 않는다
const TERM_MAX = 8;
const VALUE_MAX = 160;
function splitTerms(rec, ko, ids) {
  const pairs = Object.entries(Array.isArray(rec.terms) ? {} : rec.terms || {});
  const norm = (s) => s.toLowerCase().replace(/\s+/g, '');
  const koToks = [...ko].map(norm), idToks = ids.map((t) => t.toLowerCase());
  const exact = [], partial = [];
  for (const p of pairs) {
    const [k, v] = p, key = norm(k), text = `${k} ${v}`.toLowerCase();
    if (koToks.includes(key) || idToks.includes(k.toLowerCase())) exact.push(p);
    else if (koToks.some((t) => key.includes(t)) || idToks.some((t) => text.includes(t))) partial.push(p);
  }
  // 키가 토큰과 정확히 같은 용어를 먼저 — 기록 순서로 뒤에 있어도 8줄 상한에 접히지 않는다. 하나도 안 걸리면 앞에서부터
  const hits = [...exact, ...partial];
  const hit = (hits.length ? hits : pairs).slice(0, TERM_MAX);
  return { hit, rest: pairs.filter((p) => !hit.includes(p)) };
}
function clip(v) {
  const s = String(v);
  return s.length > VALUE_MAX ? `${s.slice(0, VALUE_MAX)} …(전문: graph-find)` : s;
}

// 종류는 제목에서 파생한다 — 표시 전용, 점수에 쓰지 않는다
const KINDS = [
  ['절차', /^정본:/],
  ['사전', /^용어 사전:|^용어 학습:|^공백 채움:|어휘 다리/],
  ['원문', /^원문|가이드문서|인수인계|연혁/],
  ['폐기', /기각|철거|폐기|걷어|원복|중단|미실행|제거(했|됨|\b)|삭제했/],
  ['도구', /^그래프|훅|도구|템플릿|미러|측정|스크립트|graph-|tools\//],
  ['조사', /조사|확정|실측|분석|검증|교차검증|진단|점검|감사/],
  ['이력', /수정|추가|구현|반영|적용|변경|개선|신설|분리|이관|통합/],
];
function kindOf(rec) {
  for (const [k, re] of KINDS) if (re.test(rec.req)) return k;
  return '기타';
}

// 열린 작업(⏸)은 랭킹으로 닿지 않는다 — 점수가 아니라 상태로 붙인다. 표식은 note 맨 앞만, 문턱은 확신 판정과 같은 5
const OPEN_MIN = 5;
export const isOpen = (r) => (r.note || '').startsWith('⏸');
function openWork(recs, toks, shown = []) {
  const open = recs.filter((r) => !shown.includes(r) && isOpen(r) && scoreDetail(r, toks).s >= OPEN_MIN);
  if (!open.length) return [];
  const out = [`⏸ 열린 작업 ${open.length}건 — 이 주제에 **하다 만 기록**이 있다. 다시 조사하기 전에 이것부터 편다.`];
  for (const r of open) {
    out.push(`  ⏸ ${r.date} ${r.req}`);
    // 앞머리만 — 「어디까지 했고 왜 멈췄나」가 note 앞에 온다
    if (r.note) out.push(`     ⚠️ ${r.note.slice(0, 240)}${r.note.length > 240 ? ' …(전문: graph-find)' : ''}`);
  }
  return out;
}

const BOOKKEEPING = /^TODO 갱신|^TODO:/;
// 침묵 문턱 s ≤ 2 — 실제 입력 192건 중 침묵된 23건은 전부 진행 발화이거나 답이 없는 질의, 주입 5,823→4,526자(−22%) · 적중 137건 불변. 3 이면 답이 있는 질의가 침묵된다. 바꾸려면 다시 잰다
const FALLBACK_MIN = 2;
const CANDIDATES = 10;
const INDEX_KEYS = 5;

// 2단 — 점수 상위 10건. 전체 색인(≤150건 · 약 24,000자 — 기록 수에 따라 커진다)은 질의마다 달라지는 정보가 없었고, 대조 실험에서 색인이 이긴 2건은 둘 다 점수가 있었다(2위 · 10위). 5건이면 10위가 빠진다. 바꾸려면 다시 잰다
function fallbackIndex(recs, hits, toks) {
  if (!hits.length || hits[0].s <= FALLBACK_MIN) return '';
  const lines = hits.slice(0, CANDIDATES).map(({ r }) => {
    const keys = Array.isArray(r.terms) ? r.terms : Object.keys(r.terms || {});
    const shown = keys.slice(0, INDEX_KEYS).join(', ') + (keys.length > INDEX_KEYS ? ' …' : '');
    return `${r.date} ${r.req}${keys.length ? `  [용어: ${shown}]` : ''}`;
  });
  return [
    `[그래프 자동조회] 키워드로는 약하게만 걸렸다(최고 점수 ${hits[0].s}). 아래 색인에서 의미가 맞는 것을 직접 고른다.`,
    `⛔ 억지로 고르지 않는다 — 관련 없으면 색인을 무시하고 평소대로 코드를 탐색한다.`,
    `⭐ 맞는 항목이 보이면 그 용어로 상세를 판다: node .harness/tools/graph-find.mjs <용어>`,
    `⭐ 사용자가 쓴 표현이 아래 용어에 없으면, 알아낸 뒤 그 표현을 용어 키로 기록한다: node .harness/tools/graph-alias.mjs <표현> "<실체>"`,
    ...openWork(recs, toks),
    ...lines,
  ].join('\n');
}

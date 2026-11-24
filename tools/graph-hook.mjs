#!/usr/bin/env node
// UserPromptSubmit 훅 — 질문마다 graph-find 를 대신 돌려 과거 기록을 상한 걸린 양만 넣는다. 설계안.
// ⭐ 탐색 1번 단계를 모델의 규율에 맡기지 않는 것이 목적이다. 실패는 조용히 통과 — 프롬프트를 막지 않는다.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, scoreDetail, sup, tokenizeKo, tokenizeIds, ORIGIN } from './graph-find.mjs';

const MAX = 2;   // 프롬프트마다 붙는 비용이므로 상위 2건만
// 모르면 침묵(21차 · 원천 사본 시험) — 기록의 10% 넘게 걸리는 흔한 한글 낱말의 정확일치는 확신 · 정렬에 세지 않고, 본문 합 5점은 제목에 질문 낱말이 2개 닿을 때만 1단.
// 무관 1단 7,095 → 색인 5,012자 · 실입력 300 1단 84 → 75% · 자기검색 187 → 188/195. 하한 5건은 작은 기록 보호. 바꾸려면 다시 잰다
const COMMON_SHARE = 0.1, COMMON_MIN = 5, TITLE_MIN = 2;
// 정렬은 graph-find 와 같다 — 정확일치 유무가 첫 키다
const order = (a, b) => (b.exact > 0 ? 1 : 0) - (a.exact > 0 ? 1 : 0) || b.s - a.s || (b.r.date || '').localeCompare(a.r.date || '');

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
  const toks = [...ko, ...ids];
  const base = recs.map((r) => ({ r, ...scoreDetail(r, toks) })).filter((x) => x.s > 0);
  const common = commonKo(recs, base, ko);
  const rest = toks.filter((t) => !common.has(t));
  const hits = base.map((h) => ({ ...h, exact: h.exact && common.size ? scoreDetail(h.r, rest).exact : h.exact,
    th: titleHits(h.r.req, ko) })).sort(order);

  // 1단 판정은 점수 합이 아니라 신호의 종류로 — 정확일치(흔한 낱말 뺌) · 식별자 적중 · 제목에 닿는 5점 이상. 아니면 2단(압축 색인)
  const top = hits[0];
  const idHit = top && ids.length > 0 && scoreDetail(top.r, ids).s > 0;
  const confident = top && (top.exact >= 1 || idHit || (top.s >= 5 && top.th >= TITLE_MIN));
  if (!confident) return fallbackIndex(recs, hits, toks);

  // 정본이 1위면 1장 — 절차 질의에서 정본 + 무관한 광역 카드로 7,128자가 나갔다. 바꾸려면 다시 잰다
  const take = /^정본:/.test(top.r.req) ? 1 : MAX;
  const shown = hits.slice(0, take);
  const hubs = hubFiles(recs);
  const out = [`[그래프 자동조회] 유사 기록 ${hits.length}건 — 상위 ${shown.length}건의 단서(제목 · 핵심 파일)다. 전문(용어 · 함정)은 \`${FIND} <키>\`로 조회해 읽는다 — 키 · 이름만 보이면 되묻지 말고 조회한다.`,
    '기록으로 답하면 답 끝에 기록 날짜와 「○○까지 볼까요?」를 붙인다.'];
  for (const { r, s } of shown) {
    out.push(`· [${kindOf(r)} · ${s}점] ${r.date} ${r.req}`);
    const { keep, gone } = cardFiles(r, hubs);
    if (keep.length) out.push(`    ${keep.join(' · ')}`);
    if (gone) out.push(`    (저장소에 없는 파일 ${gone}개 뺌)`);
    out.push(`    전문: graph-find ${guideKey(r, ko, ids)}`);
  }
  out.push(...openWork(recs, toks, shown.map((h) => h.r)));
  return out.join('\n');
}

// 카드는 길잡이 — 제목 · 핵심 파일 · 전문 명령뿐이다. 용어 · 함정 본문은 싣지 않는다(25차 — 주입이 질문의 74~76% · 용어 46% · 함정 30% 였다). 바꾸려면 다시 잰다
const FIND = 'node .harness/tools/graph-find.mjs';
const FILE_MAX = 3;
const bare = (f) => String(f).replace(/:\d+(-\d+)?$/, '').replace(/\\/g, '/');
// 허브 파일 — 살아 있는 기록의 10% 넘게(최소 5건 초과) 나오는 파일은 어느 주제에나 붙어 길잡이가 못 된다. 문턱은 흔한 낱말과 같은 값이다(근거: docs/proof.md 25차)
function hubFiles(recs) {
  const freq = new Map();
  for (const r of recs) for (const f of new Set((r.files || []).map(bare))) freq.set(f, (freq.get(f) || 0) + 1);
  const limit = Math.max(recs.length * COMMON_SHARE, COMMON_MIN);
  return new Set([...freq].filter(([, n]) => n > limit).map(([f]) => f));
}
// 저장소 루트는 graph-find 와 같다 — 훅이 어느 작업 폴더에서 돌지 보장이 없다
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
function cardFiles(rec, hubs) {
  const own = (rec.files || []).filter((f) => !hubs.has(bare(f)));
  const live = own.filter((f) => existsSync(resolve(ROOT, bare(f))));
  return { keep: live.slice(0, FILE_MAX), gone: own.length - live.length };
}
// 전문 조회 키 — 질문에 걸린 용어 키(정확일치 먼저), 없으면 질문 낱말 하나. 공백이 든 키는 따옴표로
function guideKey(rec, ko, ids) {
  const norm = (x) => x.toLowerCase().replace(/\s+/g, '');
  const koToks = [...ko].map(norm), idToks = ids.map((t) => t.toLowerCase());
  const keys = Array.isArray(rec.terms) ? rec.terms : Object.keys(rec.terms || {});
  const exact = keys.find((k) => koToks.includes(norm(k)) || idToks.includes(k.toLowerCase()));
  const partial = keys.find((k) => koToks.some((t) => norm(k).includes(t)));
  const key = exact ?? partial ?? [...ko, ...ids][0] ?? rec.req;
  return /\s/.test(key) ? `"${key}"` : key;
}
// 정확일치가 난 한글 낱말 중 살아 있는 기록의 10% 넘게(그리고 5건 넘게) 걸리는 것. 식별자는 세지 않는다 — 값까지 색인돼 흔해도 실체를 가리킨다
function commonKo(recs, hits, ko) {
  const exactKo = new Set(hits.filter((h) => h.exact).flatMap((h) => [...ko].filter((t) => scoreDetail(h.r, [t]).exact)));
  const limit = Math.max(recs.length * COMMON_SHARE, COMMON_MIN);
  return new Set([...exactKo].filter((t) => recs.filter((r) => scoreDetail(r, [t]).s > 0).length > limit));
}
// 제목에 닿은 질문 낱말 수 — 겹치는 토큰(「환불처리」 · 어근 「환불」)은 긴 것 하나로. 공백은 지우지 않는다(띄어 쓴 두 낱말이 붙인 꼴 하나로 합쳐진다)
function titleHits(req, ko) {
  const title = String(req).toLowerCase();
  const m = [...ko].map((t) => t.toLowerCase()).filter((t) => title.includes(t));
  return m.filter((t) => !m.some((u) => u !== t && u.includes(t))).length;
}
function clip(v) {
  const s = String(v);
  return s.length > VALUE_MAX ? `${s.slice(0, VALUE_MAX)} …(전문: graph-find)` : s;
}

// 종류는 제목에서 파생한다 — 표시 전용, 점수에 쓰지 않는다
const KINDS = [
  ['절차', /^정본:/],
  ['사전', /^용어 사전:|^용어 학습:|^공백 채움:|어휘 다리/],
  ['원문', new RegExp(`^${ORIGIN}|가이드문서|인수인계|연혁`)],
  ['폐기', /기각|철거|폐기|걷어|원복|중단|미실행|제거(했|됨|\b)|삭제했/],
  ['도구', /^그래프|훅|도구|템플릿|미러|측정|스크립트|graph-|tools\//],
  ['조사', /조사|확정|실측|분석|검증|교차검증|진단|점검|감사/],
  ['이력', /수정|추가|구현|반영|적용|변경|개선|신설|분리|이관|통합/],
];
function kindOf(rec) {
  for (const [k, re] of KINDS) if (re.test(rec.req)) return k;
  return '기타';
}

// 열린 작업(⏸)은 랭킹으로 닿지 않는다 — 점수가 아니라 상태로 붙인다. 표식은 note 맨 앞만, 문턱은 확신 판정과 같은 5. 제목만 싣는다 — note 는 전문 조회로(25차)
const OPEN_MIN = 5;
// 질의와 가장 겹치는 3건만 — 원천 실입력 300 재생에서 ⏸ 부분 p90 5,902 → 1,319자 · 1단 1위 · 재개 질의 16/16 불변. 나머지는 건수와 --open 으로. 바꾸려면 다시 잰다
const OPEN_SHOW = 3;
export const isOpen = (r) => (r.note || '').startsWith('⏸');
function openWork(recs, toks, shown = []) {
  const open = recs.filter((r) => !shown.includes(r) && isOpen(r)).map((r) => ({ r, ...scoreDetail(r, toks) }))
    .filter((x) => x.s >= OPEN_MIN).sort(order);
  if (!open.length) return [];
  const out = [`⏸ 열린 작업 ${open.length}건 — 이 주제에 **하다 만 기록**이 있다. 다시 조사하기 전에 이것부터 편다.`];
  for (const { r } of open.slice(0, OPEN_SHOW)) out.push(`  ⏸ ${r.date} ${r.req}`);
  if (open.length > OPEN_SHOW) out.push(`  … 나머지 ${open.length - OPEN_SHOW}건: node .harness/tools/graph-find.mjs --open`);
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

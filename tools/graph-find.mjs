#!/usr/bin/env node
// 새 요구가 오면 과거 유사 요구와 그때 만진 파일을 찾는다 — 시작점을 공짜로 얻는 것이 목적이다. 설계안.
//   node .harness/tools/graph-find.mjs <용어…>          # 어근을 짧게, 여러 개 (--all: 대체된 기록 포함)
//   node .harness/tools/graph-find.mjs --files <경로조각> # 파일 → 그 파일을 만진 요구 (1홉)
//   node .harness/tools/graph-find.mjs --with <경로조각>  # 파일 → 같이 움직이는 파일 (2홉)
//   node .harness/tools/graph-find.mjs --open | --check | --promote [정본문서]
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 도구 파일 기준 — 훅은 어느 cwd 에서 돌지 보장이 없다. 대상에서는 .harness/graph/requests.jsonl
export const STORE = process.env.HARNESS_GRAPH_STORE || fileURLToPath(new URL('../graph/requests.jsonl', import.meta.url));

export function load(store = STORE) {
  if (!existsSync(store)) return [];
  return readFileSync(store, 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

// 질의에서 걷어낼 흔한 말. ⛔ 도메인 명사는 넣지 않는다 — 그것들이 신호다
export const STOP = new Set(['수정', '변경', '추가', '관련', '기능', '코드', '부분', '처리', '개선',
  '오류', '문제', '누락', '적용', '반영', '생성', '분리', '확인', '제거', '정리', '개발', '수정사항',
  '작업', '어떻게', '무엇', '어디', '언제', '해줘', '알려줘', '하는', '해야', '지금', '다시', '좀']);

// terms 는 객체({현업어: 시스템어}) 또는 배열(구 기록)이다
const termKeys = (r) => (Array.isArray(r.terms) ? r.terms : Object.keys(r.terms || {}));
const termPairs = (r) => (Array.isArray(r.terms) ? [] : Object.entries(r.terms || {}));
// supersedes 는 문자열 1개 또는 배열(조각 여러 건을 정본 1건으로 통합할 때)
export const sup = (r) => [].concat(r.supersedes || []).filter(Boolean);

// 훅과 CLI 가 같은 토크나이저를 쓴다. 조사를 떼야 용어 정확일치가 걸리고, 원형도 남겨 잘못 떼도 손해가 없다
const JOSA = /(으로|에서|부터|까지|에게|한테|이나|라도|는|은|를|을|가|이|의|에|도|만|과|와|랑|로|나)$/;
function addTok(set, t) {
  if (t.length >= 2 && !STOP.has(t)) set.add(t);
  const bare = t.replace(JOSA, '');
  if (bare !== t && bare.length >= 2 && !STOP.has(bare)) set.add(bare);
}
export function tokenizeKo(prompt) {
  const ko = new Set();
  // 숫자·영문이 섞인 말을 먼저, 순수 한글을 따로 — [가-힣]{2,} 만 쓰면 섞인 말이 통째로 사라진다
  for (const raw of prompt.match(/[0-9A-Za-z]+[가-힣]+|[가-힣]+[0-9A-Za-z]+[가-힣]*/g) || []) addTok(ko, raw);
  for (const raw of prompt.match(/[가-힣]{2,}/g) || []) addTok(ko, raw);
  // 공백만 다른 형태(「목표 수립」=「목표수립」)를 질의에서 만든다 — 저장 쪽을 늘리지 않는다
  for (const phrase of prompt.split(/[^가-힣\s]+/)) {
    // 1글자 어절도 조합에는 넣는다 — 빼면 「기준 월」이 「기준월」이 안 된다
    const parts = phrase.trim().split(/\s+/).filter((w) => /^[가-힣]+$/.test(w));
    for (let i = 0; i < parts.length; i++) {
      for (let n = 2; n <= 3 && i + n <= parts.length; n++) {
        const joined = parts.slice(i, i + n).join('');
        if (joined.length <= 12) addTok(ko, joined);
      }
    }
  }
  // 2글자 어근 — 부분일치라 접미사가 붙으면 놓친다
  for (const t of [...ko]) if (t.length >= 3 && !STOP.has(t.slice(0, 2))) ko.add(t.slice(0, 2));
  return ko;
}
// 파일명·식별자는 따로 — 대문자 약어는 2자부터, 소문자 섞인 낱말은 5자부터(흔한 영어 낱말이 노이즈가 된다)
export function tokenizeIds(prompt) {
  return [...new Set([
    ...(prompt.match(/\b[A-Z][A-Z0-9]{1,}\b/g) || []),
    ...(prompt.match(/[A-Za-z_][A-Za-z0-9_.\-]{3,}/g) || []).filter((t) => t.length >= 5),
  ])];
}

// 제목 머리(접두어를 떼고 첫 구분자 앞)를 용어 키처럼 친다. ⛔ 5자 미만 n-gram 은 흔한 조각이 엉뚱한 기록에 걸린다
const TITLE_PREFIX = /^(정본|용어 사전|용어 학습|공백 채움|공백 목록|정정|원문)\s*:\s*/;
const TITLE_CACHE = new WeakMap();
export function titleKeys(rec) {
  let v = TITLE_CACHE.get(rec);
  if (v) return v;
  const head = String(rec.req || '').replace(TITLE_PREFIX, '').split(/[—(\[:]/)[0].trim();
  v = [];
  if (head.length >= 4) {
    v.push(head.toLowerCase().replace(/\s+/g, ''));
    // 토크나이저와 같은 규칙으로 쪼갠다 — 구두점으로 한 번 더, 순수 한글 어절만으로도
    for (const seg of head.split(/[·,/]+/)) {
      const raw = seg.trim().split(/\s+/).filter((w) => /^[가-힣A-Za-z0-9]{2,}$/.test(w));
      const koOnly = seg.trim().split(/\s+/).filter((w) => /^[가-힣]{2,}$/.test(w));
      for (const parts of [raw, koOnly])
        for (let i = 0; i < parts.length; i++)
          for (let n = 1; n <= 3 && i + n <= parts.length; n++) {
            const j = parts.slice(i, i + n).join('').toLowerCase();
            if (j.length >= 5 && j.length <= 16) v.push(j);
          }
    }
    v = [...new Set(v)];
  }
  TITLE_CACHE.set(rec, v);
  return v;
}

// 점수와 함께 신호의 종류를 돌려준다 — 「정확일치 1건」과 「흔한 말 세 군데 스침」이 같은 3점이라 판정은 부르는 쪽이 한다
export function scoreDetail(rec, queries) {
  const keys = termKeys(rec);
  // 용어 값은 식별자 질의에만 — 값까지 넣으면 1위가 정확일치 0 인 비율 56%(본문 질의 75건). 빼서 잃은 확신 52건은 전부 정확일치 0 · 식별자 조회 6/6 유지. 바꾸려면 다시 잰다
  const vals = termPairs(rec).map(([, v]) => v).join(' ').toLowerCase();
  const base = [rec.req, keys.join(' '), (rec.tables || []).join(' ')].join(' ').toLowerCase();
  const hayId = base + ' ' + vals;
  // 경로는 2점(1건만 맞아도 확실), note 스침은 1점 — 같은 가중이면 낱말이 스친 기록이 정본을 누른다
  const paths = (rec.files || []).join(' ').toLowerCase();
  const noteTxt = (rec.note || '').toLowerCase();
  let s = 0, exact = 0, body = 0, near = 0;
  for (const q of queries) {
    const t = q.toLowerCase();
    // 공백을 무시하고 비교한다 — 토크나이저는 공백 든 토큰을 만들지 못한다
    const tn = t.replace(/\s+/g, '');
    if (keys.some((x) => x.toLowerCase().replace(/\s+/g, '') === tn)) { s += 3; exact++; }   // 용어 정확 일치
    else if (titleKeys(rec).includes(tn)) { s += 3; exact++; }          // 제목 머리 일치
    else if (paths.includes(t)) { s += 2; near++; }                     // 경로가 직접 지목
    else if ((/[가-힣]/.test(t) ? base : hayId).includes(t)) { s += 1; body++; }  // 용어 값은 식별자 조회에만
    else if (noteTxt.includes(t)) { s += 1; body++; }                   // 함정 본문에 스침
  }
  return { s, exact, body, near };
}

export const score = (rec, queries) => scoreDetail(rec, queries).s;

export function findByFile(recs, needle) {
  const n = needle.toLowerCase();
  return recs.filter((r) => (r.files || []).some((f) => f.toLowerCase().includes(n)));
}

// 파생 색인 — 저장은 평평한 줄 목록이고 대체 관계는 읽을 때 만든다. 기록 순서는 줄 순서다
export function index(recs) {
  const out = recs.map((r, i) => ({ ...r, seq: i + 1 }));
  for (const r of out) {
    const heirs = out.filter((x) => sup(x).includes(r.req));
    if (heirs.length) {
      r.supersededBy = heirs[0];
      r.validTo = heirs[0].recorded || heirs[0].date;  // 이 기록이 낡은 시점
    }
  }
  return out;
}

// 2홉: 파일 → 그 파일을 만진 요구 → 그 요구가 같이 만진 파일
export function coChange(recs, needle) {
  const n = needle.toLowerCase();
  const hits = findByFile(recs, n);
  const co = new Map();
  for (const r of hits) {
    for (const f of new Set(r.files || [])) {
      if (f.toLowerCase().includes(n)) continue;
      if (!co.has(f)) co.set(f, { n: 0, reqs: [] });
      const e = co.get(f);
      e.n++;
      e.reqs.push(r);
    }
  }
  return { hits, co: [...co.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])) };
}

// 무결성 — 문자열로 잇는 구조라 오타 한 글자로 사슬이 끊긴다
export function check(recs, { fileExists } = {}) {
  const byReq = new Map();
  for (const r of recs) byReq.set(r.req, r);
  const problems = [];

  for (const r of recs) {
    for (const s of sup(r)) {
      const old = byReq.get(s);
      if (!old) { problems.push(['고아 대체', `줄${r.seq} ${r.req.slice(0, 40)} → 「${s.slice(0, 40)}」 (그런 기록 없음)`]); continue; }
      if (old.seq >= r.seq) problems.push(['기록순 역행', `줄${r.seq} 가 줄${old.seq} 을 대체 — 나중 것이 먼저 기록될 수 없다`]);
      if (old.req === r.req) problems.push(['자기 대체', `줄${r.seq} ${r.req.slice(0, 40)}`]);
      // 소급 기록이 최신을 대체하면 기록순은 정상이어도 세상시간으로는 과거가 최신을 무효화한다
      if (r.date && old.date && r.date < old.date) {
        problems.push(['세상시간 역행', `${r.date} 기록이 더 최신인 ${old.date} 을 대체 — 소급 기록에는 supersedes 를 붙이지 않는다`]);
      }
    }
  }
  const dupes = new Map();
  for (const r of recs) for (const s of sup(r)) dupes.set(s, (dupes.get(s) || 0) + 1);
  for (const [req, n] of dupes) if (n > 1) problems.push(['중복 대체', `「${req.slice(0, 40)}」 를 ${n}개 기록이 대체한다 — 사슬이 갈라진다`]);

  // 경로가 사라졌으면 그래프가 코드보다 낡았다. ⛔ 대체된 기록은 뺀다 — 경로 소멸이 대체의 이유인 경우가 많아 영구 오탐이 된다
  const superseded = new Set(recs.flatMap(sup));
  const gone = [];
  if (fileExists) {
    for (const r of recs) {
      if (superseded.has(r.req)) continue;
      for (const f of r.files || []) if (!fileExists(f)) gone.push([r, f]);
    }
  }
  const noRecorded = recs.filter((r) => !r.recorded);
  const retro = recs.filter((r) => r.recorded && r.date && r.date < r.recorded);

  // 같은 용어를 여러 기록이 가질 때 과거가 1위면 새 세션이 낡은 값을 답한다 — 「최신이 1위인가」까지만 본다
  const owners = new Map();
  for (const r of recs) for (const k of termKeys(r)) {
    const nk = k.toLowerCase().replace(/\s+/g, '');
    if (!owners.has(nk)) owners.set(nk, []);
    owners.get(nk).push(r);
  }
  const stale = [];
  for (const [k, v] of owners) {
    if (v.length < 2) continue;
    const top = v.map((r) => ({ r, s: scoreDetail(r, [k]).s }))
      .sort((a, b) => b.s - a.s || String(b.r.date).localeCompare(String(a.r.date)))[0].r;
    const newest = [...v].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (String(top.date) < String(newest.date)) stale.push({ k, top, newest, n: v.length });
  }
  // ⏸ 표식 누락 후보 — 「하다 말았다」는 기계가 못 정해 낱말로 후보만 올린다. 표식은 note 맨 앞에서만 인정한다
  const OPEN_WORD = /미구현|구현 보류|「일단 대기」|중단됨/;
  const unmarked = recs.filter((r) => !superseded.has(r.req) && !(r.note || '').startsWith('⏸') &&
    OPEN_WORD.test([r.req, r.note || '', ...Object.values(Array.isArray(r.terms) ? {} : r.terms || {})].join(' ')));

  return { problems, gone, noRecorded, retro, stale, unmarked, dupTerms: [...owners.values()].filter((v) => v.length > 1).length };
}

if (process.argv[1] && process.argv[1].endsWith('graph-find.mjs')) {
  let args = process.argv.slice(2);
  const recs = index(load());

  if (!recs.length) { console.log('기록이 없다. .harness/tools/graph-append.mjs 로 먼저 쌓는다.'); process.exit(0); }
  if (!args.length) {
    console.error('사용법: node .harness/tools/graph-find.mjs <용어…>  |  --files <경로조각>  |  --with <경로조각>  |  --open  |  --check  |  --promote [정본문서]');
    console.error(`현재 누적 ${recs.length}건`);
    process.exit(1);
  }
  const stale = (r) => (r.validTo ? `   ⚠️ 낡음 — ${r.validTo} 에 대체됨` : '');

  // 승격 후보 — 반복 등장하는 용어는 정본 문서로 올린다
  if (args[0] === '--promote') {
    const doc = args[1];
    const docText = doc && existsSync(doc) ? readFileSync(doc, 'utf8') : null;
    const freq = new Map();
    for (const r of recs) {
      for (const k of termKeys(r)) {
        if (!freq.has(k)) freq.set(k, { n: 0, means: new Set() });
        const e = freq.get(k);
        e.n++;
        for (const [kk, v] of termPairs(r)) if (kk === k) e.means.add(v);
      }
    }
    const ranked = [...freq.entries()].sort((a, b) => b[1].n - a[1].n);
    const THRESHOLD = 3;
    const cand = ranked.filter(([k, e]) => e.n >= THRESHOLD && (!docText || !docText.includes(k)));

    console.log(`용어 ${ranked.length}종 (기록 ${recs.length}건)`);
    if (doc && !docText) console.log(`⚠️ 정본 문서를 못 찾았다: ${doc} — 중복 검사를 건너뛴다`);
    console.log(`\n── 승격 후보 (${THRESHOLD}회 이상${docText ? ' · 정본에 아직 없음' : ''}) ──`);
    if (!cand.length) console.log('  없다.');
    for (const [k, e] of cand) {
      console.log(`  ${e.n}회  ${k}${e.means.size ? `  → ${[...e.means][0]}` : '  ⚠️ 의미 미기록'}`);
    }
    console.log(`\n── 전체 빈도 (상위 12) ──`);
    for (const [k, e] of ranked.slice(0, 12)) {
      const inDoc = docText ? (docText.includes(k) ? '✅정본' : '  ') : '  ';
      console.log(`  ${String(e.n).padStart(2)}회 ${inDoc}  ${k}`);
    }
    process.exit(0);
  }

  if (args[0] === '--files') {
    const hits = findByFile(recs, args.slice(1).join(' '));
    if (!hits.length) { console.log(`「${args.slice(1).join(' ')}」를 만진 기록이 없다.`); process.exit(0); }
    console.log(`이 파일을 만진 요구 ${hits.length}건\n`);
    for (const r of hits) console.log(`  ${r.date}  ${r.req}${stale(r)}`);
    console.log(`\n⇒ 같이 움직이는 파일: node .harness/tools/graph-find.mjs --with ${args.slice(1).join(' ')}`);
    process.exit(0);
  }

  // 2홉 — 「이 파일을 고치면 무엇이 같이 움직이나」
  if (args[0] === '--with') {
    const needle = args.slice(1).join(' ');
    if (!needle) { console.error('사용법: --with <경로조각>'); process.exit(1); }
    const { hits, co } = coChange(recs, needle);
    if (!hits.length) { console.log(`「${needle}」를 만진 기록이 없다.`); process.exit(0); }
    console.log(`「${needle}」를 만진 요구 ${hits.length}건에서 같이 움직인 파일\n`);
    if (!co.length) { console.log('  단독으로만 등장한다.'); process.exit(0); }
    // 1회뿐인 동반은 우연이다 — 반복된 것만 보여준다. 전부 보려면 --all
    const all = args.includes('--all');
    const shown = all ? co : co.filter(([, e]) => e.n > 1);
    for (const [f, e] of (shown.length ? shown : co)) {
      const rate = Math.round((e.n / hits.length) * 100);
      console.log(`  ${String(e.n).padStart(2)}/${hits.length}  ${rate === 100 ? '⛔항상' : rate >= 60 ? '⭐자주' : '     '}  ${f}`);
    }
    const hidden = co.length - shown.length;
    if (!all && shown.length && hidden > 0) console.log(`  … 1회만 동반한 파일 ${hidden}개 생략 (--all 로 전부)`);
    const always = co.filter(([, e]) => e.n === hits.length);
    if (always.length) console.log(`\n⛔ 위 ⛔항상 표시는 예외 없이 같이 바뀐 파일이다 — 한쪽만 고치면 조용히 어긋난다.`);
    process.exit(0);
  }

  // 열린 작업 목록 — 훅은 주제가 겹칠 때만 붙여 주므로 「뭐 하다 말았나」는 여기서 본다
  if (args[0] === '--open') {
    const gone2 = new Set(recs.flatMap(sup));
    const open = recs.filter((r) => !gone2.has(r.req) && (r.note || '').startsWith('⏸'));
    console.log(open.length ? `⏸ 열린 작업 ${open.length}건` : '열린 작업 없음.');
    for (const r of open) console.log(`\n⏸ ${r.date} ${r.req}\n   ${r.note || ''}`);
    process.exit(0);
  }

  // 무결성 검증 — 문자열 참조로 잇는 구조의 유일한 약점을 시끄럽게 만든다
  if (args[0] === '--check') {
    const { problems, gone, noRecorded, retro, stale, unmarked, dupTerms } = check(recs, { fileExists: (f) => existsSync(f) });
    console.log(`기록 ${recs.length}건 · 대체 사슬 ${recs.filter((r) => r.supersedes).length}건\n`);
    console.log('── 사슬 무결성 ──');
    if (!problems.length) console.log('  이상 없음.');
    for (const [kind, msg] of problems) console.log(`  ⛔ ${kind}: ${msg}`);
    console.log('\n── 경로 무결성 (그래프가 코드보다 낡았나) ──');
    if (!gone.length) console.log(`  이상 없음 — 참조 경로 전부 존재.`);
    for (const [r, f] of gone) console.log(`  ⛔ 없는 경로  ${f}\n              ← ${r.date} ${r.req.slice(0, 44)}`);
    console.log('\n── 용어 선점 (낡은 값이 최신을 밀어내나) ──');
    console.log(`  중복 용어 ${dupTerms}개 중 과거가 1위인 것 ${stale.length}개`);
    for (const x of stale) {
      console.log(`  ⛔ 「${x.k}」 1위=${x.top.date} < 최신=${x.newest.date} (${x.n}개 기록)`);
      console.log(`       1위 : ${x.top.req.slice(0, 60)}`);
      console.log(`       최신 : ${x.newest.req.slice(0, 60)}`);
      console.log(`       ⇒ 1위 기록의 값이 낡았으면 supersedes 로 무효화하거나 그 용어 키를 뺀다`);
    }
    console.log('\n── 열린 작업 표식 (하다 만 것이 훅에 잡히나) ──');
    if (!unmarked.length) console.log('  이상 없음 — 표식 누락 후보 없음.');
    for (const r of unmarked) {
      console.log(`  ⚠️ ${r.date} ${r.req.slice(0, 56)}`);
      console.log(`       ⇒ 아직 하다 만 것이면 note 앞에 ⏸ 를 붙인다 (훅이 순위 밖이어도 붙여 준다). 끝난 것이면 그냥 둔다`);
    }
    console.log('\n── 시간 ──');
    console.log(`  recorded 없음 ${noRecorded.length}건 (구 기록 — 순서는 줄 번호로 판정한다)`);
    console.log(`  소급 기록 ${retro.length}건 (date < recorded — 정상이다, 과거를 나중에 적은 것)`);
    process.exit(problems.length || gone.length || stale.length ? 1 : 0);
  }

  // ⛔ 대체된 기록은 기본 제외(--all 로 포함). 정렬: 정확일치 유무 → 점수 → 살아있는 기록 → 최신
  // 정확일치 먼저 — 합만으로 세우면 1위가 정확일치 0 인 비율 39%, 첫 키로 바꾼 뒤 11%(본문 질의 75건). 바꾸려면 다시 잰다
  const all = args.includes('--all');
  args = args.filter((a) => a !== '--all');
  const pool = all ? recs : recs.filter((r) => !r.validTo);
  const rank = (qs) => pool.map((r) => ({ r, ...scoreDetail(r, qs) })).filter((x) => x.s > 0)
    .sort((a, b) => (b.exact > 0 ? 1 : 0) - (a.exact > 0 ? 1 : 0) || b.s - a.s
      || (a.r.validTo ? 1 : 0) - (b.r.validTo ? 1 : 0)
      || String(b.r.date).localeCompare(String(a.r.date)));
  let queries = args;
  let ranked = rank(queries);
  // 문장을 통째로 주면 한 덩어리 부분일치라 0건이 난다 — 0건이고 공백이 있으면 훅과 같은 토크나이저로 다시 찾는다
  if (!ranked.length && args.some((a) => /\s/.test(a))) {
    const sentence = args.join(' ');
    queries = [...tokenizeKo(sentence), ...tokenizeIds(sentence)];
    ranked = rank(queries);
    if (ranked.length) console.log(`(문장을 토큰 ${queries.length}개로 나눠 다시 찾았다)\n`);
  }
  if (!ranked.length) {
    console.log(`「${args.join(' ')}」로 걸리는 과거 요구가 없다 (누적 ${recs.length}건).`);
    console.log('⇒ 새 영역이다. 평소대로 코드를 탐색하고, 알아낸 뒤 사용자가 쓴 말을 graph-alias 로 등록한다.');
    process.exit(0);
  }

  console.log(`유사 요구 ${ranked.length}건 (누적 ${recs.length}건 중${all ? '' : ', 대체된 기록 제외 — 전부 보려면 --all'})\n`);
  for (const { r, s } of ranked.slice(0, 5)) {
    console.log(`[점수 ${s}] ${r.date}  ${r.req}${stale(r)}`);
    const pairs = termPairs(r);
    if (pairs.length) for (const [k, v] of pairs) console.log(`  용어  ${k} → ${v}`);
    else if (termKeys(r).length) console.log(`  용어  ${termKeys(r).join(' · ')}`);
    for (const t of r.tables || []) console.log(`  DB    ${t}`);
    for (const f of r.files || []) console.log(`  파일  ${f}`);
    if (r.note) console.log(`  ⚠️ ${r.note}`);
    console.log();
  }

  // 기능 이력 — 같은 용어가 여러 번 나오면 최신순으로. 「그 뒤에 바뀌었나」가 가장 자주 필요한 질문이다
  for (const q of args) {
    const hist = recs
      .filter((r) => termKeys(r).some((k) => k.toLowerCase() === q.toLowerCase()))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (hist.length < 2) continue;
    console.log(`── 「${q}」 이력 ${hist.length}건 (최신순) ──`);
    hist.forEach((r, i) => {
      console.log(`  ${r.date}  ${i === 0 ? '⭐최신' : r.validTo ? '⚠️낡음' : '     '}  ${r.req}`);
      if (r.validTo) console.log(`            ↓ ${r.validTo} 에 대체됨: ${r.supersededBy.req.slice(0, 46)}`);
      if (sup(r).length) console.log(`            ↑ 이전을 대체: ${sup(r).join(' · ')}`);
    });
    console.log('⚠️ 최신 것부터 본다 — 아래쪽은 그 뒤에 바뀌었을 수 있다.\n');
  }

  // 상위 결과의 파일 빈도 — 「이 주제는 늘 여기부터」
  const freq = new Map();
  for (const { r } of ranked.slice(0, 5)) for (const f of r.files || []) freq.set(f, (freq.get(f) || 0) + 1);
  const hot = [...freq.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  if (hot.length) {
    console.log('── 반복 등장 파일 ──');
    for (const [f, n] of hot) console.log(`  ${n}회  ${f}`);
  }
}

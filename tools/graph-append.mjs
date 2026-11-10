#!/usr/bin/env node
// 요구 → 용어·파일 간선을 append-only 로 기록한다. 자동 로드되지 않아 무한히 커져도 세션 비용이 0이다. 설계안.
//   node .harness/tools/graph-append.mjs <<'EOF'      # stdin JSON (Windows 인용 문제를 피한다) · 여러 줄 JSONL 도 받는다
//   {"req":"<요구 한 줄>","terms":{"<현업 용어>":"<시스템에서 무엇인가>"},"files":["<경로>"],"note":"<함정 한 줄>"}
//   EOF
// date 는 세상 시간(작업이 일어난 때), recorded 는 기록 시간 — 둘 다 오늘이 기본이고, 소급할 때만 date 를 준다.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { STORE, offRepo } from './graph-find.mjs';

const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
// 경로에 붙인 `:256` 줄번호는 존재 검사와 역방향 조회를 빗나가게 한다
const paths = (v) => strs(v).map((f) => f.replace(/:\d+(-\d+)?$/, ''));

// note 상한 — 이 PC 그래프 4곳 note 346개: 중앙 324 · p90 711자 · 800 초과 31개(9%). 자기를 뺀 1위를 가장 많이 가로챈 기록(1,132자)이 걸린다. 바꾸려면 다시 잰다
export const NOTE_MAX = 800;

export function normalize(rec, today) {
  if (!rec || typeof rec.req !== 'string' || !rec.req.trim()) {
    throw new Error('req 는 필수다 (사용자 요구를 한 줄로)');
  }
  // 긴 note 는 낱말이 많아 다른 질문의 훅 1위를 가로챈다(설치 실측: 1,102자 기록이 상위3 점유 81%)
  if (rec.note && /[\r\n]/.test(rec.note)) throw new Error('note 는 한 줄이다 — 함정 · 기각한 대안을 줄바꿈 없이');
  if (rec.note && rec.note.length > NOTE_MAX) throw new Error(`note 가 ${rec.note.length}자다 — ${NOTE_MAX}자까지. 긴 note 는 다른 질문의 1위를 가로챈다 — 주제별 기록으로 나누거나 줄인다`);
  // terms 는 객체가 권장이다. 배열도 받고(구 기록), 없으면 req 의 한글 토큰에서 뽑는다
  let terms = rec.terms;
  if (terms && !Array.isArray(terms) && typeof terms === 'object') {
    terms = Object.fromEntries(Object.entries(terms).filter(([k, v]) => k.trim() && typeof v === 'string'));
  } else {
    const arr = strs(terms);
    terms = arr.length ? arr : [...new Set(rec.req.match(/[가-힣]{2,}/g) || [])];
  }
  const out = {
    date: rec.date || today,           // 세상 시간
    recorded: rec.recorded || today,   // 기록 시간 — supersedes 순서는 이쪽으로 판정한다
    req: rec.req.trim(),
    terms,
    ...(strs(rec.tables).length ? { tables: strs(rec.tables) } : {}),
    files: paths(rec.files),
    // 이전 기록을 무효화하면 그 req 를 적는다 — 문자열 1개 또는 배열
    ...(rec.supersedes ? { supersedes: Array.isArray(rec.supersedes) ? strs(rec.supersedes) : String(rec.supersedes) } : {}),
    ...(rec.note ? { note: rec.note } : {}),
    ...(typeof rec.scope === 'string' && rec.scope ? { scope: rec.scope } : {}),
  };
  // 기록하지 않는 길을 먼저 보인다 — 통과하려고 상관없는 파일을 채워 넣으면 검사는 지나도 기록은 나빠진다
  if (offRepo(out)) throw new Error('이 저장소의 파일 · 테이블을 하나도 가리키지 않는다. 이 저장소의 지식이 아니면 기록하지 않는다(도구 지식이면 보고에 「기록 안 함」 한 줄). 이 저장소가 무엇을 들이고 뺐나의 결정이면 "scope":"meta" 를 넣는다');
  return out;
}

// toISOString() 은 UTC 라 자정~오전 작업이 하루 전으로 기록된다 — 로컬 날짜를 쓴다
const localToday = () => new Date().toLocaleDateString('sv-SE');

export function appendRecord(rec, { store = STORE, today } = {}) {
  const out = normalize(rec, today || localToday());
  mkdirSync(dirname(store), { recursive: true });
  appendFileSync(store, JSON.stringify(out) + '\n', 'utf8');
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('graph-append.mjs')) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    if (!raw.trim()) { console.error('⛔ stdin 으로 JSON 을 준다. 사용법은 파일 머리 주석 참조.'); process.exit(1); }
    // 줄마다 JSON(JSONL), 아니면 전체가 객체 하나(여러 줄로 편 JSON). ⛔ 하나라도 거부되면 아무것도 쓰지 않는다 — 반쯤 쓰면 다시 돌릴 때 겹친다
    let recs;
    try {
      let input;
      try { input = raw.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l)); } catch { input = [JSON.parse(raw)]; }
      const today = localToday();
      recs = input.map((r) => normalize(r, today));
    } catch (e) { console.error(`⛔ ${e.message} — 아무것도 쓰지 않았다`); process.exit(1); }
    mkdirSync(dirname(STORE), { recursive: true });
    appendFileSync(STORE, recs.map((r) => `${JSON.stringify(r)}\n`).join(''), 'utf8');
    for (const out of recs) console.log(`+ ${out.date}  ${out.req.slice(0, 44)}  (파일 ${out.files.length})`);
    console.log(`기록 ${recs.length}건 추가 · 누적 ${readFileSync(STORE, 'utf8').trim().split('\n').filter(Boolean).length}건`);
  });
}

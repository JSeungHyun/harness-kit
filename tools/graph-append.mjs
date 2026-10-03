#!/usr/bin/env node
// 요구 → 용어·파일 간선을 append-only 로 기록한다. 자동 로드되지 않아 무한히 커져도 세션 비용이 0이다. 설계안.
//   node .harness/tools/graph-append.mjs <<'EOF'      # stdin JSON (Windows 인용 문제를 피한다) · 여러 줄 JSONL 도 받는다
//   {"req":"<요구 한 줄>","terms":{"<현업 용어>":"<시스템에서 무엇인가>"},"files":["<경로>"],"note":"<함정 한 줄>"}
//   EOF
// date 는 세상 시간(작업이 일어난 때), recorded 는 기록 시간 — 둘 다 오늘이 기본이고, 소급할 때만 date 를 준다.
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { STORE } from './graph-find.mjs';

const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
// 경로에 붙인 `:256` 줄번호는 존재 검사와 역방향 조회를 빗나가게 한다
const paths = (v) => strs(v).map((f) => f.replace(/:\d+(-\d+)?$/, ''));

export function normalize(rec, today) {
  if (!rec || typeof rec.req !== 'string' || !rec.req.trim()) {
    throw new Error('req 는 필수다 (사용자 요구를 한 줄로)');
  }
  // terms 는 객체가 권장이다. 배열도 받고(구 기록), 없으면 req 의 한글 토큰에서 뽑는다
  let terms = rec.terms;
  if (terms && !Array.isArray(terms) && typeof terms === 'object') {
    terms = Object.fromEntries(Object.entries(terms).filter(([k, v]) => k.trim() && typeof v === 'string'));
  } else {
    const arr = strs(terms);
    terms = arr.length ? arr : [...new Set(rec.req.match(/[가-힣]{2,}/g) || [])];
  }
  return {
    date: rec.date || today,           // 세상 시간
    recorded: rec.recorded || today,   // 기록 시간 — supersedes 순서는 이쪽으로 판정한다
    req: rec.req.trim(),
    terms,
    ...(strs(rec.tables).length ? { tables: strs(rec.tables) } : {}),
    files: paths(rec.files),
    // 이전 기록을 무효화하면 그 req 를 적는다 — 문자열 1개 또는 배열
    ...(rec.supersedes ? { supersedes: Array.isArray(rec.supersedes) ? strs(rec.supersedes) : String(rec.supersedes) } : {}),
    ...(rec.note ? { note: rec.note } : {}),
  };
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
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    let n = 0;
    for (const l of lines) {
      try {
        const out = appendRecord(JSON.parse(l));
        console.log(`+ ${out.date}  ${out.req.slice(0, 44)}  (파일 ${out.files.length})`);
        n++;
      } catch (e) {
        // 한 줄 JSON 이 아니면 전체를 하나의 객체로 재시도한다
        if (lines.length === 1) { console.error(`⛔ ${e.message}`); process.exit(1); }
        console.error(`⛔ 건너뜀: ${e.message}`);
      }
    }
    if (lines.length > 1 && n === 0) {
      try { const out = appendRecord(JSON.parse(raw)); console.log(`+ ${out.date}  ${out.req.slice(0, 44)}`); n = 1; }
      catch (e) { console.error(`⛔ ${e.message}`); process.exit(1); }
    }
    const total = existsSync(STORE) ? readFileSync(STORE, 'utf8').trim().split('\n').filter(Boolean).length : 0;
    console.log(`기록 ${n}건 추가 · 누적 ${total}건`);
  });
}

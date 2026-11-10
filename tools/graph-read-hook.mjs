#!/usr/bin/env node
// PostToolUse(Read) 훅 — 모델이 연 파일을 가리키는 살아있는 기록을 상한 걸린 양만 붙인다(⏸ · 최신 정본 1건 · 함정 1줄). 설계안.
// 말로 못 꺼내는 기록(꺼낼 키가 없음 · 두 글자 질의)을 파일 키로 꺼낸다. 세션(에이전트)마다 파일 · 기록 한 번 · 같은 턴에 프롬프트 훅이 붙인 기록은 뺀다. 실패는 조용히 통과
import { readFileSync, writeFileSync, mkdirSync, openSync, readSync, fstatSync, closeSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load, index } from './graph-find.mjs';

// 실경로끼리 비교한다 — Windows 짧은 이름(IDEAPA~1)과 긴 이름이 섞여 온다
const real = (p) => { try { return realpathSync.native(p); } catch { return p; } };
const ROOT = real(fileURLToPath(new URL('../../', import.meta.url)));
// 이보다 많이 걸린 파일은 건수만 — 기록이 큰 파일에 몰려 「광역 독점」이 파일 축에서 다시 생긴다(원천: 10건 넘게 걸린 파일 11개)
const MANY = 10;
const OPEN_MAX = 3;
const NOTE_MAX = 200;

const key = (p) => String(p).replace(/\\/g, '/').replace(/:\d+(-\d+)?$/, '').toLowerCase();
const isOpen = (r) => (r.note || '').startsWith('⏸');
const clip = (s) => { const t = String(s).split('\n')[0]; return t.length > NOTE_MAX ? `${t.slice(0, NOTE_MAX)} …` : t; };
// 날짜가 같으면 뒤에 쓴 줄이 최신이다
const latest = (recs) => recs.reduce((a, r) => (!a || (r.date || '') >= (a.date || '') ? r : a), null);

// 그 파일을 가리키는 기록 — 경로가 통째로 같아야 한다(폴더 · 조각 일치는 광역이라 뺀다)
export const recordsFor = (recs, rel) => recs.filter((r) => (r.files || []).some((f) => key(f) === key(rel)));

// 카드 — shown: 이 세션에 이미 붙인 기록 · injected: 이번 턴 프롬프트 훅 출력
export function fileCard(recs, rel, { shown = new Set(), injected = '' } = {}) {
  const all = recordsFor(recs, rel);
  const more = `node .harness/tools/graph-find.mjs --files ${rel}`;
  const open = all.filter(isOpen);
  const head = `[그래프 · 파일] ${rel} — 이 파일을 가리키는 기록 ${all.length}건${open.length ? `(⏸ ${open.length})` : ''}`;
  if (all.length > MANY) return { text: `${head} — 많아서 건수만. 전부: ${more}`, reqs: [] };
  const fresh = all.filter((r) => !shown.has(r.req) && !injected.includes(r.req));
  if (!fresh.length) return { text: '', reqs: [] };
  const done = fresh.filter((r) => !isOpen(r));
  const canon = latest(done.filter((r) => /^정본:/.test(r.req))) ?? latest(done);
  const wait = fresh.filter(isOpen).slice(0, OPEN_MAX);
  const out = [`${head} · 지금 작업과 무관하면 무시한다`];
  if (canon) out.push(`· ${canon.date} ${canon.req}`, ...(canon.note ? [`    ⚠️ 함정: ${clip(canon.note)}`] : []));
  for (const r of wait) out.push(`⏸ ${r.date} ${r.req}`, `    ${clip(r.note.replace(/^⏸\s*/, ''))}`);
  const rest = fresh.length - (canon ? 1 : 0) - wait.length;
  if (rest > 0) out.push(`그 밖 ${rest}건 — ${more}`);
  return { text: out.join('\n'), reqs: [...(canon ? [canon.req] : []), ...wait.map((r) => r.req)] };
}

// 이번 턴에 프롬프트 훅들이 붙인 글 — 세션 기록 끝 8MB 를 턴 시작(사람 입력 · 대기열 입력)까지 거슬러 읽는다. 그 안에 턴 시작이 없으면 거기까지만(중복 한 번이 침묵보다 싸다)
const TAIL_MAX = 8 << 20;
const turnStart = (j) => j.attachment?.type === 'queued_command'
  || (j.type === 'user' && !j.isMeta && (typeof j.message?.content === 'string' || (j.message?.content ?? []).some?.((c) => c.type === 'text')));
export function turnInjection(path) {
  const texts = [];
  for (const line of tailLines(path)) {
    if (!/"UserPromptSubmit"|"queued_command"|"type":"user"/.test(line)) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.attachment?.hookEvent === 'UserPromptSubmit') texts.push(typeof j.attachment.content === 'string' ? j.attachment.content : JSON.stringify(j.attachment.content ?? ''));
    else if (turnStart(j)) break;
  }
  return texts.join('\n');
}
function tailLines(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const n = Math.min(size, TAIL_MAX);
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, size - n);
    const lines = buf.toString('utf8').split('\n');
    if (n < size) lines.shift(); // 잘린 첫 줄
    return lines.reverse();
  } finally {
    closeSync(fd);
  }
}

const statePath = (input) => join(tmpdir(), 'harness-read-hook', `${`${input.session_id}-${input.agent_id || 'main'}`.replace(/[^\w-]/g, '_')}.json`);
function readState(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { files: [], reqs: [] }; }
}

function run(input) {
  const file = input?.tool_input?.file_path;
  if (typeof file !== 'string' || !input.session_id) return '';
  const rel = relative(ROOT, real(file)).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return '';
  const recs = index(load()).filter((r) => !r.supersededBy);
  // 대부분의 파일은 기록이 없다 — 상태 · 세션 기록을 읽기 전에 끝낸다
  if (!recordsFor(recs, rel).length) return '';
  const p = statePath(input);
  const st = readState(p);
  if (st.files.includes(key(rel))) return '';
  // 서브에이전트는 메인 턴의 주입을 보지 못했다 · 세션 기록을 못 읽으면 빼지 않고 붙인다
  let injected = '';
  if (!input.agent_id && input.transcript_path) try { injected = turnInjection(input.transcript_path); } catch { /* 빼지 않는다 */ }
  const { text, reqs } = fileCard(recs, rel, { shown: new Set(st.reqs), injected });
  if (text) st.files.push(key(rel));
  st.reqs.push(...reqs);
  mkdirSync(join(tmpdir(), 'harness-read-hook'), { recursive: true });
  writeFileSync(p, JSON.stringify(st));
  return text;
}

// 시간 상한은 정책의 timeout — 넘은 훅은 읽기를 막지 않는다
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(raw || '{}');
      const text = run(input);
      if (text) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }));
    } catch { /* 실패는 조용히 통과 — 읽기를 막지 않는다 */ }
    process.exit(0);
  });
}

#!/usr/bin/env node
// 서브에이전트(Agent · Task)를 한 세션에서 동시에 MAX 개까지만 — 셋째 호출은 거부한다. 설계안.
// 이벤트는 입력의 hook_event_name 으로 가른다: PreToolUse(예약) → SubagentStart(예약을 도는 것으로) → SubagentStop(지움)
// PreToolUse 와 SubagentStart 를 잇는 칸이 없다(실측) — 같은 종류의 가장 오래된 예약을 잇는다. 훅 실패는 조용히 통과한다
import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const MAX = 2;
const RESERVE_MS = 60_000; // 허락했는데 시작하지 않은 예약(다른 훅 · 권한이 거부한 호출)은 이만큼만 자리를 찬다
const FORGET_MS = 3 * 60 * 60_000; // 끝 소식이 없는 기록(세션이 죽은 경우)
const FREE = new Set(['web-fetch']); // 웹 읽기 대용 — 세지 않는다
const DIR = join(tmpdir(), 'harness-agent-cap');

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// mkdir 잠금 — 병렬 호출이 동시에 읽고 쓰지 않게. 못 잡으면 null(통과)
function lock(path) {
  for (let i = 0; i < 40; i++) {
    try { mkdirSync(path); return true; } catch { /* 잡힌 잠금 */ }
    try { if (Date.now() - statSync(path).mtimeMs > 5000) rmSync(path, { recursive: true, force: true }); } catch { /* 방금 풀림 */ }
    sleep(25);
  }
  return false;
}

function load(file, now) {
  let s = {};
  try { s = JSON.parse(readFileSync(file, 'utf8')); } catch { /* 없거나 깨짐 — 새로 */ }
  // 미래 시각은 버린다 — 시계가 어긋나 남은 기록이 자리를 영영 차지하지 않게
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && Number.isFinite(x.t) && x.t <= now) : []);
  return {
    running: list(s.running).filter((x) => now - x.t < FORGET_MS),
    reserved: list(s.reserved).filter((x) => now - x.t < RESERVE_MS),
  };
}

// 같은 종류의 가장 오래된 것 — 없으면(종류가 달라도) 가장 오래된 것
const oldest = (list, type) => {
  const same = list.findIndex((x) => x.type === type);
  return same >= 0 ? same : list.length ? 0 : -1;
};

function handle(input, file, now) {
  const st = load(file, now);
  const type = input.tool_input?.subagent_type ?? input.agent_type ?? 'general-purpose';
  if (FREE.has(type)) return null;
  let out = null;
  if (input.hook_event_name === 'PreToolUse') {
    const n = st.running.length + st.reserved.length;
    if (n >= MAX) {
      out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `서브에이전트는 동시에 최대 ${MAX}개 — 지금 ${n}개가 돈다. 그것이 끝난 뒤 다시 부른다.` } };
    } else {
      st.reserved.push({ type, t: now });
    }
  } else if (input.hook_event_name === 'SubagentStart') {
    const i = oldest(st.reserved, type);
    if (i >= 0) st.reserved.splice(i, 1);
    st.running.push({ id: input.agent_id ?? null, type, t: now });
  } else {
    // agent_id 가 있는데 기록에 없으면 아무것도 지우지 않는다 — 없을 때만 같은 종류의 가장 오래된 것
    const i = input.agent_id ? st.running.findIndex((x) => x.id === input.agent_id) : oldest(st.running, type);
    if (i >= 0) st.running.splice(i, 1);
  }
  writeFileSync(file, JSON.stringify(st));
  return out;
}

function main(raw) {
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  const ev = input?.hook_event_name;
  if (!['PreToolUse', 'SubagentStart', 'SubagentStop'].includes(ev) || typeof input.session_id !== 'string' || !input.session_id) return;
  if (ev === 'PreToolUse' && !['Agent', 'Task'].includes(input.tool_name)) return;
  const sid = input.session_id.replace(/[^\w-]/g, '_');
  const lockDir = join(DIR, `${sid}.lock`);
  mkdirSync(DIR, { recursive: true });
  if (!lock(lockDir)) return;
  try {
    const out = handle(input, join(DIR, `${sid}.json`), Date.now());
    if (out) process.stdout.write(JSON.stringify(out));
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  try { main(raw); } catch { /* 훅 실패는 막지 않는다 */ }
});

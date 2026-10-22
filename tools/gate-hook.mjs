#!/usr/bin/env node
// Stop 훅 — 이번 턴에 verify 를 돌리고 final-gate 를 거치지 않았으면 한 번 되돌려 보낸다. 설계안.
// 실측(설치 3곳 6세션): 코드를 바꾼 턴에 verify 5/5 · final-gate 0/7 — 빠지는 것은 verify 가 아니라 관문이다.
// verify 는 「끝내려 한다」는 신호로만 쓴다 — 훅에서 다시 돌리지 않는다(중앙 50초). 실패는 조용히 통과 — 종료를 막지 않는다.
import { readFileSync } from 'node:fs';

// 되돌리는 시점은 보고를 쓴 뒤다 — 다시 쓰게 하지 않고 빠진 단계만 채우게 한다(실제 기록: 코드 턴 대부분은 내용을 이미 했다)
const REASON = '[관문] 이번 턴에 verify 를 돌렸지만 final-gate 를 거치지 않았다. 작업을 끝냈다고 보고했으면 지금 final-gate 스킬을 불러 빠진 단계만 채운다 — 과설계 리뷰 · 증거 원문 · 파일 목록 · 기록. 이미 보고한 내용은 반복하지 않는다. 아직 진행 중이거나 사용자 답을 기다리는 중이면 그렇다고 한 줄 쓰고 멈춘다';

// 사람이 친 줄에서 끝까지가 이번 턴이다. 판정은 tool_use 만 본다 — 도구 결과 줄에는 파일 내용이 실려 오탐한다
function needsGate(lines) {
  let verified = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    // origin 이 없는 기록(-p · 2.1.292 이하)은 문자열 내용인 user 줄이 사람 입력이다
    if (o.type === 'user' && !o.isMeta && (o.origin ? o.origin.kind === 'human' : typeof o.message?.content === 'string')) {
      return verified && !/final-gate/.test(JSON.stringify(o.message?.content ?? ''));
    }
    if (o.type !== 'assistant' || !Array.isArray(o.message?.content)) continue;
    for (const c of o.message.content) {
      if (c.type !== 'tool_use') continue;
      if (c.name === 'Skill' && /(^|:)final-gate$/.test(c.input?.skill ?? '')) return false;
      if (c.name === 'Bash' && /verify\.mjs/.test(c.input?.command ?? '') && !/--baseline/.test(c.input.command)) verified = true;
    }
  }
  return false;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    // 되돌린 뒤의 멈춤 · 백그라운드 작업을 기다리는 진행 보고에는 울리지 않는다
    if (!input.stop_hook_active && !input.background_tasks?.length
      && needsGate(readFileSync(input.transcript_path, 'utf8').split(/\r?\n/))) {
      console.log(JSON.stringify({ decision: 'block', reason: REASON }));
    }
  } catch { /* 실패는 조용히 통과 */ }
  process.exit(0);
});

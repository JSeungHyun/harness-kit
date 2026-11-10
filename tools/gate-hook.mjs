#!/usr/bin/env node
// Stop 훅 — 한 턴의 증거 세트(과설계 리뷰 · 덮지 않는 코드의 code-review · 마지막 변경 뒤 verify · final-gate)에서 빠진 것이 있으면 한 번 되돌려 보낸다. 설계안.
// 실측(설치 3곳 6세션): 코드를 바꾼 턴에 verify 5/5 · final-gate 0/7 — 빠지는 것은 모델의 기억에 맡긴 단계다(plan 11차).
// verify 는 「끝내려 한다」는 신호로만 쓴다 — 훅에서 다시 돌리지 않는다(중앙 50초). 실패는 조용히 통과 — 종료를 막지 않는다.
import { readFileSync } from 'node:fs';
import { relative, resolve, isAbsolute, posix, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 설치 위치(<대상>/.harness/tools/) 기준 — 훅의 cwd 는 세션이 옮긴 하위 폴더일 수 있다
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONFIG = new URL('../harness.json', import.meta.url);

// 되돌리는 시점은 보고를 쓴 뒤다 — 다시 쓰게 하지 않고 빠진 단계만 채우게 한다(실제 기록: 코드 턴 대부분은 내용을 이미 했다)
const GUIDE = '작업을 끝냈다고 보고했으면 지금 final-gate 스킬로 빠진 것만 채운다 — 범위 검토(코드를 바꿨으면 사용자 말 원문과 이번 diff 만 서브에이전트에 주고 요청 밖 변경을 묻는다 — 스스로 대조하지 않는다) · 과설계 리뷰 · 증거 원문 · 파일 목록 · 기록. 이미 보고한 내용은 반복하지 않는다. 아직 진행 중이거나 사용자 답을 기다리는 중이면 그렇다고 한 줄 쓰고 멈춘다';

const EDITS = { Edit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path' };
// 문서 · 하네스 기록 · 설정은 코드가 아니다
const NOT_CODE = /^\.(harness|claude)\/|\.(md|mdx|txt|rst|adoc)$/i;

function codeFile(u) {
  const p = u.input?.[EDITS[u.name]];
  if (!p) return null;
  const rel = relative(ROOT, resolve(ROOT, p)).replace(/\\/g, '/');
  // 프로젝트 밖(스크래치 스크립트 등)은 이 프로젝트의 코드가 아니다
  return isAbsolute(rel) || rel.split('/')[0] === '..' || NOT_CODE.test(rel) ? null : rel;
}

const toolUses = (o) => (o.type === 'assistant' && Array.isArray(o.message?.content) ? o.message.content.filter((c) => c.type === 'tool_use') : []);
const parse = (l) => { try { return JSON.parse(l); } catch { return {}; } };

// 서브에이전트의 파일 변경은 메인 기록에 없다 — <메인 기록 이름>/subagents/agent-<id>.jsonl 에서 그 Agent 호출 자리에 끼운다
function subagentEdits(transcript, agentId) {
  try {
    const lines = readFileSync(join(transcript.replace(/\.jsonl$/, ''), 'subagents', `agent-${agentId}.jsonl`), 'utf8').split(/\r?\n/);
    return lines.flatMap((l) => toolUses(parse(l)).filter((u) => u.name in EDITS));
  } catch { return []; }
}

// 사람이 친 줄에서 끝까지가 이번 턴이다. 판정은 tool_use 만 본다 — 도구 결과 줄에는 파일 내용이 실려 오탐한다
function turn(lines, transcript) {
  const uses = [];
  const agents = {};
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = parse(lines[i]);
    // origin 이 없는 기록(-p · 2.1.292 이하)은 문자열 내용인 user 줄이 사람 입력이다
    if (o.type === 'user' && !o.isMeta && (o.origin ? o.origin.kind === 'human' : typeof o.message?.content === 'string')) {
      return { said: JSON.stringify(o.message?.content ?? ''), uses: uses.reverse().flatMap((u) => [u, ...(agents[u.id] ? subagentEdits(transcript, agents[u.id]) : [])]) };
    }
    // Agent 결과 줄의 toolUseResult.agentId 가 서브에이전트 기록 이름이다(실측 133건 모두 파일이 있었다)
    if (o.type === 'user' && o.toolUseResult?.agentId) for (const c of o.message?.content ?? []) if (c.tool_use_id) agents[c.tool_use_id] = o.toolUseResult.agentId;
    uses.push(...toolUses(o).reverse());
  }
  return null;
}

function missing({ said, uses }, covers) {
  // 사람이 친 슬래시 명령도 부른 것으로 친다 · 플러그인 스킬은 「플러그인:이름」
  const called = (name) => said.includes(name) || uses.some((u) => u.name === 'Skill' && new RegExp(`(^|:)${name}$`).test(u.input?.skill ?? ''));
  const isVerify = (u) => u.name === 'Bash' && /verify\.mjs/.test(u.input?.command ?? '') && !/--baseline/.test(u.input.command);
  const code = uses.flatMap((u, at) => {
    const f = codeFile(u);
    return f ? [{ f, at, covered: covers.some((g) => posix.matchesGlob(f, g)) }] : [];
  });
  const out = [];
  if (code.length && !called('ponytail-review')) out.push('/ponytail-review (코드를 바꿨다)');
  const bare = [...new Set(code.filter((c) => !c.covered).map((c) => c.f))];
  if (bare.length && !called('code-review')) out.push(`/code-review (덮는 검사가 없는 코드: ${bare.slice(0, 3).join(', ')}${bare.length > 3 ? ' …' : ''})`);
  const last = Math.max(-1, ...code.filter((c) => c.covered).map((c) => c.at));
  if (last >= 0 && !uses.slice(last).some(isVerify)) out.push('verify (마지막 코드 변경 뒤)');
  if (uses.some(isVerify) && !called('final-gate')) out.push('final-gate');
  return out;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    // 되돌린 뒤의 멈춤 · 결과를 기다리는 진행 보고에는 울리지 않는다. 셸은 백그라운드 verify 만 기다림이다 — 상주 개발 서버도 shell 이라 그것만 떠 있으면 예외가 아니다(2.1.319 덤프: type shell · subagent)
    const waiting = (input.background_tasks ?? []).some((t) => t.type !== 'shell' || /verify\.mjs/.test(t.command ?? ''));
    if (!input.stop_hook_active && !waiting) {
      const t = turn(readFileSync(input.transcript_path, 'utf8').split(/\r?\n/), input.transcript_path);
      const covers = (JSON.parse(readFileSync(CONFIG, 'utf8')).checks ?? []).flatMap((c) => c.covers ?? []);
      const miss = t ? missing(t, covers) : [];
      if (miss.length) console.log(JSON.stringify({ decision: 'block', reason: `[관문] 이번 턴에 빠진 것: ${miss.join(' · ')}\n${GUIDE}` }));
    }
  } catch { /* 실패는 조용히 통과 */ }
  process.exit(0);
});

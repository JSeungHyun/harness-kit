#!/usr/bin/env node
// /exec-cycle · /exec-review 중에만 도는 종료 훅(스킬 앞머리의 Stop) — 마지막으로 부른 스킬 뒤에 코드를 고쳤으면(exec-review 는 안 고쳐도),
// 마지막 수정(없으면 호출) 뒤에 verify 통과와 ponytail 리뷰 결과가 둘 다 있어야 끝낸다. 없으면 {"decision":"block"}. 훅 실패는 막지 않는다. 설계안.
// 세션 기록은 줄 단위로 읽는다 — API 요청 사본 줄(수 MB)은 파싱하지 않는다
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { isAbsolute, relative } from 'node:path';

const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const START = /<command-name>\s*\/?(?:[\w-]+:)?(exec-cycle|exec-review)\s*<\/command-name>/;
// ponytail-review 스킬이 끝에 내는 줄 그대로
const REVIEW = /net:\s*-?\d+\s+lines?\s+possible|Lean already/i;

const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('\n') : '');

// 설계 단계가 쓰는 스펙 · 계획 문서와 설정은 코드 수정이 아니다 — 프로젝트 밖 · 문서 확장자 · .harness · .claude
function isCode(input, root) {
  const file = input?.file_path ?? input?.notebook_path;
  if (typeof file !== 'string') return true;
  const rel = relative(root, file).replace(/\\/g, '/');
  return !(rel.startsWith('..') || isAbsolute(rel) || /\.(md|mdx|txt|rst)$/i.test(rel) || /^\.(harness|claude)\//.test(rel));
}

// review: exec-review 는 수정이 없어도 증거를 요구한다
const state = (started, edited, review = false) => ({ started, edited, review, ran: false, verified: false, reviewed: false });

async function judge(path, root) {
  let s = state(false, false);
  const pending = new Set();
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || line.startsWith('{"type":"api-request')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if ((o.type !== 'user' && o.type !== 'assistant') || o.isSidechain) continue;
    const c = o.message?.content;
    const cmd = o.type === 'user' ? START.exec(text(typeof c === 'string' ? c : (c ?? []).filter((b) => b?.type === 'text'))) : null;
    if (cmd) {
      s = state(true, false, cmd[1] === 'exec-review');
      pending.clear();
    }
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (o.type === 'assistant' && b.type === 'text' && REVIEW.test(b.text ?? '')) s.reviewed = true;
      else if (o.type === 'user' && b.type === 'tool_result' && pending.delete(b.tool_use_id)) {
        s.ran = true;
        s.verified = !b.is_error && !/^⛔/m.test(text(b.content));
      } else if (o.type === 'assistant' && b.type === 'tool_use') {
        const called = b.name === 'Skill' ? /(?:^|:)(exec-cycle|exec-review)$/.exec(b.input?.skill ?? '') : null;
        if (called) {
          s = state(true, false, called[1] === 'exec-review');
          pending.clear();
        } else if (EDITS.has(b.name) && s.started && isCode(b.input, root)) {
          s = state(true, true, s.review);
          pending.clear();
        } else if (b.name === 'Bash' && /verify\.mjs/.test(b.input?.command ?? '') && !/--baseline/.test(b.input.command)) {
          pending.add(b.id);
        }
      }
    }
  }
  return s;
}

async function main(raw) {
  const input = JSON.parse(raw);
  if (input.agent_id || typeof input.transcript_path !== 'string') return;
  const s = await judge(input.transcript_path, input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  if (!s.started || !(s.edited || s.review)) return;
  const need = [];
  if (!s.verified) need.push(s.ran ? '마지막 수정 뒤 verify 가 통과하지 않았다 — 고치고 `node .harness/tools/verify.mjs` 를 exit 0 까지 다시 돌린다' : '마지막 수정 뒤 verify 가 없다 — `node .harness/tools/verify.mjs` 를 돌린다');
  if (!s.reviewed && !REVIEW.test(input.last_assistant_message ?? '')) need.push('ponytail 과설계 리뷰 결과가 없다 — `node .harness/tools/cycle-skill.mjs ponytail ponytail-review` 가 낸 파일을 읽고 리뷰해 보고에 `net: -N lines possible.` 또는 `Lean already.` 줄을 낸다');
  if (!need.length) return;
  process.stdout.write(JSON.stringify({ decision: 'block', reason: `${s.edited ? '/exec-cycle · /exec-review 중 코드를 고쳤는데' : '/exec-review 는 검증 전용이라 수정이 없어도'} 끝낼 증거가 빠졌다 — ${need.join(' · ')}. 같은 이유로 계속 막히면 사용자에게 묻고 멈춘다(무엇이 막혔는지 말한다).` }));
}

let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  main(raw).catch(() => { /* 훅 실패는 막지 않는다 */ });
});

#!/usr/bin/env node
// /exec-cycle · /exec-review 중에만 도는 종료 훅(스킬 앞머리의 Stop) — 마지막으로 부른 스킬 뒤에 코드를 고쳤으면(exec-review 는 안 고쳐도),
// 마지막 수정(없으면 호출) 뒤에 verify 통과와 ponytail 리뷰 결과가 둘 다 있어야 끝낸다. 없으면 {"decision":"block"}. 훅 실패는 막지 않는다. 설계안.
// verify 는 verify 가 덮는(covers) 파일을 고쳤을 때만 요구한다(covers 가 하나도 없으면 모든 코드 수정). 마지막 줄이 「⏸ 사용자 대기 — 이유」면 완료가 아니라 대기라 막지 않는다
// 세션 기록은 줄 단위로 읽는다 — API 요청 사본 줄(수 MB)은 파싱하지 않는다
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { isAbsolute, relative } from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { globMatch } from './detect.mjs';

const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const START = /<command-name>\s*\/?(?:[\w-]+:)?(exec-cycle|exec-review)\s*<\/command-name>/;
// ponytail-review 스킬이 끝에 내는 줄 그대로
const REVIEW = /net:\s*-?\d+\s+lines?\s+possible|Lean already/i;
// 사용자 행동을 기다리며 멈출 때 스킬이 마지막 줄에 적게 하는 표지 — 사용자 눈에 보인다
const WAIT = /^⏸ 사용자 대기 — \S/;
// node 로 verify 를 실행하는 꼴만 — cat · grep 처럼 파일을 읽는 명령은 아니다
const RUNS_VERIFY = /(?:^|[;&|(\n])\s*node\s+(?:-\S+\s+)*["']?\S*verify\.mjs/;
// 서브에이전트가 고치는 것은 기록에 안 남는다 — 읽기 전용 종류를 뺀 호출은 경로를 모르는 수정으로 친다
const AGENTS = new Set(['Agent', 'Task']);
const READ_ONLY_AGENTS = new Set(['Explore', 'Plan', 'claude-code-guide']);
const WIN = process.platform === 'win32';

const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('\n') : '');

// 설계 단계가 쓰는 스펙 · 계획 문서와 설정은 코드 수정이 아니다 — 프로젝트 밖 · 문서 확장자 · .harness · .claude. rel: 프로젝트 기준 경로(모르면 null)
function codeEdit(input, root) {
  const file = input?.file_path ?? input?.notebook_path;
  if (typeof file !== 'string') return { code: true, rel: null };
  const rel = relative(root, file).replace(/\\/g, '/');
  return { code: !(rel.startsWith('..') || isAbsolute(rel) || /\.(md|mdx|txt|rst)$/i.test(rel) || /^\.(harness|claude)\//.test(rel)), rel };
}

// 검사들의 covers 모음 · 검사 id — 설정을 못 읽거나 하나도 없으면 빈 목록(= 모든 코드 수정이 verify 대상)
function checkInfo(root) {
  try {
    const { checks } = loadConfig(root);
    return { globs: checks.flatMap((c) => c.covers ?? []), ids: checks.map((c) => c.id) };
  } catch { return { globs: [], ids: [] }; }
}

// verify 결과가 온전한가 — ⛔ 줄 없음 + 검사 id 마다 ✅ 줄(설정을 모르면 ✅ 줄 하나 이상)
function intact(out, ids) {
  const lines = out.split(/\r?\n/);
  if (lines.some((l) => l.startsWith('⛔'))) return false;
  return ids.length ? ids.every((id) => lines.some((l) => l.startsWith(`✅ ${id} —`))) : lines.some((l) => l.startsWith('✅'));
}

const covered = (g, rel) => globMatch(WIN ? g.toLowerCase() : g, WIN ? rel.toLowerCase() : rel);

// review: exec-review 는 수정이 없어도 증거를 요구한다 · needVerify: verify 가 덮는 파일을 고쳤다(exec-review 는 처음부터)
const state = (started, edited, review = false) => ({ started, edited, review, needVerify: review, ran: false, verified: false, reviewed: false });

async function judge(path, root) {
  let s = state(false, false);
  let last = '';
  const { globs, ids } = checkInfo(root);
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
      if (o.type === 'assistant' && b.type === 'text') {
        last = b.text ?? '';
        if (REVIEW.test(last)) s.reviewed = true;
      } else if (o.type === 'user' && b.type === 'tool_result' && pending.delete(b.tool_use_id)) {
        s.ran = true;
        s.verified = !b.is_error && intact(text(b.content), ids);
      } else if (o.type === 'assistant' && b.type === 'tool_use') {
        const called = b.name === 'Skill' ? /(?:^|:)(exec-cycle|exec-review)$/.exec(b.input?.skill ?? '') : null;
        const agent = AGENTS.has(b.name) && !READ_ONLY_AGENTS.has(b.input?.subagent_type);
        const edit = (EDITS.has(b.name) || agent) && s.started ? (agent ? { code: true, rel: null } : codeEdit(b.input, root)) : null;
        if (called) {
          s = state(true, false, called[1] === 'exec-review');
          pending.clear();
        } else if (edit?.code) {
          const hit = edit.rel === null || !globs.length || globs.some((g) => covered(g, edit.rel));
          s = { ...s, edited: true, reviewed: false, ...(hit ? { needVerify: true, ran: false, verified: false } : {}) };
          if (hit) pending.clear();
        } else if (b.name === 'Bash' && RUNS_VERIFY.test(b.input?.command ?? '') && !/--baseline/.test(b.input.command)) {
          pending.add(b.id);
        }
      }
    }
  }
  return { s, last };
}

async function main(raw) {
  const input = JSON.parse(raw);
  if (input.agent_id || typeof input.transcript_path !== 'string') return;
  const { s, last } = await judge(input.transcript_path, input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  if (!s.started || !(s.edited || s.review)) return;
  const said = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : last;
  if (WAIT.test(said.trimEnd().split('\n').at(-1).trim())) return;
  const need = [];
  if (s.needVerify && !s.verified) need.push(s.ran ? '마지막 수정 뒤 verify 가 통과하지 않았다 — 고치고 `node .harness/tools/verify.mjs` 를 출력을 자르거나 버리지 말고 exit 0 까지 다시 돌린다' : '마지막 수정 뒤 verify 가 없다 — `node .harness/tools/verify.mjs` 를 출력을 자르거나 버리지 말고 그대로 돌린다');
  if (!s.reviewed && !REVIEW.test(input.last_assistant_message ?? '')) need.push('ponytail 과설계 리뷰 결과가 없다 — `node .harness/tools/cycle-skill.mjs user ponytail-review` 가 낸 파일을 읽고 리뷰해 보고에 `net: -N lines possible.` 또는 `Lean already.` 줄을 낸다');
  if (!need.length) return;
  process.stdout.write(JSON.stringify({ decision: 'block', reason: `${s.edited ? '/exec-cycle · /exec-review 중 코드를 고쳤는데' : '/exec-review 는 검증 전용이라 수정이 없어도'} 끝낼 증거가 빠졌다 — ${need.join(' · ')}. 사용자 행동을 기다리는 멈춤이면 마지막 줄에 \`⏸ 사용자 대기 — <이유>\` 를 적는다. 같은 이유로 계속 막히면 사용자에게 묻고 멈춘다(무엇이 막혔는지 말한다).` }));
}

let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  main(raw).catch(() => { /* 훅 실패는 막지 않는다 */ });
});

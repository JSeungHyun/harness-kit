// 가짜 claude — proof/ab.mjs 시험용. 진짜와 같은 인자를 받아 stream-json 만 낸다(모델 · API 호출 없음)
// 시나리오는 FAKE_CLAUDE(JSON 파일)에서 「<질문>|<cwd 폴더 이름>」으로 고른다. 없으면 깨끗한 실행
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const args = process.argv.slice(2);
const all = process.env.FAKE_CLAUDE ? JSON.parse(readFileSync(process.env.FAKE_CLAUDE, 'utf8')) : {};
const s = all[`${args[args.indexOf('-p') + 1]}|${basename(process.cwd())}`] ?? {};
const out = (o) => console.log(JSON.stringify(o));
const put = (rel, body) => { mkdirSync(dirname(join(process.cwd(), rel)), { recursive: true }); writeFileSync(join(process.cwd(), rel), body); };

// argv — 틀이 넘긴 인자를 시험이 실행 기록에서 읽는다
out({ type: 'system', subtype: 'init', session_id: 'sid-1', model: 'fake', tools: ['Bash'], plugins: [], mcp_servers: [], permissionMode: 'default', argv: args });
// 진짜 claude 처럼 --settings(훅 등록)를 받은 팔만 프롬프트 훅 이벤트를 낸다
if (args.includes('--settings')) out({ type: 'system', subtype: 'hook_started', hook_event: 'UserPromptSubmit' });
for (const [i, input] of (s.tools ?? [{ pattern: 'a' }]).entries()) out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input }] } });
if (s.touch) writeFileSync(join(process.cwd(), s.touch), '바뀜\n');
// write — 사본에 쓰는 파일들(코드를 바꾸는 과제 · 새 파일)
for (const [rel, body] of Object.entries(s.write ?? {})) put(rel, body);
// 세션 기록을 남기는 실행 — 진짜처럼 <설정 폴더>/projects/<cwd 슬러그>/<세션>.jsonl. 시험이 준 설정 폴더에만 쓴다
if (!args.includes('--no-session-persistence') && process.env.CLAUDE_CONFIG_DIR && !s.noSession) {
  const dir = join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(join(dir, 'sid-1', 'subagents'), { recursive: true });
  writeFileSync(join(dir, 'sid-1.jsonl'), '{}\n');
}
// stop — Stop 한 번에 도는 훅 수(전역 플러그인 + 관문 훅) · gateBlock — 관문 훅이 한 번 되돌린다
const stop = (block) => {
  for (let i = 0; i < (s.stop ?? 0); i++) out({ type: 'system', subtype: 'hook_started', hook_name: 'Stop', hook_event: 'Stop' });
  if (block) out({ type: 'system', subtype: 'hook_response', hook_name: 'Stop', hook_event: 'Stop', stdout: JSON.stringify({ decision: 'block', reason: '[관문] 이번 턴에 빠진 것: verify' }), exit_code: 0 });
};
if (s.gateBlock) { stop(true); out({ type: 'assistant', message: { content: [{ type: 'text', text: '채움' }] } }); }
stop(false);
if (!s.noResult) {
  for (const ms of s.ms ?? [1000]) {
    out({ type: 'result', subtype: 'success', duration_ms: ms, num_turns: 1, total_cost_usd: s.cost ?? 0.01,
      usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 3 }, result: s.result ?? 'FILES:\n- src/a.js' });
  }
}

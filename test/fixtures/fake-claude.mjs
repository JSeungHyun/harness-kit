// 가짜 claude — proof/ab.mjs 시험용. 진짜와 같은 인자를 받아 stream-json 만 낸다(모델 · API 호출 없음)
// 시나리오는 FAKE_CLAUDE(JSON 파일)에서 「<질문>|<cwd 폴더 이름>」으로 고른다. 없으면 깨끗한 실행
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const all = process.env.FAKE_CLAUDE ? JSON.parse(readFileSync(process.env.FAKE_CLAUDE, 'utf8')) : {};
const s = all[`${args[args.indexOf('-p') + 1]}|${basename(process.cwd())}`] ?? {};
const out = (o) => console.log(JSON.stringify(o));

out({ type: 'system', subtype: 'init', session_id: 'sid-1', model: 'fake', tools: ['Bash'], plugins: [], mcp_servers: [], permissionMode: 'default' });
// 진짜 claude 처럼 --settings(훅 등록)를 받은 팔만 프롬프트 훅 이벤트를 낸다
if (args.includes('--settings')) out({ type: 'system', subtype: 'hook_started', hook_event: 'UserPromptSubmit' });
for (const [i, input] of (s.tools ?? [{ pattern: 'a' }]).entries()) out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input }] } });
if (s.touch) writeFileSync(join(process.cwd(), s.touch), '바뀜\n');
if (!s.noResult) {
  for (const ms of s.ms ?? [1000]) {
    out({ type: 'result', subtype: 'success', duration_ms: ms, num_turns: 1, total_cost_usd: 0.01,
      usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 3 }, result: 'FILES:\n- src/a.js' });
  }
}

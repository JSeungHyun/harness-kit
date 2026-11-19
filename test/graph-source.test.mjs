// graph-find --source — 기록을 쓴 대화(세션 기록)의 코드 블록을 되찾는다. 합성 기록 · 합성 세션 기록만 쓴다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { slug } from '../tools/graph-find.mjs';
import { tmp, put, graphInstall } from './scene.mjs';

const at = (h, day = '2026-09-01') => `${day}T${String(h).padStart(2, '0')}:00:00.000Z`;
const human = (h, text, day) => ({ type: 'user', timestamp: at(h, day), message: { role: 'user', content: text } });
const said = (h, text, day) => ({ type: 'assistant', timestamp: at(h, day), message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolResult = (h, day) => ({ type: 'user', timestamp: at(h, day), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
// 실제 쓰기와 같은 모양 — heredoc 안의 JSON 이라 req 의 따옴표는 한 번 더 감싸인다
const wrote = (h, rec, day) => ({ type: 'assistant', timestamp: at(h, day), message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: `node .harness/tools/graph-append.mjs <<'EOF'\n${JSON.stringify(rec)}\nEOF` } }] } });
const session = (dir, rel, lines) => put(dir, rel, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
const block = (lang, body) => `\`\`\`${lang}\n${body}\n\`\`\``;

const REQ = '환불 "부분 취소" 조회 쿼리 전달';

test('⭐ --source — 가장 이른 쓰기 호출을 찾아 그 턴의 코드 블록을 낸다 · 기록도 세션 기록도 바꾸지 않는다', () => {
  const s = graphInstall(undefined, [{ req: REQ }, { req: '배송 묶음 점검' }]);
  const tr = tmp('tr-');
  session(tr, 'aaa.jsonl', [
    human(1, '예전 질문'),
    said(1, `옛 답\n${block('sql', 'SELECT old_col FROM old_t')}`),
    human(2, '부분 취소 건 조회 쿼리 줘'),
    said(2, `이 쿼리다\n${block('sql', 'SELECT refund_id FROM refund WHERE part = 1')}`),
    toolResult(2),
    said(3, `한 번 더\n${block('', 'node run.mjs')}`),
    wrote(3, { req: REQ }),
    human(4, '고마워'),
    said(4, block('sql', 'SELECT later_col FROM later_t')),
  ]);
  // 나중 세션이 같은 req 를 다시 언급(대체) — 쓴 자리는 가장 이른 것
  session(tr, 'bbb.jsonl', [human(1, '정리', '2026-09-05'), wrote(1, { req: '환불 정본', supersedes: REQ }, '2026-09-05')]);
  const before = [readFileSync(s.store, 'utf8'), readFileSync(join(tr, 'aaa.jsonl'), 'utf8')];

  const r = s.run('graph-find', ['--source', REQ, '--transcripts', tr]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout.split('\n')[0], /^쓴 자리: aaa\.jsonl:7 · 2026-09-01 \d\d:00 · 기록 날짜 2026-09-01 과 0일 차$/);
  assert.match(r.stdout, /── 코드 블록 1\/2 · sql ──\nSELECT refund_id FROM refund WHERE part = 1\n/);
  assert.match(r.stdout, /── 코드 블록 2\/2 ──\nnode run\.mjs\n/);
  assert.doesNotMatch(r.stdout, /old_col|later_col/, '그 턴 밖의 블록은 내지 않는다');
  assert.equal(s.run('graph-find', ['--source', '환불 "부분', '--transcripts', tr]).stdout, r.stdout, '앞부분 1건 일치도 같은 답');
  assert.deepEqual([readFileSync(s.store, 'utf8'), readFileSync(join(tr, 'aaa.jsonl'), 'utf8')], before);
  assert.equal(s.run('graph-find', ['--source']).status, 1, 'req 가 없으면 사용법');
});

test('--source — 블록 6개 · 4,000자 상한을 넘으면 「나머지 N개」 · 기록 날짜와 멀면 경고', () => {
  const s = graphInstall(undefined, [{ req: '정산 배치 점검 절차', date: '2026-08-20', recorded: '2026-08-20' }, { req: '긴 블록 하나짜리 기록' }]);
  const tr = tmp('tr-');
  session(tr, 'aaa.jsonl', [
    human(1, '절차'),
    said(1, Array.from({ length: 8 }, (_, i) => block('sh', `step_${i + 1}`)).join('\n')),
    wrote(2, { req: '정산 배치 점검 절차' }),
    human(3, '긴 것'),
    said(3, `${block('sql', 'A'.repeat(3990))}\n${block('sql', 'second_block')}`),
    wrote(3, { req: '긴 블록 하나짜리 기록' }),
  ]);
  const many = s.run('graph-find', ['--source', '정산 배치 점검 절차', '--transcripts', tr]).stdout;
  assert.match(many, /── 코드 블록 6\/8 · sh ──\nstep_6\n/);
  assert.doesNotMatch(many, /step_7/);
  assert.match(many, /… 나머지 2개 — /);
  assert.match(many.split('\n')[0], /12일 차 ⚠️/, '±2일 밖이면 쓴 자리가 아닐 수 있다');
  const long = s.run('graph-find', ['--source', '긴 블록 하나짜리 기록', '--transcripts', tr]).stdout;
  assert.match(long, /A{3990}/);
  assert.doesNotMatch(long, /second_block/);
  assert.match(long, /… 나머지 1개 — /);
});

test('⭐ --source — 기본 폴더는 Claude Code 와 같은 슬러그 · 서브에이전트 기록에서 쓴 경우도 찾는다', () => {
  // 실측(Windows · 2.1.3xx): C:\Users\name_01\App.Data\proj-x → C--Users-name-01-App-Data-proj-x — 영숫자가 아니면 전부 '-'
  assert.equal(slug('C:\\Users\\name_01\\App.Data\\proj-x\\'), 'C--Users-name-01-App-Data-proj-x');
  assert.equal(slug('/home/dev/my app/한글'), '-home-dev-my-app---');
  const s = graphInstall(undefined, [{ req: '쿠폰 중복 사용 조회' }]);
  const cfg = tmp('cfg-');
  s.env.CLAUDE_CONFIG_DIR = cfg;
  const proj = join(cfg, 'projects', slug(s.dir));
  session(proj, 'main.jsonl', [human(1, '쿠폰 봐줘'), said(1, block('sql', 'SELECT main_only'))]);
  session(proj, 'main/subagents/agent-a1.jsonl', [
    human(2, '쿠폰 중복 사용을 조사하고 기록하라'),
    said(2, block('sql', 'SELECT coupon_id FROM coupon_use GROUP BY coupon_id')),
    wrote(2, { req: '쿠폰 중복 사용 조회' }),
  ]);
  const r = s.run('graph-find', ['--source', '쿠폰 중복 사용 조회']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^쓴 자리: main\/subagents\/agent-a1\.jsonl:3 · /);
  assert.match(r.stdout, /SELECT coupon_id FROM coupon_use/);
});

test('--source — 못 찾으면 이유 셋을 가른다 · exit 0', () => {
  const today = new Date().toLocaleDateString('sv');
  const s = graphInstall(undefined, [
    { req: '오래전 이관 기록 하나', date: '2020-01-01', recorded: '2020-01-01' },
    { req: '오늘 스크립트로 넣은 기록', date: today, recorded: today },
  ]);
  const cfg = tmp('cfg-');
  s.env.CLAUDE_CONFIG_DIR = cfg;

  const none = s.run('graph-find', ['--source', '오늘 스크립트로 넣은 기록']);
  assert.equal(none.status, 0);
  assert.match(none.stdout, /세션 기록 폴더가 없다: .*projects.*\n⇒ .*--transcripts/);

  // 사람 입력에만 나오고 도구 호출에는 없다
  session(join(cfg, 'projects', slug(s.dir)), 'main.jsonl', [human(1, '오늘 스크립트로 넣은 기록 · 오래전 이관 기록 하나'), said(1, block('sql', 'SELECT 1'))]);
  const batch = s.run('graph-find', ['--source', '오늘 스크립트로 넣은 기록']);
  assert.equal(batch.status, 0);
  assert.match(batch.stdout, /어느 도구 호출에도 없다 \(세션 기록 1개\)\n⇒ 이관 · 일괄 기록/);
  assert.doesNotMatch(batch.stdout, /SELECT 1|보관 기간/);

  put(cfg, 'settings.json', JSON.stringify({ cleanupPeriodDays: 45 }));
  const old = s.run('graph-find', ['--source', '오래전 이관 기록 하나']);
  assert.equal(old.status, 0);
  assert.match(old.stdout, /보관 기간\(cleanupPeriodDays 45일\)보다 오래됐다 — 45일 지나 지워졌을 수 있다/);

  assert.match(s.run('graph-find', ['--source', '그런 기록 없음']).stdout, /로 시작하는 기록이 없다/);
});

test('--source — 앞부분이 여러 건에 맞으면 목록만 낸다', () => {
  const s = graphInstall(undefined, [{ req: '환불 규칙 정리' }, { req: '환불 규칙 정리 2차' }, { req: '환불 화면 문구' }, { req: '배송' }]);
  const tr = tmp('tr-');
  session(tr, 'aaa.jsonl', [human(1, '환불'), said(1, block('sql', 'SELECT 1')), wrote(1, { req: '환불 규칙 정리' })]);
  const many = s.run('graph-find', ['--source', '환불', '--transcripts', tr]);
  assert.equal(many.status, 0);
  assert.match(many.stdout, /^「환불」로 시작하는 기록 3건 — /);
  assert.match(many.stdout, / {2}2026-09-01 {2}환불 규칙 정리 2차\n/);
  assert.doesNotMatch(many.stdout, /쓴 자리|SELECT 1|배송/);
  assert.match(s.run('graph-find', ['--source', '환불 규칙 정리', '--transcripts', tr]).stdout, /^쓴 자리: aaa\.jsonl:3 /, '정확 일치가 앞부분 일치보다 먼저');
});

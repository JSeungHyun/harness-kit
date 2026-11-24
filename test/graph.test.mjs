// graph 도구 특성 테스트 — context-graph 에서 옮긴 동작과 13차 화해 동작을 잡는다. 키트가 정본이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load, index, check, scoreDetail, tokenizeKo } from '../tools/graph-find.mjs';
import { appendRecord } from '../tools/graph-append.mjs';
import { tmp, graphInstall } from './scene.mjs';

const TOOLS = fileURLToPath(new URL('../tools/', import.meta.url));
const DAY = '2026-09-01';

const scene = (recs = []) => graphInstall(undefined, recs);
const hook = (s, prompt) => s.run('graph-hook', [], JSON.stringify({ prompt })).stdout;
const cards = (out) => out.split(/\r?\n/).filter((l) => l.startsWith('· ['));

test('append → load 왕복 — date·recorded 가 붙고 줄번호가 지워진다', () => {
  const { store } = scene();
  appendRecord({ req: '환불 규칙 정리', terms: { 환불: 'refund_status' }, files: ['src/refund.mjs:12'] }, { store, today: '2026-09-02' });
  const [r] = load(store);
  assert.deepEqual(r, { date: '2026-09-02', recorded: '2026-09-02', req: '환불 규칙 정리', terms: { 환불: 'refund_status' }, files: ['src/refund.mjs'] });
});

test('⭐ 조회는 정확일치가 있는 기록을 점수 합보다 먼저 놓는다', () => {
  const s = scene([
    { req: '주문 취소 결제 환불 안내 문구 정리', terms: { 버튼: 'cancel_btn' } },
    { req: '반품 규칙', terms: { 환불: 'refund_status' } },
  ]);
  const body = scoreDetail(load(s.store)[0], ['환불', '주문', '취소', '결제']);
  assert.deepEqual([body.exact, body.s], [0, 4]);
  const out = s.run('graph-find', ['환불', '주문', '취소', '결제']).stdout;
  assert.match(out.split(/\r?\n/).find((l) => l.startsWith('[점수')), /반품 규칙/);
});

test('⭐ 대체된 기록은 기본 조회에서 빠지고 --all 에서만 낡음 표시로 나온다', () => {
  const s = scene([
    { req: '환불 규칙 v1', terms: { 환불: '옛 컬럼' } },
    { req: '환불 규칙 v2', terms: { 환불: 'refund_status' }, supersedes: '환불 규칙 v1', date: '2026-09-05', recorded: '2026-09-05' },
  ]);
  const plain = s.run('graph-find', ['환불']).stdout;
  assert.doesNotMatch(plain, /\[점수 \d+\] \S+\s+환불 규칙 v1/);
  assert.match(plain, /환불 규칙 v2/);
  const all = s.run('graph-find', ['환불', '--all']).stdout;
  assert.match(all, /환불 규칙 v1\s+⚠️ 낡음 — 2026-09-05 에 대체됨/);
});

test('문장을 통째로 주면 0건일 때 토큰으로 나눠 다시 찾는다', () => {
  const s = scene([{ req: '반품 규칙', terms: { 환불: 'refund_status' } }]);
  const out = s.run('graph-find', ['환불이 왜 안 되나']).stdout;
  assert.match(out, /문장을 토큰 \d+개로 나눠 다시 찾았다/);
  assert.match(out, /반품 규칙/);
});

test('⭐ alias 는 같은 JSONL 에 「용어 학습」 기록으로 쌓이고 그 말로 찾힌다', () => {
  const s = scene();
  const r = s.run('graph-alias', ['적립금', 'point_balance (member 테이블)', '--note', '탈퇴 회원은 0 으로 보인다']);
  assert.equal(r.status, 0);
  const [rec] = load(s.store);
  assert.equal(rec.req, '용어 학습: 적립금 — point_balance (member 테이블)');
  assert.deepEqual(rec.terms, { 적립금: 'point_balance (member 테이블)' });
  assert.match(s.run('graph-find', ['적립금']).stdout, /⚠️ 탈퇴 회원은 0 으로 보인다/);
});

test('⭐ check — 사슬·경로·용어 선점·⏸ 표식', () => {
  const recs = index([
    { req: 'A', date: '2026-09-01', terms: { 주문: 'x' }, files: ['src/a.mjs'] },
    { req: 'B', date: '2026-09-02', terms: { 주문: 'y' }, files: ['src/gone.mjs'] },
    { req: 'C', date: '2026-09-03', supersedes: '없는 기록', files: [] },
    { req: 'D', date: '2026-09-03', note: '미구현 — 결제사 응답을 기다린다', files: [] },
    { req: 'E', date: '2026-09-03', note: '⏸ 미구현 — 결제사 응답을 기다린다', files: [] },
  ]);
  const r = check(recs, { fileExists: (f) => f === 'src/a.mjs' });
  assert.deepEqual(r.problems.map(([k]) => k), ['고아 대체']);
  assert.deepEqual(r.gone.map(([rec, f]) => [rec.req, f]), [['B', 'src/gone.mjs']]);
  assert.equal(r.dupTerms, 1);
  assert.deepEqual(r.stale, []);
  assert.deepEqual(r.unmarked.map((x) => x.req), ['D']);
});

test('⛔ CLI --check: 이상이 있으면 exit 1, 깨끗하면 exit 0', () => {
  assert.equal(scene([{ req: 'A', files: ['nowhere.mjs'] }]).run('graph-find', ['--check']).status, 1);
  assert.equal(scene([{ req: 'A', files: [] }]).run('graph-find', ['--check']).status, 0);
});

test('⛔ graph-append — note 는 한 줄 · 800자까지다. 넘으면 아무것도 쓰지 않고 exit 1 · 기존 기록은 그대로 읽는다', () => {
  const { store } = scene();
  assert.throws(() => appendRecord({ req: 'A', note: '첫 줄\n둘째 줄' }, { store }), /한 줄/);
  assert.throws(() => appendRecord({ req: 'A', note: '가'.repeat(801) }, { store }), /800/);
  appendRecord({ req: 'B', note: '가'.repeat(800), files: ['src/b.mjs'] }, { store });
  const s = scene([{ req: '옛 기록', note: '가'.repeat(1200) }]);
  const r = s.run('graph-append', [], [JSON.stringify({ req: 'C', note: '짧다', files: ['src/c.mjs'] }), JSON.stringify({ req: 'D', note: '가'.repeat(900), files: ['src/d.mjs'] })].join('\n'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /800/);
  assert.deepEqual(load(s.store).map((x) => x.req), ['옛 기록']);
  // alias 의 --note 도 같은 문을 지난다
  assert.equal(s.run('graph-alias', ['적립금', 'point_balance', '--note', '가'.repeat(900)]).status, 1);
  assert.deepEqual(load(s.store).map((x) => x.req), ['옛 기록']);
  // 여러 줄로 편 JSON 한 건(heredoc)은 그대로 받는다
  const pretty = s.run('graph-append', [], JSON.stringify({ req: 'E', note: '짧다', files: ['src/e.mjs'] }, null, 2));
  assert.equal(pretty.status, 0, pretty.stderr);
  assert.deepEqual(load(s.store).map((x) => x.req), ['옛 기록', 'E']);
});

// 20개 — --check 의 독점 측정은 살아있는 기록 20건부터
const W20 = ['배송', '반품', '교환', '적립금', '쿠폰', '정산', '재고', '알림', '결제', '환불', '주문', '회원', '등급', '배너', '상품', '리뷰', '문의', '공지', '이벤트', '포인트'];

test('⭐ --check — 한 기록이 다른 기록의 질문(자기를 뺀 1위)을 독점하면 경고한다 · exit 0(신호용)', () => {
  const broad = { req: '용어 사전: 쇼핑몰 전반', terms: Object.fromEntries(W20.map((w) => [w, `${w} 설명`])) };
  const r = scene([broad, ...W20.map((w) => ({ req: `${w} 처리`, terms: { [w]: `${w}_tbl` } }))]).run('graph-find', ['--check']);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /⚠️ 1위 독점 — .*용어 사전: 쇼핑몰 전반/);
  // 고루 퍼지면 울리지 않는다
  const even = scene(W20.flatMap((w) => [{ req: `${w} 처리`, terms: { [w]: 'a' } }, { req: `${w} 화면`, terms: { [w]: 'b' } }])).run('graph-find', ['--check']);
  assert.equal(even.status, 0);
  assert.match(even.stdout, /상위3 점유 \d+%/);
  assert.doesNotMatch(even.stdout, /⚠️ 1위 독점/);
  // 20건 미만은 재지 않는다
  assert.doesNotMatch(scene([broad, ...W20.slice(0, 8).map((w) => ({ req: `${w} 처리`, terms: { [w]: 'x' } }))]).run('graph-find', ['--check']).stdout, /⚠️ 1위 독점/);
});

const SHOP = [
  { req: '배송 상태 화면', terms: { 배송: 'shipping_status' } },
  { req: '알림 발송 설정', terms: { 알림: 'notify_rule' } },
  { req: '문자 템플릿', terms: { 문자: 'sms_template' } },
];

test('⛔ 훅 — 신호가 약하면(0건·최고점수 ≤ 2) 아무것도 넣지 않는다', () => {
  const s = scene(SHOP);
  assert.equal(hook(s, '계속 진행해줘'), '');
  assert.equal(hook(s, '상태 화면'), '');
});

test('⭐ 훅 1단 — 탈출구 문장을 두고 상위 2건까지만 낸다', () => {
  const out = hook(scene(SHOP), '배송 알림 문자가 안 간다');
  assert.match(out, /되묻지 말고 조회한다/);
  assert.equal(cards(out).length, 2);
});

test('⭐ 훅 1단 — 1위가 정본이면 그 1건만 낸다', () => {
  const out = hook(scene([{ req: '정본: 배송 지연 대응 절차', terms: { 배송: 'shipping_status' } }, ...SHOP]), '배송 지연');
  assert.equal(cards(out).length, 1);
  assert.match(cards(out)[0], /정본: 배송 지연 대응 절차/);
});

test('⭐ 훅 — ⏸ 열린 작업은 순위 밖이어도 붙고, 대체된 기록·사무 기록은 빠진다', () => {
  const s = scene([
    ...SHOP,
    { req: '재시도 설계 — 배송 지연 알림 문자 발송 실패', terms: { 재시도큐: 'retry_queue' }, note: '⏸ 큐 설계까지 했다 — 재시도 횟수를 받으면 재개' },
    { req: 'TODO 갱신: 배송', terms: { 배송: '사무' } },
    { req: '옛 배송 화면', terms: { 배송: 'old_status' } },
    { req: '새 배송 화면', terms: { 배송: 'new_status' }, supersedes: '옛 배송 화면' },
  ]);
  const out = hook(s, '배송 지연 알림 문자 발송 실패');
  assert.equal(cards(out).length, 2);
  assert.match(out, /⏸ 열린 작업 1건/);
  assert.match(out, /⏸ 2026-09-01 재시도 설계 — 배송 지연 알림 문자 발송 실패/);
  assert.doesNotMatch(out, /TODO 갱신|옛 배송 화면/);
});

test('⭐ 이식본 — 환경변수가 없으면 도구 기준 ../graph/requests.jsonl 을 쓴다, cwd 와 무관하게', () => {
  const dir = tmp('graph-');
  mkdirSync(join(dir, '.harness', 'tools'), { recursive: true });
  for (const f of readdirSync(TOOLS).filter((n) => n.startsWith('graph-'))) cpSync(join(TOOLS, f), join(dir, '.harness', 'tools', f));
  const env = { ...process.env };
  delete env.HARNESS_GRAPH_STORE;
  const run = (tool, args, input, cwd) => spawnSync(process.execPath, [join(dir, '.harness', 'tools', `${tool}.mjs`), ...args], { cwd, input, env, encoding: 'utf8' });
  assert.equal(run('graph-alias', ['적립금', 'point_balance'], '', tmpdir()).status, 0);
  assert.equal(load(join(dir, '.harness', 'graph', 'requests.jsonl')).length, 1);
  assert.match(run('graph-hook', [], JSON.stringify({ prompt: '적립금이 안 보인다' }), tmpdir()).stdout, /전문: graph-find 적립금/);
  assert.match(run('graph-find', ['적립금'], '', dir).stdout, /용어 학습: 적립금/);
});

test('⛔ graph 도구 어디에도 tools/graph/ 하드코딩이 없다', () => {
  for (const f of readdirSync(TOOLS).filter((n) => n.startsWith('graph-'))) {
    assert.doesNotMatch(readFileSync(join(TOOLS, f), 'utf8'), /['"`]tools\/graph|join\([^)]*'graph'/, f);
  }
});

test('⭐ 토크나이저 — 「명사 + 중 + 조사」는 명사를 더한다 · 「중」 앞이 1글자(집중 · 비중 · 도중)거나 조사가 없으면(…중) 그대로', () => {
  const t = (q) => [...tokenizeKo(q)].sort();
  for (const w of ['재고실사중에', '재고실사중엔', '재고실사중인', '재고실사중이', '재고실사중일', '재고실사중에는', '재고실사중에도']) {
    assert.ok(t(w).includes('재고실사'), w);
    assert.ok(t(w).includes(w), `${w} — 원형도 남는다`);
  }
  assert.deepEqual(t('집중에'), ['집중', '집중에']);
  assert.deepEqual(t('비중이'), ['비중', '비중이']);
  assert.deepEqual(t('도중에'), ['도중', '도중에']);
  assert.deepEqual(t('재고실사중'), ['재고', '재고실사중']);
  assert.deepEqual(t('처리중에'), ['처리중', '처리중에']);
  // 이어 붙인 형에는 안 건다 — 「기록을 나중에」가 「기록을나」를 만든다
  for (const [q, junk] of [['기록을 나중에', '기록을나'], ['매출 비중이', '매출비'], ['업로드 도중에', '업로드도']]) assert.ok(!t(q).includes(junk), q);
  const s = scene([
    { req: '정본: 재고실사 구조', terms: { 재고실사: 'stock_audit', 실사지표: 'audit_metric' } },
    { req: '수동 업로드 조사', terms: { 수동업로드: 'manual_upload' } },
  ]);
  assert.match(cards(hook(s, '재고실사중에 수동으로 바꾸는 것과 자동으로 바뀌는 게 뭐야'))[0] ?? '', /정본: 재고실사 구조/);
});

test('⭐ ③ 용어 「값」은 한글 질의에서 빠지고 식별자 질의에만 걸린다', () => {
  const rec = { req: '야간 작업', terms: { 배치: '매일 02시에 도는 스케줄러 CronTrigger 설정' } };
  assert.equal(scoreDetail(rec, ['스케줄러']).s, 0);
  assert.equal(scoreDetail(rec, ['crontrigger']).s, 1);
  const s = scene([rec]);
  assert.match(s.run('graph-find', ['스케줄러']).stdout, /걸리는 과거 요구가 없다/);
  assert.match(s.run('graph-find', ['CronTrigger']).stdout, /야간 작업/);
});

test('⭐ ⑧ --check 대체 사슬 4종 — 각각 잡고 exit 1', () => {
  const cases = {
    '고아 대체': [{ req: 'B', supersedes: '없는 기록' }],
    '기록순 역행': [{ req: 'A', supersedes: 'B' }, { req: 'B' }],
    '자기 대체': [{ req: 'A', supersedes: 'A' }],
    '중복 대체': [{ req: 'A' }, { req: 'B', supersedes: 'A' }, { req: 'C', supersedes: 'A' }],
  };
  for (const [kind, recs] of Object.entries(cases)) {
    const r = check(index(recs.map((x) => ({ files: [], ...x }))));
    assert.ok(r.problems.some(([k]) => k === kind), kind);
    assert.equal(scene(recs).run('graph-find', ['--check']).status, 1, kind);
  }
});

test('⭐ --check 중복 대체 — 줄 번호와 처방 줄을 내고, 처방대로 고치면 exit 0 (18차 · 공유 모드에서 둘이 같은 기록을 따로 대체)', () => {
  const s = scene([{ req: 'A' }, { req: 'B', supersedes: 'A' }, { req: 'C', supersedes: 'A' }]);
  const r = s.run('graph-find', ['--check']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /⛔ 중복 대체: 「A」 를 2개 기록\(줄2 · 줄3\)이 대체한다/);
  assert.match(r.stdout, /⇒ 맨 앞 줄\(줄2\)은 그대로 두고, 뒤 줄\(줄3\)은 supersedes 를 바로 앞 줄의 req 로 바꾼다/);
  writeFileSync(s.store, readFileSync(s.store, 'utf8').replace('"req":"C","supersedes":"A"', '"req":"C","supersedes":"B"'));
  assert.equal(s.run('graph-find', ['--check']).status, 0);
});

test('--check 같은 req 두 줄 — 경고만(exit 0) · 병합(merge=union)이 제자리 수정의 옛 줄 · 새 줄을 다 남긴 꼴 (18차)', () => {
  const recs = [{ req: 'A' }, { req: 'B' }, { req: 'A', terms: { 별칭: '값' } }];
  assert.deepEqual(check(index(recs.map((x) => ({ files: [], ...x })))).sameReq, [['A', [1, 3]]]);
  const r = scene(recs).run('graph-find', ['--check']);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /⚠️ 같은 req 2줄\(줄1 · 줄3\): 「A」/);
  assert.match(r.stdout, /⇒ .*옛 줄을 지운다.*supersedes/);
  assert.doesNotMatch(scene([{ req: 'A' }, { req: 'B' }]).run('graph-find', ['--check']).stdout, /같은 req/);
});

test('⛔ ⑧ 경로 무결성은 대체된 기록을 뺀다 — 안 빼면 --check 가 영구 exit 1 이 된다', () => {
  const s = scene([
    { req: '옛 화면', files: ['src/old-screen.mjs'] },
    { req: '새 화면', supersedes: '옛 화면', files: [] },
  ]);
  const r = s.run('graph-find', ['--check']);
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /old-screen/);
});

// 훅 출력 문장은 실패로 만들어진 것이라 문자열로 고정한다 (docs/graph-port.md §2)
const OPEN = '⏸ 열린 작업 1건 — 이 주제에 **하다 만 기록**이 있다. 다시 조사하기 전에 이것부터 편다.';
const NO_FORCE = '⛔ 억지로 고르지 않는다 — 관련 없으면 색인을 무시하고 평소대로 코드를 탐색한다.';

test('⭐ 훅 1단 문장 — 길잡이 머리말 · 열린 작업 · 2단 색인(카드 모양은 graph-hook-guide)', () => {
  const s = scene([
    { req: '배송 상태 화면', terms: { 배송: 'shipping_status' } },
    { req: '알림 규칙', terms: { 알림: 'notify_rule' } },
    { req: '문자 규칙', terms: { 문자: 'sms_rule' } },
    { req: '재시도 설계 — 배송 지연 알림 문자 발송', terms: { 재시도큐: 'retry_queue' }, note: '⏸ 큐 설계까지 했다' },
  ]);
  const lines = hook(s, '배송 지연 알림 문자 발송').split(/\r?\n/);
  assert.match(lines[0], /^\[그래프 자동조회\] 유사 기록 \d+건/);
  assert.ok(lines.includes(OPEN), OPEN);
  assert.ok(!lines.some((l) => /^더 볼 것:|안 걸린 항목|함정:/.test(l)));
});

test('⭐ 훅 2단 문장 — 약하게만 걸리면(3~4점·정확일치 0) 압축 색인과 「억지로 고르지 않는다」', () => {
  const out = hook(scene([{ req: '흐름 정리 — 주문 취소 결제', terms: { 버튼: 'cancel_btn' } }]), '주문 취소 결제');
  const lines = out.split(/\r?\n/);
  assert.equal(lines[0], '[그래프 자동조회] 키워드로는 약하게만 걸렸다(최고 점수 3). 아래 색인에서 의미가 맞는 것을 직접 고른다.');
  assert.ok(lines.includes(NO_FORCE));
  assert.ok(lines.includes('2026-09-01 흐름 정리 — 주문 취소 결제  [용어: 버튼]'));
});


test('⭐ 훅 2단 — 후보는 점수 상위 10건뿐이고, 줄마다 용어 키는 5개까지(더 있으면 …)', () => {
  const keys = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`항목${i + 1}`, `값${i + 1}`]));
  // 점수 4 인 10건 — 앞 5건이 키 개수 경계(7 · 6 · 5 · 1 · 0)를 지난다
  const shapes = [
    [keys(7), '  [용어: 항목1, 항목2, 항목3, 항목4, 항목5 …]'],
    [keys(6), '  [용어: 항목1, 항목2, 항목3, 항목4, 항목5 …]'],
    [keys(5), '  [용어: 항목1, 항목2, 항목3, 항목4, 항목5]'],
    [keys(1), '  [용어: 항목1]'],
    [{}, ''],
    ...Array.from({ length: 5 }, () => [keys(2), '  [용어: 항목1, 항목2]']),
  ];
  const strong = shapes.map(([terms], i) => ({ req: `흐름 정리 A${i} — 주문취소 결제`, terms }));
  const weak = [1, 2].map((i) => ({ req: `흐름 정리 B${i} — 주문 취소 결제`, terms: keys(1) }));
  const none = ['쿠폰 발급 규칙', '재고 이동 화면', '정산 마감 배치'].map((req) => ({ req, terms: { 항목: 'x' } }));
  // 약한 2건은 앞에, 안 걸리는 3건은 뒤에 둔다 — 앞 10건 · 뒤 10건 · 최근 150건 같은 자르기가 통과하지 못한다
  const lines = hook(scene([...weak, ...strong, ...none]), '주문 취소 결제').split(/\r?\n/);
  assert.match(lines[0], /\(최고 점수 4\)/);
  assert.deepEqual(lines.filter((l) => /^\d{4}-\d\d-\d\d /.test(l)),
    shapes.map(([, tail], i) => `${DAY} 흐름 정리 A${i} — 주문취소 결제${tail}`));
});

test('graph-measure — 티켓 형식 [{title}] · [{subj}] · {tasks:[{subj}]} 를 받는다', () => {
  const s = scene([{ req: '적립금 잔액', terms: { 적립금: 'point_balance' } }]);
  for (const body of [[{ title: '적립금이 안 보여요' }], [{ subj: '적립금이 안 보여요' }], { tasks: [{ subj: '적립금이 안 보여요' }] }]) {
    writeFileSync(join(s.dir, 'tickets.json'), JSON.stringify(body));
    const r = s.run('graph-measure', ['적립금']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\/적립금\/ 질의 1 · 확신 1/);
  }
});

test('⛔ graph-measure — 티켓을 하나도 못 읽으면 조용한 0 이 아니라 실패다', () => {
  const s = scene([{ req: '적립금 잔액', terms: { 적립금: 'point_balance' } }]);
  for (const body of [{ items: [] }, [{ name: '적립금' }]]) {
    writeFileSync(join(s.dir, 'tickets.json'), JSON.stringify(body));
    const r = s.run('graph-measure', ['적립금']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /형식을 못 읽었다/);
  }
});

// 상위 3 점유 = 확신 질의 중 「가장 자주 1위를 한 기록 3개」가 1위인 비율 — 훅을 켜는 조건(design §5)
const WORDS = ['배송', '반품', '교환', '적립금', '쿠폰', '정산', '재고', '알림'];
const share = (out) => Number((out.match(/상위3 점유 (\d+)%/) ?? [])[1]);

test('⭐ graph-measure — 한 기록이 1위를 독점하면 상위3 점유 ≥ 50%', () => {
  const s = scene([
    { req: '용어 사전: 쇼핑몰 전반', terms: Object.fromEntries(WORDS.map((w) => [w, `${w} 설명`])) },
    ...WORDS.map((w, i) => ({ req: `업무 ${i}`, terms: { [`부속${i}`]: 'x' } })),
  ]);
  writeFileSync(join(s.dir, 'tickets.json'), JSON.stringify(WORDS.map((w) => ({ title: `${w} 문의` }))));
  const r = s.run('graph-measure', ['.']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(share(r.stdout) >= 50, r.stdout);
});

test('⭐ graph-measure — 1위가 고루 퍼지면 상위3 점유 < 50%', () => {
  const s = scene(WORDS.map((w) => ({ req: `${w} 처리`, terms: { [w]: `${w} 실체` } })));
  writeFileSync(join(s.dir, 'tickets.json'), JSON.stringify(WORDS.map((w) => ({ title: `${w} 문의` }))));
  const r = s.run('graph-measure', ['.']);
  assert.match(r.stdout, /확신 8/);
  assert.equal(share(r.stdout), 38);
});

// ── 13차 화해 — context-graph(원천) 판에만 있던 동작을 키트로 ──

const ask = (s, prompt) => s.run('graph-hook', [], JSON.stringify({ prompt }), tmpdir()).stdout;
// 이름이 경로에 든 기록 — 이름 토큰이 식별자로 치이면 이름만 든 질의가 이 기록을 확신 1위로 낸다
const NAMED = [
  { req: '연혁 사전', terms: { 연혁: '출범 · 개편 이력' }, files: ['docs/shopx/history.md'] },
  { req: '주문 취소 흐름', terms: { 취소: 'cancel_flow' }, files: ['src/order/cancel.mjs'] },
];

test('⭐ graph.names — 이름 토큰은 식별자 적중을 만들지 않는다 · 이름만 있는 질의는 훅 확신 카드가 없다', () => {
  const s = graphInstall({ names: ['shopx'] }, NAMED);
  assert.equal(ask(s, 'SHOPX 회의록'), '');
  assert.equal(ask(s, 'shopx'), '');
  assert.match(ask(s, 'cancel_flow 확인'), /주문 취소 흐름/);
  // 빈 목록이면 끈다 — 위 침묵이 이름 필터 때문임을 보인다
  assert.ok(cards(ask(graphInstall({ names: [] }, NAMED), 'SHOPX 회의록')).length >= 1);
});

test('⭐ graph.names 가 없으면 저장소 폴더 이름의 - · _ 앞부분 — 적으면 그 목록만 쓴다', () => {
  assert.equal(ask(graphInstall({}, NAMED, 'shopx-web'), 'SHOPX 회의록'), '');
  assert.equal(ask(graphInstall(undefined, NAMED, 'shopx_admin'), 'SHOPX 회의록'), '');
  assert.ok(cards(ask(graphInstall({ names: ['brand'] }, NAMED, 'shopx-web'), 'SHOPX 회의록')).length >= 1);
});

test('graph.names — 자기검색은 그대로다', () => {
  const recs = [...NAMED, { req: 'SHOPX 주문 화면 개편', terms: { 주문화면: 'order_view' }, files: ['src/shopx/order.mjs'] }];
  const on = graphInstall({ names: ['shopx'] }, recs).run('graph-measure', ['--self']).stdout;
  assert.equal(on, graphInstall({ names: [] }, recs).run('graph-measure', ['--self']).stdout);
  assert.match(on, /자기검색 1위 3\/3/);
});

test('⭐ graph.store — 도구는 harness.json 의 기록 위치를 따른다(cwd · 환경변수와 무관)', () => {
  const s = graphInstall({ store: 'data/graph.jsonl' });
  assert.equal(s.run('graph-alias', ['적립금', 'point_balance'], '', tmpdir()).status, 0);
  assert.equal(load(join(s.dir, 'data', 'graph.jsonl')).length, 1);
  assert.ok(!existsSync(join(s.dir, '.harness', 'graph', 'requests.jsonl')));
  assert.match(s.run('graph-find', ['적립금'], '', tmpdir()).stdout, /용어 학습: 적립금/);
  assert.match(ask(s, '적립금이 안 보인다'), /전문: graph-find 적립금/);
});

test('⛔ graph-append — 파일 · 테이블을 하나도 안 가리키는 기록은 거부한다(참조 머리말 · scope:meta 는 통과) · 문구는 「기록하지 않는다」가 먼저', () => {
  const s = scene();
  const r = s.run('graph-append', [], JSON.stringify({ req: '옆 저장소 이식 조사', terms: { 이식: '옆 저장소' } }));
  assert.equal(r.status, 1);
  const at = (t) => r.stderr.indexOf(t);
  assert.ok(at('기록하지 않는다') >= 0 && at('기록하지 않는다') < at('"scope":"meta"'), r.stderr);
  assert.doesNotMatch(r.stderr, /files 에|파일을 (넣|채)/);
  assert.deepEqual(load(s.store), []);
  for (const rec of [{ req: '정본: 반품 절차' }, { req: '용어 사전: 배송' }, { req: '공백 목록: 정산' }, { req: '회의 원문: 반품 기준' }, { req: '정정: 반품 기한' },
    { req: '반품 도구를 들이지 않기로 했다', scope: 'meta' }, { req: '반품 테이블', tables: ['return_req'] }]) {
    const w = s.run('graph-append', [], JSON.stringify(rec));
    assert.equal(w.status, 0, `${rec.req}: ${w.stderr}`);
  }
  assert.equal(load(s.store).find((x) => x.scope)?.scope, 'meta');
  assert.equal(s.run('graph-alias', ['적립금', 'point_balance']).status, 0);
});

test('⭐ --check — 저장소 밖 주제(파일 · 테이블 · 참조 머리말 · scope:meta 가 모두 없는 살아있는 기록)를 경고한다 · exit 0', () => {
  const r = scene([
    { req: '옆 저장소 이식 조사' },
    { req: '정본: 반품 절차' },
    { req: '도구 도입 결정', scope: 'meta' },
    { req: '옛 조사' },
    { req: '새 조사', supersedes: '옛 조사', tables: ['t'] },
  ]).run('graph-find', ['--check']);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /── 저장소 밖 주제/);
  assert.match(r.stdout, /⚠️ 2026-09-01 옆 저장소 이식 조사/);
  assert.match(r.stdout, /"scope":"meta"/);
  assert.doesNotMatch(r.stdout, /⚠️ \S+ (정본: 반품 절차|도구 도입 결정|옛 조사)/);
});

test('훅 카드 종류 「원문」은 저장소 밖 면제 머리말과 같은 조각이다 — 「<출처> 원문」도 원문', () => {
  assert.match(cards(hook(scene([{ req: '회의 원문으로 확정한 반품 기준', terms: { 반품기준: '7일' } }]), '반품기준'))[0], /^· \[원문 · /);
});

test('⭐ --check 1위 독점 — 질의는 살아있는 최근 200건만, 경쟁 풀은 살아있는 전체(오래된 광역 기록도 잡는다)', () => {
  const broad = { req: '용어 사전: 쇼핑몰 전반', terms: Object.fromEntries(W20.map((w) => [w, `${w} 설명`])) };
  const many = Array.from({ length: 229 }, (_, i) => ({ req: `${W20[i % 20]}${i} 처리`, terms: { [W20[i % 20]]: `t${i}` } }));
  const r = scene([broad, ...many]).run('graph-find', ['--check']);
  assert.match(r.stdout, /질의 200 · 상위3 점유/);
  assert.match(r.stdout, /⚠️ 1위 독점 — \d+\/200 {2}용어 사전: 쇼핑몰 전반/);
});

test('⭐ --gaps — 바꾼 파일을 가리키는 살아있는 기록이 하나도 없는 커밋만 낸다 · 기록은 쓰지 않는다 (18차 · 여럿이 쓰는 로컬 설치)', () => {
  const s = scene([{ req: '환불 규칙', files: ['src/refund.mjs:12'] }, { req: '옛 배송', files: ['src/ship.mjs'] }, { req: '배송 정리', supersedes: '옛 배송' }]);
  assert.equal(s.run('graph-find', ['--gaps']).status, 1, 'git 저장소가 아니면 실패');
  const cfg = join(tmp('gitcfg-'), 'gitconfig');
  writeFileSync(cfg, '');
  const git = (...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: s.dir, env: { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' });
  const commit = (day, msg, files, body = msg) => {
    for (const f of files) { mkdirSync(join(s.dir, 'src'), { recursive: true }); writeFileSync(join(s.dir, f), body); }
    git('add', '-A');
    assert.equal(git('commit', '-qm', msg, '--date', `${day}T12:00:00`).status, 0, msg);
  };
  git('init', '-q');
  commit('2026-08-20', '옛 작업', ['src/old.mjs']);
  commit('2026-09-02', '환불 수정', ['src/refund.mjs']);
  commit('2026-09-03', '배송 고침', ['src/ship.mjs']);
  commit('2026-09-04', '쿠폰 추가', ['src/coupon.mjs', 'src/refund.mjs']);
  commit('2026-09-05', '정산 추가', ['src/settle.mjs']);
  commit('2026-09-06', '곧 지울 파일', ['src/gone.mjs']);
  git('rm', '-q', 'src/gone.mjs');
  commit('2026-09-07', '파일 지움', []);
  const before = readFileSync(s.store, 'utf8');
  writeFileSync(s.store, `${before}\n`);
  commit('2026-09-08', '기록만 고침', []);
  writeFileSync(s.store, before);
  const r = s.run('graph-find', ['--gaps']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^커밋 빈틈 2건 — 2026-09-01 뒤 커밋 7건/);
  assert.match(r.stdout, /^[0-9a-f]{7,} 2026-09-05 정산 추가\n {3}src\/settle\.mjs$/m);
  assert.match(r.stdout, /^[0-9a-f]{7,} 2026-09-03 배송 고침\n {3}src\/ship\.mjs$/m, '대체된 기록만 가리키면 빈틈이다');
  assert.doesNotMatch(r.stdout, /옛 작업|환불 수정|쿠폰 추가|지울 파일|파일 지움|기록만 고침/);
  assert.match(r.stdout, /⇒ .*graph-append/);
  const late = s.run('graph-find', ['--gaps', '2026-09-04']).stdout;
  assert.match(late, /^커밋 빈틈 1건 — 2026-09-04 뒤 커밋 5건/);
  assert.equal(readFileSync(s.store, 'utf8'), before, '기록은 쓰지 않는다');
  assert.equal(s.run('graph-find', ['--gaps', '9월']).status, 1);
});

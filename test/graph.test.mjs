// graph 도구 특성 테스트 — context-graph 원본 동작을 잡는다. 이식 전후 모두 통과해야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load, index, check, scoreDetail } from '../tools/graph-find.mjs';
import { appendRecord } from '../tools/graph-append.mjs';
import { tmp } from './scene.mjs';

const TOOLS = fileURLToPath(new URL('../tools/', import.meta.url));
const DAY = '2026-09-01';

// 도구를 임시 폴더의 tools/ 로 옮겨 돌린다 — 원본(cwd·도구 기준 tools/graph/)과 이식본(HARNESS_GRAPH_STORE)이 같은 저장소를 본다
function scene(recs = []) {
  const dir = tmp('graph-');
  mkdirSync(join(dir, 'tools'));
  for (const f of readdirSync(TOOLS).filter((n) => n.startsWith('graph-'))) cpSync(join(TOOLS, f), join(dir, 'tools', f));
  const store = join(dir, 'tools', 'graph', 'requests.jsonl');
  mkdirSync(dirname(store), { recursive: true });
  writeFileSync(store, recs.map((r) => `${JSON.stringify({ date: DAY, recorded: DAY, files: [], ...r })}\n`).join(''));
  const run = (tool, args = [], input = '') =>
    spawnSync(process.execPath, [join(dir, 'tools', `${tool}.mjs`), ...args], {
      cwd: dir, input, encoding: 'utf8', env: { ...process.env, HARNESS_GRAPH_STORE: store },
    });
  return { dir, store, run };
}
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
  assert.match(out, /걸린 것이 답이라는 뜻은 아니다/);
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
  assert.match(run('graph-hook', [], JSON.stringify({ prompt: '적립금이 안 보인다' }), tmpdir()).stdout, /적립금 → point_balance/);
  assert.match(run('graph-find', ['적립금'], '', dir).stdout, /용어 학습: 적립금/);
});

test('⛔ graph 도구 어디에도 tools/graph/ 하드코딩이 없다', () => {
  for (const f of readdirSync(TOOLS).filter((n) => n.startsWith('graph-'))) {
    assert.doesNotMatch(readFileSync(join(TOOLS, f), 'utf8'), /['"`]tools\/graph|join\([^)]*'graph'/, f);
  }
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
const ESCAPE = '⭐ 다만 위 기록이 이 질문에 답하지 않으면 그렇다고 말하고 평소대로 코드를 탐색한다 — 걸린 것이 답이라는 뜻은 아니다.';
const REMOVED = '⛔ 값이 「제거됨」·「바뀜」으로 시작하면 그게 답이다. 코드에 안 보인다고 「모름」이라 하지 않는다.';
const OPEN = '⏸ 열린 작업 1건 — 이 주제에 **하다 만 기록**이 있다. 다시 조사하기 전에 이것부터 편다.';
const NO_FORCE = '⛔ 억지로 고르지 않는다 — 관련 없으면 색인을 무시하고 평소대로 코드를 탐색한다.';
const MORE = '더 볼 것: node .harness/tools/graph-find.mjs <어근>  (어근은 짧게, 여러 개)';

test('⭐ 훅 1단 문장 — 탈출구 · 「제거됨/바뀜」 · 안 걸린 항목(키만) · 열린 작업 · 마지막 줄', () => {
  const s = scene([
    { req: '배송 상태 화면', terms: { 배송: 'shipping_status', 반품: 'return_flag', 교환: 'exchange_flag' } },
    { req: '알림 규칙', terms: { 알림: 'notify_rule' } },
    { req: '문자 규칙', terms: { 문자: 'sms_rule' } },
    { req: '재시도 설계 — 배송 지연 알림 문자 발송', terms: { 재시도큐: 'retry_queue' }, note: '⏸ 큐 설계까지 했다' },
  ]);
  const lines = hook(s, '배송 지연 알림 문자 발송').split(/\r?\n/);
  for (const want of [ESCAPE, REMOVED, OPEN, MORE]) assert.ok(lines.includes(want), want);
  assert.equal(lines.filter(Boolean).at(-1), MORE);
  assert.ok(hook(s, '배송이 늦다').split(/\r?\n/).includes('    … 이 질의와 안 걸린 항목 2개(키만): 반품 · 교환'));
});

test('⭐ 훅 2단 문장 — 약하게만 걸리면(3~4점·정확일치 0) 압축 색인과 「억지로 고르지 않는다」', () => {
  const out = hook(scene([{ req: '흐름 정리 — 주문 취소 결제', terms: { 버튼: 'cancel_btn' } }]), '주문 취소 결제');
  const lines = out.split(/\r?\n/);
  assert.equal(lines[0], '[그래프 자동조회] 키워드로는 약하게만 걸렸다(최고 점수 3). 아래 색인에서 의미가 맞는 것을 직접 고른다.');
  assert.ok(lines.includes(NO_FORCE));
  assert.ok(lines.includes('2026-09-01 흐름 정리 — 주문 취소 결제  [용어: 버튼]'));
});

// 카드 i 의 제목 줄과 그 밑 4칸 들여쓴 몸통 줄들
function cardAt(out, i) {
  const lines = out.split(/\r?\n/);
  const at = lines.flatMap((l, n) => (l.startsWith('· [') ? [n] : []))[i];
  assert.notEqual(at, undefined, `카드 ${i} 가 없다:\n${out}`);
  const body = [];
  for (let n = at + 1; /^ {4}\S/.test(lines[n] ?? ''); n++) body.push(lines[n]);
  return { title: lines[at], body };
}

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

test('⭐ 훅 1단 카드 — 한글 토큰은 용어 키에만, 식별자 토큰은 값까지 맞춘다(채점 규칙 ③)', () => {
  const s = scene([{ req: '배송 상태 화면', terms: { 배송: 'shipping_status', 반품: '배송 후 7일 안에 return_flag' } }]);
  const ko = hook(s, '배송 지연').split(/\r?\n/);
  assert.ok(ko.includes('    배송 → shipping_status'));
  assert.ok(!ko.some((l) => l.startsWith('    반품 →')), '값 본문의 「배송」에 한글 토큰이 걸렸다');
  assert.ok(ko.includes('    … 이 질의와 안 걸린 항목 1개(키만): 반품'));
  const id = hook(s, 'return_flag 가 안 바뀐다').split(/\r?\n/);
  assert.ok(id.includes('    반품 → 배송 후 7일 안에 return_flag'));
  assert.ok(id.includes('    … 이 질의와 안 걸린 항목 1개(키만): 배송'));
});

test('⭐ 훅 1단 카드 — 펼치는 용어는 8줄까지이고 나머지는 접은 키로 간다', () => {
  const terms = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`배송${i + 1}`, `ship_${i + 1}`]));
  const lines = hook(scene([{ req: '배송 정책', terms }]), '배송 정책').split(/\r?\n/);
  assert.equal(lines.filter((l) => /^ {4}배송\d+ → /.test(l)).length, 8);
  assert.ok(lines.includes('    … 이 질의와 안 걸린 항목 2개(키만): 배송9 · 배송10'));
});

test('⭐ 훅 1단 카드 — 값이 160자를 넘으면 앞 160자 + …(전문: graph-find), 160자까지는 그대로', () => {
  const long = '가나다라마바사아자차'.repeat(20);   // 200자
  const edge = '카타파하'.repeat(40);                // 160자
  const lines = hook(scene([{ req: '배송 정책', terms: { 배송: long, 정책: edge } }]), '배송 정책').split(/\r?\n/);
  assert.ok(lines.includes(`    배송 → ${long.slice(0, 160)} …(전문: graph-find)`));
  assert.ok(lines.includes(`    정책 → ${edge}`));
});

// 부분 일치 용어 10개 뒤(기록 순서로 마지막)에 키가 토큰과 정확히 같은 용어 — 8줄 상한이 그것을 접으면 안 된다
function crowded(partial, exacts, query) {
  const terms = Object.fromEntries([...Array.from({ length: 10 }, (_, i) => partial(i + 1)), ...exacts]);
  const lines = hook(scene([{ req: '배송 정책', terms }]), query).split(/\r?\n/);
  return { arrows: lines.filter((l) => /^ {4}\S.* → /.test(l)), fold: lines.find((l) => l.startsWith('    … 이 질의와 안 걸린 항목')) };
}

test('⭐ 훅 1단 카드 — 키가 한글 토큰과 같은 용어는 8줄 상한에 접히지 않고 부분 일치보다 먼저 나온다', () => {
  const { arrows, fold } = crowded((n) => [`배송${n}`, `v_${n}`], [['배송', 'v_exact']], '배송 정책');
  assert.deepEqual(arrows, ['    배송 → v_exact', ...[1, 2, 3, 4, 5, 6, 7].map((n) => `    배송${n} → v_${n}`)]);
  assert.equal(fold, '    … 이 질의와 안 걸린 항목 3개(키만): 배송8 · 배송9 · 배송10');
});

test('⭐ 훅 1단 카드 — 정확히 같은 키끼리는 기록 순서를 지키고, 공백이 든 키도 정규화해 같으면 정확히 같다', () => {
  const { arrows, fold } = crowded((n) => [`배송${n}`, `v_${n}`], [['정책', 'v_e1'], ['배송 정책', 'v_e2']], '배송 정책');
  assert.deepEqual(arrows, ['    정책 → v_e1', '    배송 정책 → v_e2', ...[1, 2, 3, 4, 5, 6].map((n) => `    배송${n} → v_${n}`)]);
  assert.equal(fold, '    … 이 질의와 안 걸린 항목 4개(키만): 배송7 · 배송8 · 배송9 · 배송10');
});

test('⭐ 훅 1단 카드 — 키가 식별자와 같은 용어(대소문자 무시)도 값에 식별자가 든 용어보다 먼저 나온다', () => {
  const { arrows, fold } = crowded((n) => [`항목${n}`, `값 return_flag ${n}`], [['Return_Flag', 'v_exact']], 'RETURN_FLAG 확인');
  assert.deepEqual(arrows, ['    Return_Flag → v_exact', ...[1, 2, 3, 4, 5, 6, 7].map((n) => `    항목${n} → 값 return_flag ${n}`)]);
  assert.equal(fold, '    … 이 질의와 안 걸린 항목 3개(키만): 항목8 · 항목9 · 항목10');
});

test('⭐ 훅 1단 카드 — 걸린 용어가 하나도 없으면 앞 8개만 펼치고 나머지는 접은 키로 간다', () => {
  const terms = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`항목${i + 1}`, `v_${i + 1}`]));
  const lines = hook(scene([{ req: '배송 정책', terms }]), '배송 정책').split(/\r?\n/);
  assert.deepEqual(lines.filter((l) => /^ {4}항목\d+ → /.test(l)), [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `    항목${n} → v_${n}`));
  assert.ok(lines.includes('    … 이 질의와 안 걸린 항목 4개(키만): 항목9 · 항목10 · 항목11 · 항목12'));
});

test('⭐ 훅 1단 — 2위 카드는 정본 · 사전만 전문이고 그 밖은 제목 + 함정만(1위는 늘 전문)', () => {
  const NOTE = '재시도는 3회까지다';
  const first = { req: '배송 지연 화면 수정', terms: { 배송: 'shipping_status' }, files: ['src/ship.mjs'] };
  const second = (req, note) => ({ req, terms: { 알림: 'notify_rule' }, files: ['src/notify.mjs'], ...(note && { note }) });
  const cardsOf = (req, note) => {
    const out = hook(scene([first, second(req, note)]), '배송 지연');
    return [cardAt(out, 0), cardAt(out, 1)];
  };
  // 1위가 이력 종류여도 전문 — 첫째 카드는 늘 전문이다
  const [top, history] = cardsOf('배송 지연 알림 수정', NOTE);
  assert.match(top.title, /^· \[이력 · \d+점\] /);
  assert.deepEqual(top.body, ['    배송 → shipping_status', '    src/ship.mjs']);
  assert.match(history.title, /^· \[이력 · \d+점\] /);
  assert.deepEqual(history.body, [`    ⚠️ 함정: ${NOTE}`]);
  // 함정이 없으면 제목 줄만
  const [, research] = cardsOf('배송 알림 조사');
  assert.match(research.title, /^· \[조사 · \d+점\] /);
  assert.deepEqual(research.body, []);
  // 정본 · 사전은 2위여도 전문
  for (const [req, kind] of [['정본: 배송 알림 규칙', '절차'], ['용어 사전: 배송 알림', '사전']]) {
    const [, full] = cardsOf(req, NOTE);
    assert.match(full.title, new RegExp(`^· \\[${kind} · \\d+점\\] `));
    assert.deepEqual(full.body, [`    ⚠️ 함정: ${NOTE}`, '    알림 → notify_rule', '    src/notify.mjs']);
  }
});

test('⭐ 훅 1단 — 축약된 2위 카드는 용어가 12개이고 일부가 걸려도 제목 + 함정만이다(접은 키 줄도 없다)', () => {
  const NOTE = '재시도는 3회까지다';
  const first = { req: '배송 지연 화면 수정', terms: { 배송: 'shipping_status' }, files: ['src/ship.mjs'] };
  // 12개 중 2개(배송상태 · 지연사유)가 질의에 걸린다
  const terms = Object.fromEntries([['배송상태', 's'], ['지연사유', 'd'], ...Array.from({ length: 10 }, (_, i) => [`항목${i + 1}`, `v_${i + 1}`])]);
  const out = hook(scene([first, { req: '배송 지연 알림 수정', terms, files: ['src/notify.mjs'], note: NOTE }]), '배송 지연');
  const second = cardAt(out, 1);
  assert.match(second.title, /^· \[이력 · \d+점\] /);
  assert.deepEqual(second.body, [`    ⚠️ 함정: ${NOTE}`]);
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

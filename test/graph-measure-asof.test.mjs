// graph-measure --asof <날짜> — recorded 가 그 날짜 전인 기록만 남긴 판으로 잰다(되감기). 대체 사슬도 남은 기록 안에서 다시 선다. 합성 픽스처
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { graphInstall, put } from './scene.mjs';

const rec = (req, key, at, more = {}) => ({ req, terms: { [key]: `${key}_id` }, files: [`src/${key}.mjs`], date: at, recorded: at, ...more });
const RECS = [
  rec('주문 취소 흐름', '주문취소', '2026-09-01'),
  rec('배송 조회 화면', '배송조회', '2026-09-10'),
  // 대체 — 이 날 전 판에서는 옛 기록이 살아 있어야 한다
  rec('주문 취소 흐름 개정', '주문취소', '2026-10-01', { supersedes: ['주문 취소 흐름'] }),
  // 소급 — 일은 8월이지만 적은 것은 10월이다. date 로 자르면 샌다
  rec('환불 정산 배치', '환불정산', '2026-10-15', { date: '2026-08-01' }),
  // recorded 없는 구 기록 — date 로 본다
  JSON.stringify({ req: '회원 등급 계산', terms: { 회원등급: 'grade_id' }, files: ['src/grade.mjs'], date: '2026-08-20' }),
];
const TICKETS = JSON.stringify([{ title: '주문취소 안 됨' }, { title: '환불정산 배치 오류' }]);
const install = () => { const s = graphInstall(null, RECS); put(s.dir, 'tickets.json', TICKETS); return s; };
const self = (out) => out.match(/req 자기검색 1위 (\d+\/\d+)/)?.[1];

test('⭐ --asof L1 표 — 날짜마다 남는 기록: 뒤에 적은 기록 · 소급 기록은 빠지고, 그 뒤의 대체는 옛 기록을 죽이지 못한다', () => {
  const s = install();
  const before = readFileSync(s.store, 'utf8');
  // [날짜, 살아있는 기록 수, 주문취소 티켓의 1위, 확신 티켓 수]
  const TABLE = [
    ['2026-09-05', 2, '주문 취소 흐름×1', 1],   // 옛 정본 + 구 기록
    ['2026-09-10', 2, '주문 취소 흐름×1', 1],   // 그 날 적은 것은 「전」이 아니다
    ['2026-09-11', 3, '주문 취소 흐름×1', 1],
    ['2026-10-02', 3, '주문 취소 흐름 개정×1', 1],   // 대체가 들어와 옛 기록이 죽는다
    ['2026-10-16', 4, '주문 취소 흐름 개정×1', 2],   // 소급 기록은 적은 날부터
  ];
  for (const [date, alive, top, conf] of TABLE) {
    const r = s.run('graph-measure', ['--self', '.', '--asof', date]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(self(r.stdout), `${alive}/${alive}`, `${date}\n${r.stdout}`);
    assert.match(r.stdout, new RegExp(`질의 2 · 확신 ${conf} `), `${date}\n${r.stdout}`);
    assert.ok(r.stdout.includes(top), `${date}\n${r.stdout}`);
    assert.equal(r.stdout.includes('환불 정산 배치×1'), conf === 2, `${date}\n${r.stdout}`);
  }
  assert.equal(readFileSync(s.store, 'utf8'), before);
});

test('--asof — 되감지 못하는 것을 한 줄로 알린다(제자리 수정 · recorded 없는 기록). 기본 동작은 그대로다', () => {
  const s = install();
  const r = s.run('graph-measure', ['--self', '--asof', '2026-10-02']);
  assert.match(r.stdout, /되감기 — recorded 가 2026-10-02 전인 기록 4\/5건/);
  assert.match(r.stdout, /⚠️ 제자리 수정은 되감지 못함/);
  assert.match(r.stdout, /recorded 없는 1건은 date 로/);
  const plain = s.run('graph-measure', ['--self']);
  assert.equal(plain.stdout, 'req 자기검색 1위 4/4\n');
});

test('--asof — 훅을 띄우는 모드(--prompts)도 되감은 판을 본다', () => {
  const s = install();
  put(s.dir, 'sessions/a.jsonl', `${JSON.stringify({ type: 'user', message: { role: 'user', content: '환불정산 배치 어디야?' }, origin: { kind: 'human' }, promptSource: 'typed', timestamp: '2026-10-20T00:00:00Z' })}\n`);
  const conf = (date) => {
    const r = s.run('graph-measure', ['--prompts', 'sessions', ...(date ? ['--asof', date] : [])]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return r.stdout.split('\n').find((l) => l.startsWith('| 사람 |')).split('|')[4].trim();
  };
  assert.equal(conf('2026-10-15'), '0%');
  assert.equal(conf('2026-10-16'), '100%');
  assert.equal(conf(), '100%');
});

test('--asof — 날짜 꼴이 아니면 exit 1', () => {
  const r = install().run('graph-measure', ['--self', '--asof', '10월']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /⛔ --asof/);
});

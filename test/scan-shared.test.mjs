import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { target, repoFile } from './scene.mjs';

const SCAN = fileURLToPath(new URL('../tools/scan-shared.mjs', import.meta.url));
const run = (dir) => spawnSync(process.execPath, [SCAN, dir], { encoding: 'utf8' });
const HARNESS = { state: { decisions: 'docs/harness/decisions.md', lessons: 'docs/harness/lessons.md' }, checks: [] };
const TEMPLATE = JSON.parse(readFileSync(new URL('../templates/scan.json', import.meta.url), 'utf8'));
// 설치 직후와 같은 배치 — 공유되는 기록·규칙 파일과 기본 패턴
const installed = (extra = {}, scan = repoFile('templates/scan.json')) => target(HARNESS, {
  '.harness/scan.json': scan,
  '.claude/rules/harness.md': repoFile('templates/rules/harness.md'),
  '.claude/rules/graph.md': repoFile('templates/rules/graph.md'),
  'docs/harness/decisions.md': repoFile('templates/state/decisions.md'),
  'docs/harness/lessons.md': repoFile('templates/state/lessons.md'),
  ...extra,
});
const rec = (r) => `${JSON.stringify({ date: '2026-09-01', recorded: '2026-09-01', files: [], ...r })}\n`;

// 패턴마다 잡는 예 1 · 안 잡는 예 1 — ⛔ 합성 값만 쓴다
const CASES = {
  '사번 형식': ['담당 AB123456 이 확인했다', '날짜 표기는 ISO8601 이다'],
  '내부 도메인': ['절차는 wiki.corp 에 있다', '개인 설정은 .claude/settings.local.json 에 둔다'],
  'DB 접속 문자열': ['psql -h db01.example.com -U app 로 확인', 'psql 로 행 수를 봤다'],
  '이슈 번호': ['티켓 #1234 에서 시작했다', 'UTF-16 과 HTTP-404 는 번호가 아니다'],
  '실명이 든 파일명': ['첨부 제안서_홍길동_v1.0.pptx 참고', '첨부 인수인계.docx 참고'],
  '하이픈 복합 번호': ['연락처 010-1234-5678', '2026-10-02 에 적었다'],
  '자격증명 낱말': ['api_key = sk-test-000', '비밀번호 정책을 바꿨다'],
};

test('⭐ 기본 패턴 7종 — 각각 잡는 예는 잡고, 안 잡는 예는 안 잡는다', () => {
  assert.deepEqual(TEMPLATE.patterns.map((p) => p.id), Object.keys(CASES));
  for (const p of TEMPLATE.patterns) {
    const re = new RegExp(p.re, p.flags ?? '');
    const [hit, miss] = CASES[p.id];
    assert.ok(re.test(hit), `${p.id} 이 놓쳤다: ${hit}`);
    assert.ok(!re.test(miss), `${p.id} 이 오탐했다: ${miss}`);
  }
});

test('DB 접속 · 이슈 번호 — URI 와 CLI 인자 · KEY-123 과 <낱말> #123 둘 다', () => {
  const by = Object.fromEntries(TEMPLATE.patterns.map((p) => [p.id, new RegExp(p.re, p.flags ?? '')]));
  for (const s of ['postgres://app:pw@db.example.com:5432/shop', 'mysql -h 10.0.0.5 -u app', 'sqlcmd -S sql01 -d shop', 'redis-cli -h cache01']) assert.ok(by['DB 접속 문자열'].test(s), s);
  for (const s of ['SHOP-1234 에서 시작', '이슈#77 참고']) assert.ok(by['이슈 번호'].test(s), s);
  for (const s of ['ERR-01 은 오류 코드다', 'ISO-8859 인코딩']) assert.ok(!by['이슈 번호'].test(s), s);
});

test('⛔ 패턴마다 「놓치는 것」을 적는다 — 기본 패턴은 프로젝트 형식을 모른다', () => {
  for (const p of TEMPLATE.patterns) assert.ok(typeof p['놓치는 것'] === 'string' && p['놓치는 것'].length > 5, p.id);
  assert.match(TEMPLATE.patterns.find((p) => p.id === '내부 도메인')['놓치는 것'], /공개 TLD/);
});

test('⭐ 설치 직후(템플릿만)는 걸리는 것이 없다 — 기본 패턴이 배포물에 오탐하면 첫 커밋부터 막힌다', () => {
  const r = run(installed());
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /패턴 7종 · 파일 4개 · 걸린 것 0/);
});

test('⭐ reviewed: false 인 동안 「기본 패턴 그대로다」를 요약 위에 낸다 — exit 는 걸린 것으로만 정한다', () => {
  assert.equal(TEMPLATE.reviewed, false);
  const lines = run(installed()).stdout.trim().split(/\r?\n/);
  assert.equal(lines.at(-2), '⚠️ 기본 패턴 그대로다 — 이 프로젝트의 사번 · 내부 호스트 · 이슈 형식에 맞춘 뒤 reviewed: true');
  const ok = run(installed({}, JSON.stringify({ ...TEMPLATE, reviewed: true })));
  assert.equal(ok.status, 0);
  assert.doesNotMatch(ok.stdout, /기본 패턴 그대로다/);
});

test('⛔ 걸리면 exit 1 이고, 값은 가려서 파일:줄 과 함께 보여준다', () => {
  const dir = installed({
    '.harness/graph/requests.jsonl': [
      rec({ req: '권한 문의', note: '담당 AB123456 이 확인했다' }),
      rec({ req: '접속', note: 'wiki.corp 에 절차가 있다 · postgres://app:pw@db.example.com:5432/shop' }),
      rec({ req: '티켓 원문', note: 'SHOP-1234 에서 시작 · 첨부 보고서_김철수.xlsx · 연락처 010-1234-5678' }),
    ].join(''),
    'docs/harness/lessons.md': `${repoFile('templates/state/lessons.md')}| L001 | 검증 부족 | api_key = sk-test-000 | 비밀값을 그대로 적었다 | ⛔ 아직 없다 |\n`,
  });
  const r = run(dir);
  assert.equal(r.status, 1);
  for (const id of Object.keys(CASES)) assert.match(r.stdout, new RegExp(`\\[${id}\\]`), id);
  assert.doesNotMatch(r.stdout, /AB123456|SHOP-1234|김철수|sk-test-000|1234-5678/);
  assert.match(r.stdout, /\.harness[\\/]graph[\\/]requests\.jsonl:1 /);
});

test('공유되지 않는 소스는 보지 않는다 — 기록·장부·규칙만', () => {
  assert.equal(run(installed({ 'src/db.mjs': "export const url = 'postgres://u:p@db.example.com/x';\n" })).status, 0);
});

test('⛔ 패턴 파일이 없거나 정규식이 깨졌으면 실패한다 — 조용히 통과하면 검사가 없는 것과 같다', () => {
  const none = run(target(HARNESS, {}));
  assert.equal(none.status, 1);
  assert.match(none.stderr, /scan\.json/);
  const bad = run(target(HARNESS, { '.harness/scan.json': '{"patterns":[{"id":"깨짐","re":"("}]}' }));
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /깨짐/);
});

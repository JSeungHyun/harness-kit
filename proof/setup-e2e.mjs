#!/usr/bin/env node
// SETUP 종단 실측 — 새 Claude 세션이 SETUP 을 처음부터 끝까지 따르는가. 신규·기존 합성 대상에 설치시키고 check-install 로 판정한다. 설계안.
//   node proof/setup-e2e.mjs [--build-only] [--only new|existing]
// 토큰을 많이 쓴다(sonnet · 대상마다 최대 150턴). 실측이 사용자 전역 상태에 남긴 프로젝트 범위 플러그인 기록은 되돌린다.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkInstall } from './check-install.mjs';
import { cli } from '../lib/config.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const LONG_TMP = realpathSync.native(tmpdir());
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const sh = (cmd, cwd, input = '') => {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', input, maxBuffer: 1 << 26 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
function put(dir, rel, body) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
}
const git = (dir, a) => sh(`git -c user.email=dev@example.com -c user.name=dev ${a}`, dir);
const commit = (dir, msg, files = '-A') => {
  git(dir, `add ${files}`);
  const f = join(dir, '.git', 'COMMIT_MSG_E2E');
  writeFileSync(f, msg);
  return git(dir, `commit -q -F "${f}"`);
};
const PKG = {
  private: true, type: 'module',
  scripts: {
    pretest: "node -e \"require('fs').mkdirSync('test-results',{recursive:true})\"",
    test: 'node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=test-results/junit.xml "test/*.test.mjs"',
  },
};

// 신규 — 커밋 1 · 현업 용어가 든 README · 테스트 0개 · 브레인스토밍 스펙
export function buildNew(base = LONG_TMP) {
  const dir = mkdtempSync(join(base, 'e2e-new-'));
  git(dir, 'init -q -b main');
  put(dir, '.gitignore', 'node_modules/\ntest-results/\n');
  put(dir, 'package.json', { name: 'flower-booking', ...PKG });
  put(dir, 'README.md', '# 꽃집 예약\n\n동네 꽃집의 꽃다발 예약 앱. 손님이 **꽃다발 구성**을 고르고 **픽업 슬롯**을 잡은 뒤 **예약금**을 낸다.\n');
  put(dir, 'docs/spec.md', [
    '# 꽃집 예약 — 브레인스토밍 스펙 (2026-10-01 승인)', '',
    '## 용어 → 계획한 식별자', '',
    '| 현업 용어 | 계획한 식별자 | 뜻 |', '|---|---|---|',
    '| 예약금 | `Reservation.deposit` | 예약 확정 때 받는 선금 — 픽업 24시간 전까지 취소하면 돌려준다 |',
    '| 픽업 슬롯 | `PickupSlot` | 30분 단위 수령 시간대 — 슬롯마다 최대 4건 |',
    '| 꽃다발 구성 | `Bouquet.items` | 손님이 고른 꽃 종류와 송이 수 |', '',
    '## 범위', '', '- 1차: 예약 생성 · 슬롯 조회 · 예약금 환불 규칙', '',
  ].join('\n'));
  commit(dir, 'chore: 프로젝트 시작 — README · 스펙');
  return dir;
}

// 기존 — 커밋 26 (fix 3 은 본문에 근본 원인) · src 모듈 · 통과 6 + 원래 있던 실패 1 · AGENTS.md(전역 무시라 add -f) · 인수인계 문서
export function buildExisting(base = LONG_TMP) {
  const dir = mkdtempSync(join(base, 'e2e-existing-'));
  git(dir, 'init -q -b main');
  put(dir, '.gitignore', 'node_modules/\ntest-results/\n');
  put(dir, 'package.json', { name: 'shop-backoffice', ...PKG });
  put(dir, 'src/order.mjs', 'export const createOrder = (items) => ({ items, status: \'접수\' });\n');
  put(dir, 'src/stock.mjs', 'export const reserve = (stock, n) => (stock >= n ? stock - n : null);\n');
  put(dir, 'src/point.mjs', 'export const pointBalance = (member) => (member.left ? 0 : member.point_balance);\n');
  put(dir, 'src/money.mjs', 'export const won = (n) => Math.round(n);\nexport const vat = (n) => won(n * 0.1);\n');
  put(dir, 'test/shop.test.mjs', [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { createOrder } from '../src/order.mjs';",
    "import { reserve } from '../src/stock.mjs';",
    "import { pointBalance } from '../src/point.mjs';",
    "import { vat } from '../src/money.mjs';",
    "test('주문서를 접수 상태로 만든다', () => assert.equal(createOrder([1]).status, '접수'));",
    "test('재고가 모자라면 예약하지 않는다', () => assert.equal(reserve(1, 2), null));",
    "test('재고를 예약하면 줄어든다', () => assert.equal(reserve(5, 2), 3));",
    "test('탈퇴 회원의 적립금은 0 이다', () => assert.equal(pointBalance({ left: true, point_balance: 9 }), 0));",
    "test('적립금 잔액을 돌려준다', () => assert.equal(pointBalance({ point_balance: 7 }), 7));",
    "test('부가세를 원 단위로 반올림한다', () => assert.equal(vat(1005), 101));",
    "test('옛 반올림 규칙 — 부가세 절사', () => assert.equal(vat(1005), 100));",
    '',
  ].join('\n'));
  commit(dir, 'feat: 주문·재고·적립금 첫 모듈');
  put(dir, 'AGENTS.md', [
    '# 쇼핑몰 백오피스 — 에이전트 지시', '',
    '## 빌드 · 테스트', '', '- 테스트: `npm test` (결과 XML 은 `test-results/`)', '',
    '## 금지', '', '- `src/money.mjs` 의 반올림 규칙은 회계팀 확인 없이 바꾸지 않는다', '- 운영 DB 에 직접 쓰는 스크립트를 커밋하지 않는다', '',
    '## 용어', '', '| 현업 용어 | 코드 |', '|---|---|',
    '| 주문서 | `createOrder` (src/order.mjs) |', '| 재고 | `reserve` (src/stock.mjs) |', '| 적립금 | `point_balance` (src/point.mjs) |', '',
  ].join('\n'));
  commit(dir, 'docs: 에이전트 지시', '-f AGENTS.md');
  put(dir, 'docs/handover.md', [
    '# 인수인계 — 백오피스 용어 사전', '',
    '| 현업 용어 | 시스템에서 | 비고 |', '|---|---|---|',
    '| 주문서 | `createOrder` 가 만드는 객체 | 상태는 접수 → 출고 대기 → 완료 |',
    '| 출고 대기 | 주문 `status` = 출고대기 | 재고 예약이 끝난 주문 |',
    '| 재고 실사 | 월말 `reserve` 잔량 대조 | 차이는 수기로 맞춘다 |',
    '| 적립금 소멸 | `point_balance` 를 0 으로 | 탈퇴 시 즉시 · 1년 미사용 시 일괄 |',
    '| 반품 회수 | 반품 주문의 재고 복원 | 아직 코드 없음 — 수기 처리 |', '',
  ].join('\n'));
  commit(dir, 'docs: 인수인계 용어 사전');
  const steps = [
    ['feat: 주문서에 메모 칸', 'src/order.mjs', "export const memo = (o, m) => ({ ...o, memo: m });\n"],
    ['feat: 출고 대기 상태 추가', 'src/order.mjs', "export const ready = (o) => ({ ...o, status: '출고대기' });\n"],
    ['fix: 재고가 음수로 내려간다', 'src/stock.mjs', 'export const release = (stock, n) => stock + n;\n',
      '\n\n근본 원인: 동시에 들어온 두 주문이 같은 재고를 읽고 각각 차감했다 — 읽기와 차감 사이에 잠금이 없었다.\n재발 방지: reserve 가 모자라면 null 을 돌려주고, 호출부는 null 을 거절로 처리한다.'],
    ['feat: 재고 실사 리포트', 'src/stock.mjs', 'export const audit = (book, real) => real - book;\n'],
    ['feat: 적립금 내역 조회', 'src/point.mjs', 'export const history = (m) => m.history ?? [];\n'],
    ['fix: 탈퇴 회원 적립금이 남아 보인다', 'src/point.mjs', 'export const isLeft = (m) => Boolean(m.left);\n',
      '\n\n근본 원인: 탈퇴 처리가 회원 상태만 바꾸고 point_balance 조회는 상태를 보지 않았다.\n이제 pointBalance 가 탈퇴 회원에 0 을 돌려준다 — test/shop.test.mjs 「탈퇴 회원의 적립금은 0 이다」가 막는다.'],
    ['feat: 부가세 계산', 'src/money.mjs', 'export const total = (n) => n + vat(n);\n'],
    ['fix: 부가세가 1원씩 어긋난다', 'src/money.mjs', 'export const round = (n) => Math.round(n);\n',
      '\n\n근본 원인: 부동소수점 곱셈 결과를 그대로 더해 0.5 근처에서 반올림 방향이 갈렸다.\n금액은 원 단위 정수로 바꾼 뒤 계산한다. 옛 절사 규칙 테스트는 회계팀 확인 전이라 그대로 둔다.'],
  ];
  for (let i = 0; i < 22; i++) {
    const [msg, file, line, body = ''] = steps[i] ?? [`chore: 정리 ${i}`, 'docs/changelog.md', `- 정리 ${i}\n`];
    put(dir, file, `${existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8') : ''}${line}`);
    commit(dir, `${msg}${body}`);
  }
  return dir;
}

// 신규는 공유 모드를 명시해 두 모드를 다 잰다 — 기본값(로컬)만 재면 공유 경로(부정 규칙 · pre-commit 스캔)가 실측되지 않는다
const PLAN = { new: { mode: 'share', extra: ' 설치 모드는 팀 공유로 고른다.' }, existing: { mode: 'local', extra: '' } };
const PROMPT = (kit, extra) => `${kit}/SETUP.md 를 읽고 이 프로젝트에 적용해줘.${extra} 비대화형 실행이다 — 사용자 확인 자리는 SETUP 이 정한 제안값으로 진행하고, 「원래 있던 실패인가」는 「예」로 보고 진행하고, 모두 보고의 「사용자가 결정해야 하는 것」에 남겨라.`;
const ALLOWED = 'Read Write Edit Glob Grep Bash(git *) Bash(node *) Bash(npm *) Bash(mkdir *) Bash(cp *) Bash(ls *) Bash(cat *) Bash(grep *) Bash(cd *) Bash(echo *) Bash(claude --version) Bash(claude plugin list *) Bash(claude -p *)';
const DENIED = 'Bash(claude plugin install *) Bash(claude plugin marketplace *) Bash(git push *) Bash(rm *)';

function session(dir, kit, extra) {
  // ⛔ 프롬프트는 -p 바로 뒤에 — --allowedTools · --disallowedTools 는 가변 인자라 뒤에 오는 프롬프트를 도구 규칙으로 삼킨다(실측)
  const cmd = `claude -p ${JSON.stringify(PROMPT(kit.replace(/\\/g, '/'), extra))} --model sonnet --max-turns 150 --output-format json --add-dir "${kit}" --allowedTools "${ALLOWED}" --disallowedTools "${DENIED}"`;
  return new Promise((done) => {
    const started = Date.now();
    const p = spawn(cmd, { cwd: dir, shell: true });
    let out = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { out += c; });
    p.stdin.end();
    p.on('close', (code) => {
      let j = {};
      try { j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); } catch { /* 보고가 JSON 이 아니면 원문을 남긴다 */ }
      done({ code, minutes: ((Date.now() - started) / 60000).toFixed(1), turns: j.num_turns, cost: j.total_cost_usd, report: j.result ?? out });
    });
  });
}

const ask = (dir, q) =>
  sh(`claude -p --model haiku --tools "" --no-session-persistence ${JSON.stringify(`도구를 쓰지 마라. ${q} 주어진 지시에 없으면 정확히 '모름'이라고만 답하라.`)}`, dir).out.trim();
function ruleLoad(dir) {
  const done = ask(dir, '이 저장소에서 코드를 바꾼 작업의 완료를 주장하기 전에 반드시 돌려야 하는 명령은 정확히 무엇인가?');
  const graph = ask(dir, '이 저장소에서 과거 요구와 현업 용어를 찾을 때 먼저 돌리는 명령은 정확히 무엇인가?');
  const neg = ask(dir, '이 저장소의 배포 승인권자는 누구인가?');
  return [
    ['양성 — 완료 명령', done.includes('verify.mjs'), done],
    ['양성 — 그래프 조회 명령', graph.includes('graph-find'), graph],
    ['음성 — 지시에 없는 사실', neg.includes('모름'), neg],
  ];
}

// 대상 경로를 가리키는 플러그인 기록을 지운다 — 공유는 project 범위, 로컬 전용은 settings.local.json 이라 local 범위로 생긴다(실측)
function cleanup(dir) {
  const file = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
  const norm = (p) => resolve(p).replace(/\\/g, '/').toLowerCase();
  const records = () => Object.entries(JSON.parse(readFileSync(file, 'utf8')).plugins ?? {})
    .flatMap(([id, arr]) => arr.filter((e) => ['project', 'local'].includes(e.scope) && e.projectPath && norm(e.projectPath) === norm(dir)).map((e) => `${id}@@${e.scope}`));
  const found = records();
  for (const r of found) {
    const [id, scope] = r.split('@@');
    sh(`claude plugin uninstall ${id} --scope ${scope} --keep-data`, dir);
  }
  return { found: found.map((r) => r.replace('@@', ' ')), left: records() };
}

const line1 = (s) => String(s).trim().split(/\r?\n/)[0].slice(0, 70);
const cell = (s) => String(s).replace(/\|/g, '\\|');
const PLUGINS = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
const snapshot = () => Object.entries(JSON.parse(readFileSync(PLUGINS, 'utf8')).plugins ?? {})
  .flatMap(([id, arr]) => arr.map((e) => `${id} ${e.scope} ${e.projectPath ?? ''}`)).sort().join(' · ');

cli(import.meta.url, async () => {
  const targets = [['new', buildNew], ['existing', buildExisting]].filter(([p]) => !only || p === only);
  const built = targets.map(([profile, make]) => ({ profile, ...PLAN[profile], dir: make() }));
  for (const t of built) console.log(`대상 ${t.profile}/${t.mode}: ${t.dir}`);
  if (args.includes('--build-only')) return;

  const before = snapshot();
  const results = await Promise.all(built.map(async (t) => ({ ...t, run: await session(t.dir, KIT, t.extra) })));
  let ok = true;
  for (const t of results) {
    const reportPath = join(dirname(t.dir), `${t.dir.split(/[\\/]/).pop()}-report.md`);
    writeFileSync(reportPath, String(t.run.report));
    const rows = checkInstall(t.dir, t.profile, t.mode);
    const load = ruleLoad(t.dir);
    const clean = cleanup(t.dir);
    ok &&= rows.every((r) => r.ok) && load.every(([, pass]) => pass) && clean.left.length === 0;
    console.log(`\n### ${t.profile === 'new' ? '신규' : '기존'} · ${t.mode === 'share' ? '공유' : '로컬 전용'} — ${t.dir}\n`);
    console.log(`세션: exit ${t.run.code} · ${t.run.minutes}분 · ${t.run.turns ?? '?'}턴 · $${t.run.cost ?? '?'} · 보고 ${reportPath}\n`);
    console.log('| 묶음 | 기대 | 관측 | 맞나 |\n|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.group} | ${r.what} | ${cell(r.observed)} | ${r.ok ? '✅' : '⛔'} |`);
    for (const [what, pass, answer] of load) console.log(`| 규칙 로드 | ${what} | 「${cell(line1(answer))}」 | ${pass ? '✅' : '⛔'} |`);
    console.log(`| 정리 | 이 대상의 프로젝트 범위 플러그인 기록 | 찾음 ${clean.found.join(', ') || '없음'} → 남음 ${clean.left.length} | ${clean.left.length === 0 ? '✅' : '⛔'} |`);
  }
  const after = snapshot();
  ok &&= after === before;
  console.log(`\n| 정리 | 실측 전·후 플러그인 기록 전체 | ${after === before ? `같다 (${before})` : `다르다 — 전: ${before} / 후: ${after}`} | ${after === before ? '✅' : '⛔'} |`);
  process.exit(ok ? 0 : 1);
});


import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.mjs';
import { target, repoFile } from './scene.mjs';
import { DOCS } from '../lib/parts.mjs';

const at = (rel) => new URL(`../${rel}`, import.meta.url);
const SHIPPED = [
  'SETUP.md',
  'README.md',
  'docs/proof.md',
  'templates/rules/harness.md',
  'templates/rules/graph.md',
  'templates/map/AGENTS.md',
  'templates/map/CLAUDE.local.md',
];

test('⛔ 배포 문서가 가리키는 도구가 실재한다 — 깨진 참조는 설치된 규칙을 거짓말로 만든다', () => {
  for (const rel of SHIPPED) {
    for (const [, name] of repoFile(rel).matchAll(/\.harness\/tools\/([\w-]+\.mjs)/g)) {
      assert.ok(existsSync(at(`tools/${name}`)), `${rel} → tools/${name}`);
    }
    for (const [, name] of repoFile(rel).matchAll(/policy-apply\.mjs[^\n]*--with ([\w-]+)/g)) {
      assert.ok(existsSync(at(`policy/${name}.json`)), `${rel} → policy/${name}.json`);
    }
  }
});

test('⛔ SETUP 이 복사하라는 것이 실재한다', () => {
  const refs = [...repoFile('SETUP.md').matchAll(/<kit>\/((?:templates|lib|tools|policy)[\w./-]*)/g)];
  assert.ok(refs.length > 5);
  for (const [, rel] of refs) assert.ok(existsSync(at(rel)), `SETUP.md → ${rel}`);
  // Windows 의 Claude Code 는 NoDefaultCurrentDirectoryInExePath=1 이라 저장소 안 래퍼는 .\ 를 붙여야 돈다(첫 실전 적용)
  assert.match(repoFile('SETUP.md').split(/\r?\n/).find((l) => l.startsWith('| Gradle |')) ?? '', /`\.\\gradlew cleanTest test`/);
  // vitest 는 리포터를 명령에 붙여야 매 실행 새 XML 을 쓴다 — package.json 을 고치지 않는다(실전 적용)
  assert.match(repoFile('SETUP.md').split(/\r?\n/).find((l) => l.startsWith('| Node (vitest) |')) ?? '', /--reporter=junit --outputFile\.junit=test-results\/junit\.xml/);
});

test('규칙 파일이 완료 명령과 검사가 덮지 않은 코드의 /code-review 를 지시한다', () => {
  const rules = repoFile('templates/rules/harness.md');
  assert.match(rules, /node \.harness\/tools\/verify\.mjs/);
  assert.match(rules, /검사가 덮지 않은 코드 변경이면 `\/code-review`/);
});

test('⭐ 덜어낸 판(22차) — 측정한 묶음에서 뺀 절 · 구절이 다시 들어오지 않았다', () => {
  const h = repoFile('templates/rules/harness.md');
  const g = repoFile('templates/rules/graph.md');
  assert.doesNotMatch(h, /^## (흐름|장부|플러그인)/m);
  assert.doesNotMatch(g, /^## (1|2|4|5|6)\. /m);
  assert.doesNotMatch(h, /Stop 훅/);
  assert.doesNotMatch(g, /살아있는 기록 20건 이상/);
  // 관문 훅은 걷었다 — 규칙이 그 훅을 있다고 말하지 않는다
  assert.doesNotMatch(h + g, /관문|gate-hook/);
});

test('그래프 규칙 — 기록 단계 · 기록 단위 · 개인 식별자 금지 · 끝내기 전 확인 · 120줄 안', () => {
  const g = repoFile('templates/rules/graph.md');
  assert.match(g, /graph-find\.mjs --check/);
  assert.match(g, /같은 질문에서 함께 필요한가/);
  assert.match(g, /커밋에서 만든 기록은 `terms` 를 채워야/);
  assert.match(g, /개인 식별자/);
  // 형식 판정만으로는 도구 사용법 조사가 통과한다 — 주제 판정이 먼저, 「한 세트」가 그 문을 건너뛰지 않는다
  assert.match(g, /첫째 문 — 이 저장소의 지식인가/);
  assert.match(g, /「파일 목록 보고와 한 세트」가 이 문을 건너뛰게 하지 않는다/);
  // 첫째 문과 graph-append 의 저장소 밖 거부 문구가 같은 순서 — 기록하지 않는 길이 먼저, 들이고 뺀 결정은 scope:meta(13차)
  const door = g.split(/\r?\n/).find((l) => l.includes('첫째 문 — 이 저장소의 지식인가'));
  const refuse = repoFile('tools/graph-append.mjs').split(/\r?\n/).find((l) => l.includes('offRepo(out)'));
  for (const text of [door, refuse]) assert.ok(text.indexOf('기록하지 않는다') >= 0 && text.indexOf('기록하지 않는다') < text.indexOf('"scope":"meta"'), text);
  assert.match(door, /상관없는 파일을 넣지 않는다/);
  assert.ok(g.split(/\r?\n/).length <= 120);
  assert.doesNotMatch(g, /PostgreSQL|pg_description|writing-plans|--promote|graph-view/);
});

test('훅 조건이 SETUP · graph-hook 정책에서 같다', () => {
  for (const rel of ['SETUP.md', 'policy/graph-hook.json']) assert.match(repoFile(rel), /상위3 점유 < 50%/, rel);
});

test('⭐ 조건 전에 그래프 훅을 켜는 사용자 결정이 SETUP · graph-hook 정책에서 같다 — 20건을 넘기면 점유를 다시 잰다(10차: 맡긴 설치가 「⛔ 20건 전 훅」과 부딪혀 사용자에게 다시 물었다)', () => {
  for (const rel of ['SETUP.md', 'policy/graph-hook.json']) assert.match(repoFile(rel), /사용자가 조건 전에 켜기로 정/, rel);
  assert.match(repoFile('SETUP.md'), /20건을 넘기면 점유/);
  assert.match(repoFile('SETUP.md'), /^\| 사용자가 정하지 않았는데 그래프 20건 전에 훅 \|/m);
});

test('⭐ 테스트 없는 기존 대상도 ⑤ 「테스트 러너가 아직 없다」 행이고, 그때 verify 는 코드 변경의 증거가 아니다 — 관문의 /code-review 를 가리킨다(10차: 기존 · 테스트 없음 설치 2곳)', () => {
  const row = repoFile('SETUP.md').split(/\r?\n/).find((l) => l.startsWith('| 테스트 러너가 아직 없다')) ?? '';
  assert.match(row, /기존/);
  assert.match(row, /\/code-review/);
  assert.match(row, /빌드/);
});

test('지도 다리 — CLAUDE.md 는 AGENTS.md 를 import 만 한다', () => {
  assert.match(repoFile('templates/map/CLAUDE.md'), /^@AGENTS\.md\r?\n/);
});

test('⛔ 배포물에 설계안 딱지가 있다', () => {
  for (const rel of SHIPPED.filter((r) => r.endsWith('.md'))) assert.match(repoFile(rel), /설계안/, rel);
});

test('설치 템플릿 harness.json 이 로더를 통과하고 프로필·모드 자리를 둔다', () => {
  const raw = JSON.parse(repoFile('templates/harness.json'));
  assert.ok('profile' in raw && 'mode' in raw);
  const cfg = loadConfig(target(null, { '.harness/harness.json': repoFile('templates/harness.json') }));
  assert.equal(cfg.checks.length, 1);
  assert.equal(raw.state, undefined);
});

test('⛔ 지도 골격의 <…> 는 채울 자리뿐이다 — 명령 인자를 <…> 로 쓰면 채운 뒤에도 남은 자리로 보인다', () => {
  for (const rel of ['templates/map/AGENTS.md', 'templates/map/CLAUDE.local.md']) assert.doesNotMatch(repoFile(rel), /`node [^`]*<[^>`]+>/, rel);
});

test('⛔ 플러그인은 plugin-plan 을 거쳐 사용자 범위로 — 키트 마켓 경로는 PC 마다 달라 프로젝트 설정에 넣지 않는다', () => {
  const s = repoFile('SETUP.md');
  assert.match(s, /tools\/plugin-plan\.mjs/);
  assert.doesNotMatch(s, /claude plugin (install|marketplace add) [^\n`]*--scope/);
});

test('⑧-b 규칙 로드는 sonnet · --strict-mcp-config 로 잰다 — haiku 는 규칙이 실려도 「모름」으로 빠지고, --tools "" 는 MCP 를 막지 않는다', () => {
  const lines = repoFile('SETUP.md').split(/\r?\n/).filter((l) => l.startsWith('claude -p') && l.includes('--tools ""'));
  assert.equal(lines.length, 3);
  for (const l of lines) assert.match(l, /--model sonnet .*--strict-mcp-config/);
  for (const f of ['proof/run.mjs', 'proof/setup-e2e.mjs']) assert.match(repoFile(f), /claude -p --model sonnet --tools "" --strict-mcp-config/, f);
});

test('⛔ 이전은 정책 반영보다 먼저 — 거꾸로면 옛 선언은 걷히고 새 플러그인은 없다 · 플러그인은 PC 에서 켜고 ponytail 은 리뷰 스킬만', () => {
  const setup = repoFile('SETUP.md');
  assert.ok(setup.indexOf('tools/plugin-plan.mjs') < setup.indexOf('node .harness/tools/policy-apply.mjs'));
  assert.match(setup, /사용자 스킬 `ponytail-review`/);
  assert.match(setup, /선언하지 않는다/);
});

test('⛔ 이 레포의 템플릿이 커밋에서 빠지지 않는다 — 전역 gitignore 가 AGENTS.md · CLAUDE.md 를 무시하는 PC 가 있다', () => {
  const kit = fileURLToPath(new URL('..', import.meta.url));
  const r = spawnSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', 'templates'], { cwd: kit, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '');
});

test('⛔ 설치되는 템플릿 · 정책 · SETUP 이 키트에서 지운 도구를 가리키지 않는다 — 설치본 규칙이 없는 도구를 시킨다', () => {
  const gone = JSON.parse(repoFile('policy/removed.json')).files.map((f) => f.split('/').pop().replace(/\.mjs$/, ''));
  for (const rel of ['templates/rules/harness.md', 'templates/rules/graph.md', 'templates/harness.json', 'policy/settings.json', 'SETUP.md']) {
    for (const g of gone) assert.ok(!repoFile(rel).includes(g), `${rel} → ${g}`);
  }
});

test('⛔ 키트 소유 · 프로젝트 설정 · 프로젝트 데이터는 lib/parts.mjs 한 곳 — SETUP · 이식 검사 · 구조 문서가 「다를 수 있는 것」을 따로 적지 않고, 갱신 경로 상수를 도구가 다시 정의하지 않는다(14차)', () => {
  assert.match(repoFile('SETUP.md'), /<kit>\/lib\/parts\.mjs/);
  for (const rel of ['SETUP.md', 'tools/install-check.mjs', 'docs/structure.md']) assert.doesNotMatch(repoFile(rel), /다를 수 있는 것/, rel);
  for (const rel of ['tools/upgrade.mjs', 'tools/install-check.mjs']) assert.doesNotMatch(repoFile(rel), /(SHIPPED|DOCS) = \[/, rel);
});

test('⭐ SETUP 의 「테스트 없음」 선언은 검사의 "tests": "none" + why 하나 — ⑤ 「테스트 러너가 아직 없다」 행 · 갱신의 covers 멈춤 줄이 그것을 가리킨다', () => {
  const setup = repoFile('SETUP.md');
  const row = setup.split(/\r?\n/).find((l) => l.startsWith('| 테스트 러너가 아직 없다')) ?? '';
  assert.match(row, /"tests": "none"/);
  const stop = setup.split(/\r?\n/).find((l) => l.includes('covers 를 가진 검사가 없다`')) ?? '';
  assert.match(stop, /"tests": "none"/);
});

// 깔리는 규칙 — 설치마다 같은 판으로 실린다
const INSTALLED = DOCS.map(([src]) => src);

test('⛔ 깔리는 문서는 설치마다 다른 경로(기록 저장소 · 장부)를 박지 않는다 — graph.store · state 를 바꾼 설치에서 거짓 안내가 된다', () => {
  for (const rel of INSTALLED) {
    for (const p of ['.harness/graph/requests.jsonl', '.harness/state/decisions.md', '.harness/state/lessons.md', '<decisions>', '<lessons>']) assert.ok(!repoFile(rel).includes(p), `${rel} — ${p}`);
  }
});

test('⛔ 깔리는 문서가 가리키는 「아래 …」 · 「N째 문」이 그 파일에 있다 — 덜어낸 절을 가리키는 문장이 남지 않게', () => {
  for (const rel of INSTALLED) {
    const s = repoFile(rel);
    for (const m of s.matchAll(/아래 「([^」]+)」/g)) assert.ok(s.indexOf(m[1], m.index + m[0].length) > 0, `${rel} — ${m[0]}`);
    for (const m of s.matchAll(/([둘셋넷])째 문/g)) assert.ok(s.includes(`**${m[1]}째 문`), `${rel} — ${m[0]} 정의 없음`);
  }
});

test('⭐ 덜어낸 판(25차) — final-gate · 구현/검증 에이전트 · 장부 틀 · 장부 도구가 키트에서 사라졌고 규칙이 그것을 말하지 않는다 · 깔리는 문서에 장부 자리 채움이 없다', () => {
  for (const rel of ['templates/skills/final-gate/SKILL.md', 'templates/agents/kit-implementer.md', 'templates/agents/kit-verifier.md', 'templates/state/decisions.md', 'templates/state/lessons.md', 'tools/decision-check.mjs', 'tools/lesson-append.mjs']) {
    assert.equal(existsSync(at(rel)), false, rel);
  }
  const rules = repoFile('templates/rules/harness.md') + repoFile('templates/rules/graph.md');
  assert.doesNotMatch(rules, /final-gate|kit-implementer|kit-verifier|decision-check|lesson-append|장부|<decisions>|<lessons>/);
  assert.doesNotMatch(repoFile('templates/rules/graph.md'), /^## 8\. /m);
  assert.doesNotMatch(repoFile('templates/harness.json'), /장부|"state"/);
});

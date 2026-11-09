import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.mjs';
import { target, repoFile } from './scene.mjs';

const at = (rel) => new URL(`../${rel}`, import.meta.url);
const SHIPPED = [
  'SETUP.md',
  'README.md',
  'docs/proof.md',
  'templates/rules/harness.md',
  'templates/rules/graph.md',
  'templates/skills/final-gate/SKILL.md',
  'templates/map/AGENTS.md',
  'templates/map/CLAUDE.local.md',
  'templates/state/decisions.md',
  'templates/state/lessons.md',
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

test('규칙 파일이 완료 명령과 관문을 지시하고, SETUP 이 채울 자리를 둔다', () => {
  const rules = repoFile('templates/rules/harness.md');
  assert.match(rules, /node \.harness\/tools\/verify\.mjs/);
  assert.match(rules, /보고하기 직전에 매번 `final-gate`/);
  assert.match(rules, /<decisions>/);
  assert.match(rules, /<lessons>/);
});

test('그래프 규칙 — 조회 먼저 · 판단 규칙 상위 5 · 기록 단위 · 개인 식별자 금지 · 훅 조건 · 120줄 안', () => {
  const g = repoFile('templates/rules/graph.md');
  assert.match(g, /node \.harness\/tools\/graph-find\.mjs <어근/);
  // docs/graph-port.md §3 — 예시 낱말 금지는 원문 그대로
  assert.match(g, /\*\*예시 낱말을 어느 필드에도 넣지 않는다 — 전 필드가 색인된다\.\*\*/);
  assert.match(g, /자기점검: 기록을 넣은 뒤 그 낱말로 조회해 엉뚱한 게 1위면 오염된 것이다/);
  for (const re of [/행동은 지침, 사실은 그래프/, /원천 3분류/, /⚠️ 미확정/, /정본 1건으로 통합/, /같은 질문에서 함께 필요한가/, /커밋에서 만든 기록은 `terms` 를 채워야/]) assert.match(g, re);
  assert.match(g, /개인 식별자/);
  // 형식 판정만으로는 도구 사용법 조사가 통과한다 — 주제 판정이 먼저, 「한 세트」가 그 문을 건너뛰지 않는다
  assert.match(g, /첫째 문 — 이 저장소의 지식인가/);
  assert.match(g, /「파일 목록 보고와 한 세트」가 이 문을 건너뛰게 하지 않는다/);
  // 훅 조건 — 건수는 대리 지표, 조건은 상위3 점유 (design §5·§6)
  assert.match(g, /20건 이상 \+ `--check` exit 0 \+ 상위3 점유 < 50%/);
  assert.match(g, /graph-measure\.mjs \. --tickets/);
  assert.match(g, /독점 미측정/);
  assert.match(g, /20건 42%.*켠 뒤에도 잰다/);
  assert.doesNotMatch(g, /측정된 값이 아니다/);
  // 근거 등급 — 피해가 가장 크다 · 새 원천도 단일 증거 · 확인차 재조회의 예외
  assert.match(g, /빈도순 — 피해는 ④가 가장 크다\(거짓이 사실로 유통된다\)/);
  assert.match(g, /새 원천\(문서 · DB 코멘트 · 담당자 답변 · 지난 세션 기록\)도 단일 증거다/);
  assert.match(g, /확인차.*다시 보지 않는다.*단, 새 원천이 기존 기록과 다른 값을 말하면 그때는 다시 본다/);
  assert.ok(g.split(/\r?\n/).length <= 120);
  assert.doesNotMatch(g, /PostgreSQL|pg_description|writing-plans|--promote|graph-view/);
});

test('훅 조건이 graph.md · SETUP · graph-hook 정책에서 같다', () => {
  for (const rel of ['templates/rules/graph.md', 'SETUP.md', 'policy/graph-hook.json']) assert.match(repoFile(rel), /상위3 점유 < 50%/, rel);
});

test('⭐ 조건 전에 그래프 훅을 켜는 사용자 결정이 graph.md · SETUP · graph-hook 정책에서 같다 — 20건을 넘기면 점유를 다시 잰다(10차: 맡긴 설치가 「⛔ 20건 전 훅」과 부딪혀 사용자에게 다시 물었다)', () => {
  for (const rel of ['templates/rules/graph.md', 'SETUP.md', 'policy/graph-hook.json']) assert.match(repoFile(rel), /사용자가 조건 전에 켜기로 정/, rel);
  for (const rel of ['templates/rules/graph.md', 'SETUP.md']) assert.match(repoFile(rel), /20건을 넘기면 점유/, rel);
  assert.match(repoFile('SETUP.md'), /^\| 사용자가 정하지 않았는데 그래프 20건 전에 훅 \|/m);
});

test('⭐ 테스트 없는 기존 대상도 ⑤ 「테스트 러너가 아직 없다」 행이고, 그때 verify 는 코드 변경의 증거가 아니다 — 관문의 /code-review 를 가리킨다(10차: 기존 · 테스트 없음 설치 2곳)', () => {
  const row = repoFile('SETUP.md').split(/\r?\n/).find((l) => l.startsWith('| 테스트 러너가 아직 없다')) ?? '';
  assert.match(row, /기존/);
  assert.match(row, /\/code-review/);
  assert.match(row, /빌드/);
});

test('SETUP ④ 표 — import 없는 `CLAUDE.md` 단독도 「그대로」 행이다 · ⑦ lesson 필드는 규칙 파일의 예시를 가리킨다(10차)', () => {
  const setup = repoFile('SETUP.md');
  assert.match(setup, /^\| `CLAUDE\.md` 만 \(import 유무와 무관\)/m);
  assert.match(setup, /lesson-append\.mjs`[^\n]*\.claude\/rules\/harness\.md/);
});

test('final-gate 스킬의 이름이 디렉터리 이름과 같고, 보고 직전에 매번 쓰인다', () => {
  const s = repoFile('templates/skills/final-gate/SKILL.md');
  assert.match(s, /^---\r?\nname: final-gate\r?\n/);
  assert.match(s, /^description: 작업을 끝냈다고 보고하기 직전에 매번/m);
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
  assert.ok(cfg.state.decisions && cfg.state.lessons);
});

test('⛔ 지도 골격의 <…> 는 채울 자리뿐이다 — 명령 인자를 <…> 로 쓰면 채운 뒤에도 남은 자리로 보인다', () => {
  for (const rel of ['templates/map/AGENTS.md', 'templates/map/CLAUDE.local.md']) assert.doesNotMatch(repoFile(rel), /`node [^`]*<[^>`]+>/, rel);
});

test('⛔ 플러그인은 plugin-plan 을 거쳐 사용자 범위로 — 키트 마켓 경로는 PC 마다 달라 프로젝트 설정에 넣지 않는다', () => {
  for (const [rel, s] of [['harness.md', repoFile('templates/rules/harness.md')], ['SETUP.md', repoFile('SETUP.md')]]) {
    assert.match(s, /tools\/plugin-plan\.mjs/, rel);
    assert.doesNotMatch(s, /claude plugin (install|marketplace add) [^\n`]*--scope/, rel);
  }
});

test('⑧-b 규칙 로드는 sonnet · --strict-mcp-config 로 잰다 — haiku 는 규칙이 실려도 「모름」으로 빠지고, --tools "" 는 MCP 를 막지 않는다', () => {
  const lines = repoFile('SETUP.md').split(/\r?\n/).filter((l) => l.startsWith('claude -p') && l.includes('--tools ""'));
  assert.equal(lines.length, 3);
  for (const l of lines) assert.match(l, /--model sonnet .*--strict-mcp-config/);
  for (const f of ['proof/run.mjs', 'proof/setup-e2e.mjs']) assert.match(repoFile(f), /claude -p --model sonnet --tools "" --strict-mcp-config/, f);
});

test('final-gate 는 바꾼 코드가 verify 의 테스트로 돌지 않을 때만 /code-review 를 더한다 — 정확성 증거가 없는 자리', () => {
  const s = repoFile('templates/skills/final-gate/SKILL.md');
  assert.match(s, /`\/code-review`\*\* — ⭐ \*\*바꾼 코드가 verify 의 테스트로 실행되지 않을 때만/);
  assert.match(s, /테스트가 그 코드를 돌리면 부르지 않는다/);
});

test('⛔ 이전은 정책 반영보다 먼저 — 거꾸로면 옛 선언은 걷히고 새 플러그인은 없다 · 플러그인은 PC 에서 켜고 ponytail 은 리뷰 스킬만', () => {
  const setup = repoFile('SETUP.md');
  assert.ok(setup.indexOf('tools/plugin-plan.mjs') < setup.indexOf('node .harness/tools/policy-apply.mjs'));
  for (const [rel, s] of [['SETUP.md', setup], ['harness.md', repoFile('templates/rules/harness.md')]]) {
    assert.match(s, /사용자 스킬 `ponytail-review`/, rel);
    assert.match(s, /선언하지 않는다/, rel);
  }
});

test('⛔ 이 레포의 템플릿이 커밋에서 빠지지 않는다 — 전역 gitignore 가 AGENTS.md · CLAUDE.md 를 무시하는 PC 가 있다', () => {
  const kit = fileURLToPath(new URL('..', import.meta.url));
  const r = spawnSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', 'templates'], { cwd: kit, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '');
});

test('final-gate 에 범위 검토가 있다 — 요청 밖 변경은 verify 도 과설계 리뷰도 못 본다 (docs/proof.md 범위 검토)', () => {
  const s = repoFile('templates/skills/final-gate/SKILL.md');
  assert.match(s, /범위 검토/);
  assert.match(s, /사용자 말 원문/);
  assert.match(s, /요청 밖 변경/);
});

test('⛔ final-gate 의 기록 단계에 「기록의 두 장치」가 있다 — 「기록해라」만 있으면 조용히 건너뛴다 (design §3)', () => {
  const s = repoFile('templates/skills/final-gate/SKILL.md');
  assert.match(s, /남길 게 없으면 그 판단을 한 줄로/);
  assert.match(s, /낡았으면 그 자리에서 고친다.*새 기록 추가로 갈음하지 않는다.*다음 세션의 나는 그 불일치를 사실로 믿는다/);
});

test('⛔ 설치되는 템플릿 · 정책 · SETUP 이 키트에서 지운 도구를 가리키지 않는다 — 설치본 규칙이 없는 도구를 시킨다', () => {
  const gone = JSON.parse(repoFile('policy/removed.json')).files.map((f) => f.split('/').pop().replace(/\.mjs$/, ''));
  for (const rel of ['templates/rules/harness.md', 'templates/rules/graph.md', 'templates/skills/final-gate/SKILL.md', 'templates/state/decisions.md',
    'templates/state/lessons.md', 'templates/harness.json', 'policy/settings.json', 'SETUP.md']) {
    for (const g of gone) assert.ok(!repoFile(rel).includes(g), `${rel} → ${g}`);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.mjs';
import { target, repoFile } from './scene.mjs';
import { DOCS, AGENTS } from '../lib/parts.mjs';

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

test('규칙 파일이 완료 명령과 final-gate 를 지시한다', () => {
  const rules = repoFile('templates/rules/harness.md');
  assert.match(rules, /node \.harness\/tools\/verify\.mjs/);
  assert.match(rules, /보고하기 직전에 매번 `final-gate`/);
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

test('SETUP ④ 표 — import 없는 `CLAUDE.md` 단독도 「그대로」 행이다 · ⑦ lesson 필드는 final-gate 의 예시를 가리킨다(10차 · 22차에 규칙에서 옮김)', () => {
  const setup = repoFile('SETUP.md');
  assert.match(setup, /^\| `CLAUDE\.md` 만 \(import 유무와 무관\)/m);
  assert.match(setup, /lesson-append\.mjs`[^\n]*\.claude\/skills\/final-gate\/SKILL\.md/);
  // 도구가 읽는 필드 이름이 예시에 그대로 있다
  const gate = repoFile('templates/skills/final-gate/SKILL.md');
  for (const k of ['symptom', 'cause', 'category', 'guard']) assert.match(gate, new RegExp(`lesson-append[^\\n]*"${k}"`));
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

test('final-gate 는 바꾼 코드가 verify 의 테스트로 돌지 않을 때만 /code-review 를 더한다 — 정확성 증거가 없는 자리', () => {
  const s = repoFile('templates/skills/final-gate/SKILL.md');
  assert.match(s, /`\/code-review`\*\* — ⭐ \*\*바꾼 코드가 verify 의 테스트로 실행되지 않을 때만/);
  assert.match(s, /테스트가 그 코드를 돌리면 부르지 않는다/);
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

// 서브에이전트 정의 — frontmatter 한 줄씩. 키 · 도구 · 모델이 어긋나면 구현 · 검증 분리가 조용히 풀린다
const agentDef = (name) => {
  const s = repoFile(`templates/agents/${name}.md`).replace(/\r\n/g, '\n');
  const m = s.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${name} frontmatter`);
  return Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
};

test('⭐ kit-implementer — sonnet · effort medium · 하위 에이전트를 못 만든다(Agent · Task 없음)', () => {
  const d = agentDef('kit-implementer');
  assert.deepEqual([d.name, d.model, d.effort, d.tools], ['kit-implementer', 'sonnet', 'medium', 'Read, Grep, Glob, Edit, Write, Bash']);
});

test('⭐ kit-verifier — opus · effort high · 파일을 못 고친다(Edit · Write 없음)', () => {
  const d = agentDef('kit-verifier');
  assert.deepEqual([d.name, d.model, d.effort, d.tools], ['kit-verifier', 'opus', 'high', 'Read, Grep, Glob, Bash']);
});

test('두 정의의 description 은 한 줄 · 합 300자 안 — 세션마다 도구 설명에 실린다', () => {
  const [a, b] = ['kit-implementer', 'kit-verifier'].map((n) => agentDef(n).description);
  assert.ok(a && b && !a.includes('\n'));
  assert.ok(a.length + b.length <= 300, `${a.length + b.length}자`);
});

test('verifier 본문 — 구현자의 설명을 요구하지 않고 실행으로 증명된 발견만 보고한다 · implementer 본문 — 지시서 밖 변경 금지', () => {
  const v = repoFile('templates/agents/kit-verifier.md');
  assert.match(v, /반증/);
  assert.match(v, /반증 못 함/);
  assert.match(v, /재현 명령/);
  assert.match(v, /셸/);
  assert.match(repoFile('templates/agents/kit-implementer.md'), /지시서 밖/);
});

test('⭐ harness.md 에 구현 · 검증 위임 한 줄이 있다 — 구현은 kit-implementer 하나 · 끝 검증은 kit-verifier 하나 · 병렬 디스패치 안 씀', () => {
  const line = repoFile('templates/rules/harness.md').split(/\r?\n/).find((l) => l.includes('kit-implementer')) ?? '';
  assert.match(line, /kit-verifier/);
  assert.match(line, /열 번/);
  assert.match(line, /병렬 디스패치는 쓰지 않는다/);
});

// 깔리는 규칙 · 스킬 · 에이전트 정의 — 설치마다 같은 판으로 실린다
const INSTALLED = [...DOCS.map(([src]) => src), ...AGENTS.map(([src]) => src)];

test('⛔ 깔리는 문서는 설치마다 다른 경로(기록 저장소 · 장부)를 박지 않는다 — graph.store · state 를 바꾼 설치에서 거짓 안내가 된다', () => {
  for (const rel of INSTALLED) {
    for (const p of ['.harness/graph/requests.jsonl', '.harness/state/decisions.md', '.harness/state/lessons.md']) assert.ok(!repoFile(rel).includes(p), `${rel} — ${p}`);
  }
});

test('⛔ 깔리는 문서가 가리키는 「아래 …」 · 「N째 문」이 그 파일에 있다 — 덜어낸 절을 가리키는 문장이 남지 않게', () => {
  for (const rel of INSTALLED) {
    const s = repoFile(rel);
    for (const m of s.matchAll(/아래 「([^」]+)」/g)) assert.ok(s.indexOf(m[1], m.index + m[0].length) > 0, `${rel} — ${m[0]}`);
    for (const m of s.matchAll(/([둘셋넷])째 문/g)) assert.ok(s.includes(`**${m[1]}째 문`), `${rel} — ${m[0]} 정의 없음`);
  }
});

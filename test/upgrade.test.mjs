import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { target, repoFile, put, gitRepo, kitRepo, tmp } from './scene.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
const TOOL = join(KIT, 'tools', 'upgrade.mjs');
const RULE = 'templates/rules/harness.md';
const STATE = { decisions: '.harness/state/decisions.md', lessons: '.harness/state/lessons.md' };
const fill = (s) => s.replaceAll('<decisions>', STATE.decisions).replaceAll('<lessons>', STATE.lessons)
  .replaceAll('<graph-tools>', '.harness/tools').replaceAll('<graph-rules>', '`.claude/rules/graph.md`');
// 키트 이력의 첫 버전 — 실제 설치 3곳의 규칙이 이것에 장부 경로를 채운 것과 같았다
const first = execFileSync('git', ['-C', KIT, 'rev-list', '--reverse', 'HEAD', '--', RULE], { encoding: 'utf8' }).split('\n')[0];
// 지운 대장 템플릿 — 지운 커밋의 부모에서 읽는다(HEAD 에는 없다)
const deleted = execFileSync('git', ['-C', KIT, 'rev-list', '-n', '1', 'HEAD', '--', 'templates/state/current.md'], { encoding: 'utf8' }).trim();
const CURRENT = execFileSync('git', ['-C', KIT, 'show', `${deleted}^:templates/state/current.md`], { encoding: 'utf8' });
const oldRule = fill(execFileSync('git', ['-C', KIT, 'show', `${first}:${RULE}`], { encoding: 'utf8' }));

function installed(rule = oldRule, settings = { enabledPlugins: { 'ponytail@ponytail': true, 'superpowers@claude-plugins-official': false } }) {
  return target({ profile: 'existing', mode: 'local', state: STATE, checks: [{ id: 't', cmd: 'npm test', kind: 'junit-xml', evidence: 'r', why: '시험용' }] }, {
    '.claude/rules/harness.md': rule,
    '.claude/skills/final-gate/SKILL.md': fill(repoFile('templates/skills/final-gate/SKILL.md')),
    '.claude/settings.local.json': JSON.stringify(settings),
    '.harness/lib/evidence.mjs': '// 옛 판정',
  });
}
const run = (dir) => spawnSync(process.execPath, [TOOL, dir], { encoding: 'utf8' });
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8').replace(/\r\n/g, '\n');

test('⭐ 옛 설치 — 도구는 지금 것으로, 손대지 않은 규칙은 장부 경로를 채운 채 갱신한다', () => {
  const dir = installed();
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(dir, '.harness/lib/evidence.mjs'), repoFile('lib/evidence.mjs').replace(/\r\n/g, '\n'));
  assert.ok(existsSync(join(dir, '.harness/tools/gate-hook.mjs')));
  assert.equal(read(dir, '.claude/rules/harness.md'), fill(repoFile(RULE)).replace(/\r\n/g, '\n'));
  assert.match(r.stdout, /harness\.md — 갱신/);
  assert.match(r.stdout, /graph\.md — 없다/);
  assert.ok(!existsSync(join(dir, '.claude/rules/graph.md')));
});

test('⛔ 프로젝트가 고친 규칙은 덮어쓰지 않고 ⛔(exit 1) — 다른 줄 요약과 고친 줄을 옮기는 명령을 낸다(12차)', () => {
  const mine = `${oldRule}\n- 이 프로젝트가 승격한 규칙\n`;
  const dir = installed(mine);
  const r = run(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(read(dir, '.claude/rules/harness.md'), mine.replace(/\r\n/g, '\n'));
  assert.match(r.stdout, /⛔ \.claude\/rules\/harness\.md — 프로젝트가 고쳤다 \+1 −0/);
  assert.match(r.stdout, /이 프로젝트가 승격한 규칙/);
  assert.match(r.stdout, /tools\/upgrade\.mjs .* --own-rules/);
  assert.doesNotMatch(r.stdout, /병합/);
});

// 키트 첫 판에 프로젝트가 한 줄을 고치고(뺌 + 더함) 절 하나를 더한 설치본
const section = (s) => s.split('\n').findIndex((l) => l.startsWith('## '));
function edited() {
  const lines = oldRule.split('\n');
  const at = section(oldRule) + 1;
  const gone = lines.slice(at).find((l) => l.startsWith('- '));
  const mine = lines.map((l) => (l === gone ? '- 이 프로젝트는 계획 문서를 늘 쓴다' : l)).join('\n').concat('\n## 이 프로젝트의 배포\n\n- 배포 전 정확성 리뷰를 한 번 더 한다\n');
  return { mine, gone, heading: lines[at - 1] };
}

test('⭐ --own-rules — 고친 줄을 .claude/rules/project-harness.md 로 옮기고 키트 판을 다시 깐다 · 다시 돌려도 같다', () => {
  const { mine, gone, heading } = edited();
  const dir = installed(mine);
  const r = spawnSync(process.execPath, [TOOL, dir, '--own-rules'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(read(dir, '.claude/rules/harness.md'), fill(repoFile(RULE)).replace(/\r\n/g, '\n'));
  const own = read(dir, '.claude/rules/project-harness.md');
  // 바꾼 줄은 그 절 제목 아래로 · 더한 절은 그대로 · 뺀 키트 줄은 「따르지 않는다」로
  assert.ok(own.indexOf(heading) < own.indexOf('- 이 프로젝트는 계획 문서를 늘 쓴다'), own);
  assert.match(own, /## 이 프로젝트의 배포\n- 배포 전 정확성 리뷰를 한 번 더 한다/);
  assert.ok(own.includes(`> ${gone}`), own);
  assert.match(own, /이 파일이 이긴다/);
  assert.match(r.stdout, /project-harness\.md/);
  const again = spawnSync(process.execPath, [TOOL, dir, '--own-rules'], { encoding: 'utf8' });
  assert.equal(again.status, 0);
  assert.equal(read(dir, '.claude/rules/project-harness.md'), own);
});

test('⛔ --own-rules 가 만든 파일도 로컬 전용이면 git 에서 숨긴다 — 로컬 설치는 아무것도 git 에 보이지 않는다', () => {
  const { dir, env, git } = gitRepo({});
  for (const [rel, body] of Object.entries({ '.harness/harness.json': JSON.stringify({ profile: 'existing', mode: 'local', state: STATE, checks: [] }),
    '.claude/rules/harness.md': edited().mine, '.claude/skills/final-gate/SKILL.md': fill(repoFile('templates/skills/final-gate/SKILL.md')) })) put(dir, rel, body);
  put(dir, '.git/info/exclude', '/.harness/\n/.claude/rules/harness.md\n/.claude/skills/final-gate/\n');
  const r = spawnSync(process.execPath, [TOOL, dir, '--own-rules'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(dir, '.claude/rules/project-harness.md')));
  assert.equal(git('status', '--porcelain'), '');
});

test('⭐ 갱신이 키트 커밋을 설치본에 기록한다(이식 검사 ⑨ 가 비교) — ⛔ 키트에 커밋 안 된 변경이 있으면 아무것도 얹지 않고 exit 1 · 우회 환경변수면 <sha>-dirty · git 저장소가 아닌 키트는 그대로 진행', () => {
  const kit = kitRepo();
  const up = (dir, from = kit.dir, env = kit.env) => spawnSync(process.execPath, [join(from, 'tools', 'upgrade.mjs'), dir], { encoding: 'utf8', env });
  const current = () => installed(fill(repoFile(RULE)));

  const clean = current();
  const ok = up(clean);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(read(clean, '.harness/kit-commit'), `${kit.sha}\n`);

  put(kit.dir, 'tools/verify.mjs', `${readFileSync(join(kit.dir, 'tools/verify.mjs'), 'utf8')}// 작업 중\n`);
  put(kit.dir, 'templates/draft.md', '초안\n');
  const dir = current();
  const r = up(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^⛔ 키트에 커밋 안 된 변경 — 커밋한 뒤 갱신한다/m);
  assert.match(r.stdout, /tools\/verify\.mjs/);
  assert.match(r.stdout, /templates\/draft\.md/);
  assert.equal(read(dir, '.harness/lib/evidence.mjs'), '// 옛 판정');
  assert.ok(!existsSync(join(dir, '.harness/kit-commit')));

  const dev = up(dir, kit.dir, { ...kit.env, HARNESS_KIT_DIRTY_OK: '1' });
  assert.equal(dev.status, 0, dev.stdout + dev.stderr);
  assert.equal(read(dir, '.harness/kit-commit'), `${kit.sha}-dirty\n`);

  // 압축으로 받은 키트 — 이력이 없어 커밋도 변경도 모른다
  const zip = join(tmp('zip-'), 'kit');
  for (const d of ['lib', 'tools', 'policy', 'templates']) cpSync(join(kit.dir, d), join(zip, d), { recursive: true });
  const plain = current();
  const z = up(plain, zip, { ...kit.env, GIT_CEILING_DIRECTORIES: dirname(zip) });
  assert.equal(z.status, 0, z.stdout + z.stderr);
  assert.ok(!existsSync(join(plain, '.harness/kit-commit')));
});

test('⭐ 설정은 쓰지 않는다 — 옛 플러그인 정리 · 정책 반영 명령을 낸다', () => {
  const dir = installed();
  const before = read(dir, '.claude/settings.local.json');
  const r = run(dir);
  assert.equal(read(dir, '.claude/settings.local.json'), before);
  // 옛 id 선언(ponytail@ponytail: true)은 policy-apply 가 걷는다 — --off 를 내지 않는다
  assert.match(r.stdout, /node \.harness\/tools\/policy-apply\.mjs --local --with gate-hook$/m);
});

test('⛔ 관문 훅만 건 설치(--only gate-hook)에는 정책 전체를 안내하지 않는다 — 받지 않은 권한 · ponytail 끄기 · 플러그인이 들어간다', () => {
  const dir = installed(oldRule, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.harness/tools/gate-hook.mjs"' }] }] } });
  const r = run(dir);
  assert.match(r.stdout, /node \.harness\/tools\/policy-apply\.mjs --local --only gate-hook$/m);
  assert.doesNotMatch(r.stdout, /--with gate-hook/);
  // 그 대상이 ponytail 을 스스로 켜 두어도(지시 파일의 모드) 정책 전체 설치로 읽지 않는다
  const own = run(installed(oldRule, { enabledPlugins: { 'ponytail@harness-kit': true }, env: { PONYTAIL_DEFAULT_MODE: 'lite' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/.harness/tools/gate-hook.mjs'] }] }] } }));
  assert.match(own.stdout, /policy-apply\.mjs --local --only gate-hook$/m);
});

test('⭐ 그래프 훅을 건 설치에는 --with graph-hook 도 낸다 — 옛 셸 형식 · 옛 자기 그래프 훅(tools/graph-hook.mjs)을 키트 훅으로 바꿔 끼운다', () => {
  const hook = (cmd) => ({ UserPromptSubmit: [{ hooks: [{ type: 'command', command: cmd }] }] });
  for (const cmd of ['node "$CLAUDE_PROJECT_DIR/.harness/tools/graph-hook.mjs"', 'node "$CLAUDE_PROJECT_DIR/tools/graph-hook.mjs"']) {
    const r = run(installed(oldRule, { enabledPlugins: { 'ponytail@harness-kit': true }, hooks: hook(cmd) }));
    assert.match(r.stdout, /policy-apply\.mjs --local --with gate-hook --with graph-hook$/m, cmd);
  }
});

// 옛 자기 그래프 설치 — 그래프 도구 · 기록이 tools/ 아래, 규칙 · 지시 파일 · 검사 명령이 그 도구를 가리킨다
const OWN = { tools: 'tools', rules: '`AGENTS.md` 의 그래프 기록 절' };
const fillWith = (graph) => (s) => s.replaceAll('<decisions>', STATE.decisions).replaceAll('<lessons>', STATE.lessons).replaceAll('<graph-tools>', graph.tools).replaceAll('<graph-rules>', graph.rules);
const rec = (req, files, extra = {}) => JSON.stringify({ date: '2026-10-01', recorded: '2026-10-01', req, files, ...extra });
function ownGraph() {
  const fill = fillWith(OWN);
  return target({ profile: 'existing', mode: 'local', graph: OWN, state: STATE, checks: [{ id: 'graph-check', cmd: 'node tools/graph-find.mjs --check', kind: 'exit-code', recipe: 'graph-check' }] }, {
    '.claude/rules/harness.md': fill(repoFile(RULE)),
    '.claude/skills/final-gate/SKILL.md': fill(repoFile('templates/skills/final-gate/SKILL.md')),
    'AGENTS.md': '# 지도\n\n- 요구가 오면 `node tools/graph-find.mjs <어근>`\n',
    'tools/graph-find.mjs': '// 옛 그래프 도구',
    'tools/graph-hook.mjs': '// 옛 그래프 훅',
    'tools/trace.mjs': '// 프로젝트 고유 도구',
    'src/a.mjs': 'export {};\n',
    'tools/graph/requests.jsonl': [
      rec('그래프 도구 손봄', ['tools/graph-find.mjs', 'src/a.mjs'], { note: 'tools/graph-find.mjs 의 문턱을 고쳤다' }),
      rec('옛 훅 조사', ['tools/graph-hook.mjs']),
      rec('훅 조사', ['tools/graph-hook.mjs'], { supersedes: '옛 훅 조사' }),
      rec('추적 도구', ['tools/trace.mjs']),
    ].join('\n') + '\n',
  });
}
const graphLines = (dir) => readFileSync(join(dir, 'tools/graph/requests.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('⛔ 옛 자기 그래프(graph.tools ≠ .harness/tools) — 키트 그래프 도구는 그래도 깔고, 이관 안내를 내며 exit 1 · 규칙 · 기록 · 옛 도구는 그대로', () => {
  const dir = ownGraph();
  const before = readFileSync(join(dir, 'tools/graph/requests.jsonl'), 'utf8');
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout);
  assert.equal(read(dir, '.harness/tools/graph-find.mjs'), repoFile('tools/graph-find.mjs').replace(/\r\n/g, '\n'));
  assert.ok(existsSync(join(dir, '.harness/policy/graph-hook.json')));
  assert.match(r.stdout, /⛔ 그래프 이관/);
  assert.match(r.stdout, /upgrade\.mjs .* --migrate-graph/);
  assert.match(r.stdout, /graph\.store.*tools\/graph\/requests\.jsonl/);
  assert.match(r.stdout, /AGENTS\.md:3/);
  assert.match(r.stdout, /\.harness\/harness\.json:1/);
  assert.match(r.stdout, /키트가 지우지 않는다/);
  assert.match(read(dir, '.claude/rules/harness.md'), /node tools\/graph-find\.mjs --check/);
  assert.equal(readFileSync(join(dir, 'tools/graph/requests.jsonl'), 'utf8'), before);
  assert.ok(existsSync(join(dir, 'tools/graph-find.mjs')));
});

test('⭐ --migrate-graph — graph.store 를 기존 기록 경로로 · graph.tools 를 걷고 · 살아있는 기록 files 의 옛 도구 경로만 한 번 바꾼다(note · 대체된 기록 · 프로젝트 도구는 그대로) · 규칙이 키트 도구를 가리킨다', () => {
  const dir = ownGraph();
  const r = spawnSync(process.execPath, [TOOL, dir, '--migrate-graph'], { encoding: 'utf8' });
  assert.equal(JSON.parse(read(dir, '.harness/harness.json')).graph.tools, undefined);
  assert.deepEqual(JSON.parse(read(dir, '.harness/harness.json')).graph, { rules: OWN.rules, store: 'tools/graph/requests.jsonl' });
  const [a, old, now, trace] = graphLines(dir);
  assert.deepEqual(a.files, ['.harness/tools/graph-find.mjs', 'src/a.mjs']);
  assert.equal(a.note, 'tools/graph-find.mjs 의 문턱을 고쳤다');
  assert.deepEqual(old.files, ['tools/graph-hook.mjs']);
  assert.deepEqual(now.files, ['.harness/tools/graph-hook.mjs']);
  assert.deepEqual(trace.files, ['tools/trace.mjs']);
  assert.match(r.stdout, /기록 2건의 files/);
  assert.match(read(dir, '.claude/rules/harness.md'), /node \.harness\/tools\/graph-find\.mjs --check/);
  assert.match(read(dir, '.claude/skills/final-gate/SKILL.md'), /node \.harness\/tools\/graph-find\.mjs --check/);
  // 참조는 프로젝트가 고친다 — 남아 있는 동안 exit 1
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /AGENTS\.md:3/);
  assert.ok(existsSync(join(dir, 'tools/graph-find.mjs')));
  put(dir, 'AGENTS.md', '# 지도\n\n- 요구가 오면 `node .harness/tools/graph-find.mjs <어근>`\n');
  put(dir, '.harness/harness.json', read(dir, '.harness/harness.json').replace('node tools/graph-find.mjs', 'node .harness/tools/graph-find.mjs'));
  const done = run(dir);
  assert.equal(done.status, 0, done.stdout);
  const chk = spawnSync(process.execPath, [join(dir, '.harness/tools/graph-find.mjs'), '--check'], { cwd: dir, encoding: 'utf8' });
  assert.equal(chk.status, 0, chk.stdout);
});

test('⛔ 새 예외를 막는다 — 프로필 전부(신규 · 기존 · 기록 위치를 따로 둔 · 옛 자기 그래프)에서 갱신 뒤 키트가 배포하는 lib · tools · policy 가 하나도 빠짐없이 바이트 같다', () => {
  const kitFiles = ['lib', 'tools', 'policy'].flatMap((d) => readdirSync(join(KIT, d), { recursive: true }).map((f) => join(d, f))).filter((f) => statSync(join(KIT, f)).isFile());
  const base = { mode: 'local', state: STATE, checks: [{ id: 't', cmd: 'npm test', kind: 'exit-code' }] };
  for (const [name, harness] of [['신규', { ...base, profile: 'new' }], ['기존', { ...base, profile: 'existing' }],
    ['기록 위치', { ...base, profile: 'existing', graph: { store: 'data/graph.jsonl' } }], ['옛 자기 그래프', { ...base, profile: 'existing', graph: OWN }]]) {
    const dir = target(harness);
    run(dir);
    const off = kitFiles.filter((f) => !existsSync(join(dir, '.harness', f)) || !readFileSync(join(dir, '.harness', f)).equals(readFileSync(join(KIT, f))));
    assert.deepEqual(off, [], name);
  }
});

test('⭐ graph.store 를 둔 설치 — 지운 경로를 가리키는 기록 검사도 그 기록 위치를 본다', () => {
  const dir = target({ profile: 'existing', mode: 'local', graph: { store: 'data/graph.jsonl' }, state: STATE, checks: [{ id: 't', cmd: 'npm test', kind: 'exit-code' }] }, {
    'data/graph.jsonl': `${rec('대장 점검 도구 사용법', ['.harness/tools/state-check.mjs'])}\n`,
  });
  assert.match(run(dir).stdout, /state-check\.mjs ← 대장 점검 도구 사용법/);
});

test('⛔ 대상에 복사된 사본으로 돌리면 거부한다 — 사본은 자기 위치를 키트로 알아 엉뚱한 경로를 쓴다', () => {
  const dir = installed();
  run(dir);
  for (const tool of ['upgrade.mjs', 'plugin-plan.mjs', 'install-check.mjs']) {
    const r = spawnSync(process.execPath, [join(dir, '.harness', 'tools', tool), dir], { encoding: 'utf8' });
    assert.equal(r.status, 1, tool);
    assert.match(r.stderr, /키트 저장소의/, tool);
  }
});

test('⛔ 설치되지 않은 대상은 거부한다', () => {
  const r = run(target(null));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SETUP/);
});

test('⭐ 키트에서 지운 도구 · lib 는 설치본에서도 걷는다 — 복사는 덮어쓰기만 한다 · 프로젝트가 더한 도구는 둔다', () => {
  const dir = installed();
  for (const f of ['.harness/tools/state-check.mjs', '.harness/tools/lesson-promote.mjs', '.harness/lib/mdtable.mjs', '.harness/tools/our-tool.mjs']) put(dir, f, '// 옛 것');
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['.harness/tools/state-check.mjs', '.harness/tools/lesson-promote.mjs', '.harness/lib/mdtable.mjs']) assert.ok(!existsSync(join(dir, f)), f);
  assert.ok(existsSync(join(dir, '.harness/tools/our-tool.mjs')));
  assert.match(r.stdout, /걷음.*state-check\.mjs/);
});

test('⭐ 지운 템플릿은 손대지 않은 설치본만 걷는다 — 쓴 대장은 남기고 알린다', () => {
  const untouched = target({ profile: 'existing', mode: 'local', state: { ...STATE, current: '.harness/state/current.md' }, checks: [] }, {
    '.harness/state/current.md': CURRENT,
  });
  assert.match(run(untouched).stdout, /걷음.*current\.md/);
  assert.ok(!existsSync(join(untouched, '.harness/state/current.md')));
  const used = target({ profile: 'existing', mode: 'local', state: { ...STATE, current: '.harness/state/current.md' }, checks: [] }, {
    '.harness/state/current.md': `${CURRENT}| \`src/a.mjs\` | 분석완료 | \`abc\` | |\n`,
  });
  assert.match(run(used).stdout, /⚠️ \.harness\/state\/current\.md — .*남겼다/);
  assert.ok(existsSync(join(used, '.harness/state/current.md')));
});

test('⭐ 키트 템플릿에서 지운 장부 줄은 설치본 장부에서도 걷는다 — 같은 줄만(줄바꿈 · 앞뒤 공백 무시) · 사용자 줄은 그대로 · 다시 돌려도 같다', () => {
  const [gone] = JSON.parse(repoFile('policy/removed.json')).lines['templates/state/lessons.md'];
  const old = execFileSync('git', ['-C', KIT, 'show', `${deleted}^:templates/state/lessons.md`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
  const mine = '- 예전엔 `node .harness/tools/lesson-promote.mjs` 로 승격 후보를 봤다';
  const ledger = `${old.replace(gone, `${gone}  `)}| L1 | 검증 부족 | 증상 | 원인 | 테스트 |\n${mine}\n`.replace(/\n/g, '\r\n');
  const dir = installed();
  put(dir, STATE.lessons, ledger);
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /🧹 걷음\(키트에서 지운 장부 줄\): \.harness\/state\/lessons\.md:10/);
  const after = readFileSync(join(dir, STATE.lessons), 'utf8');
  assert.equal(after, ledger.replace(`${gone}  \r\n`, ''));
  assert.doesNotMatch(run(dir).stdout, /장부 줄/);
  assert.equal(readFileSync(join(dir, STATE.lessons), 'utf8'), after);
});

test('⛔ 빌드 · 테스트 단서가 보이는데 covers 를 가진 검사가 없으면 갱신 보고를 ⛔ 로 멈춘다(exit 1)', () => {
  const pkg = { 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) };
  const bare = target({ profile: 'existing', mode: 'local', state: STATE, checks: [{ id: 't', cmd: 'npm test', kind: 'exit-code' }] }, pkg);
  const r = run(bare);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /⛔ .*package\.json test.*covers/);
  const covered = target({ profile: 'existing', mode: 'local', state: STATE, checks: [{ id: 't', cmd: 'npm test', kind: 'exit-code', covers: ['src/**'], recipe: 'node-npm-test' }] }, pkg);
  assert.equal(run(covered).status, 0);
});

test('⭐ 지우는 경로를 살아있는 그래프 기록이 가리키면 목록을 낸다 — 그대로 두면 --check 빨강 → verify 빨강', () => {
  const rec = (req, files, extra = {}) => JSON.stringify({ date: '2026-10-01', recorded: '2026-10-01', req, files, ...extra });
  const dir = installed();
  put(dir, '.harness/graph/requests.jsonl', [rec('대장 점검 도구 사용법', ['.harness/tools/state-check.mjs']), rec('옛 기록', ['.harness/tools/lesson-promote.mjs']),
    rec('새 기록', [], { supersedes: '옛 기록' })].join('\n'));
  const r = run(dir);
  assert.match(r.stdout, /그래프 기록이 지운 경로를 가리킨다/);
  assert.match(r.stdout, /state-check\.mjs ← 대장 점검 도구 사용법/);
  assert.doesNotMatch(r.stdout, /← 옛 기록/);
});

test('⛔ 「지운 것」 목록이 키트와 맞는다 — 지운 도구 · 템플릿이 키트에 남거나 allow 가 정책에 남으면 갱신이 다시 넣는다', () => {
  const removed = JSON.parse(repoFile('policy/removed.json'));
  for (const f of removed.files) assert.ok(!existsSync(join(KIT, f.replace(/^\.harness\//, ''))), f);
  for (const src of Object.keys(removed.templates)) assert.ok(!existsSync(join(KIT, src)), src);
  for (const [src, lines] of Object.entries(removed.lines)) {
    const now = repoFile(src).split(/\r?\n/).map((l) => l.trim());
    for (const l of lines) assert.ok(!now.includes(l.trim()), `${src}: ${l}`);
  }
  const allow = JSON.parse(repoFile('policy/settings.json')).permissions.allow;
  for (const a of removed.allow) assert.ok(!allow.includes(a), a);
});

test('⛔ 검사에 처방 id 도 why 도 없거나 목록에 없는 처방이면 — 도구 · 규칙은 얹고 끝에 ⛔ exit 1 · 적을 줄 · detect 처방 후보 · harness.json 은 키트가 쓰지 않는다', () => {
  const pkg = { 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) };
  const conf = (checks) => ({ profile: 'existing', mode: 'local', state: STATE, checks });
  const dir = target(conf([{ id: 't', cmd: 'npm test', kind: 'exit-code', covers: ['src/**'] }, { id: 'u', cmd: 'npm test', kind: 'exit-code', recipe: 'no-such' }]), pkg);
  const before = read(dir, '.harness/harness.json');
  const r = run(dir);
  assert.equal(r.status, 1, r.stdout);
  assert.ok(existsSync(join(dir, '.harness/tools/verify.mjs')));
  assert.match(r.stdout, /^⛔ 처방 · why 없는 검사 t — 그 검사에 "recipe": "<처방 id>" 또는 "why": "<처방에서 벗어난 이유>" 를 적는다$/m);
  assert.match(r.stdout, /^⛔ 목록에 없는 처방 u\(no-such\)/m);
  assert.match(r.stdout, /처방 후보: node-npm-test — .*\(검증됨\)/);
  assert.equal(read(dir, '.harness/harness.json'), before);
  assert.equal(run(target(conf([{ id: 't', cmd: 'npm test', kind: 'exit-code', covers: ['src/**'], why: '이 프로젝트의 테스트 묶음' }]), pkg)).status, 0);
});

test('⭐ 「테스트 없음」 선언(검사의 "tests": "none" + why)이면 covers 단서 ⛔ 를 내지 않는다 · 선언 뒤 테스트 소스가 생기면 ⚠️', () => {
  const pom = { 'pom.xml': '<project/>' };
  const conf = (extra) => ({ profile: 'existing', mode: 'local', state: STATE, checks: [{ id: 'compile', cmd: 'javac', kind: 'exit-code', recipe: 'java-javac-compile', ...extra }] });
  const bare = run(target(conf({}), pom));
  assert.equal(bare.status, 1);
  assert.match(bare.stdout, /⛔ 빌드 · 테스트 단서\(pom\.xml\).*"tests": "none"/);
  const dir = target(conf({ tests: 'none', why: '테스트 소스 없음 — 첫 테스트 때 junit 검사와 covers 를 더한다' }), pom);
  const r = run(dir);
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /covers 를 가진 검사가 없다|테스트가 생겼다/);
  put(dir, 'src/test/java/AppTest.java', 'class AppTest {}\n');
  const grown = run(dir);
  assert.equal(grown.status, 0, grown.stdout);
  assert.match(grown.stdout, /^⚠️ 테스트가 생겼다 — junit 검사와 covers 를 더할 때 \(src\/test\)$/m);
  assert.equal(run(target(conf({ tests: 'none' }), pom)).status, 1);
});

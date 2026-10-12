import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { suggest } from '../tools/detect.mjs';
import { gitRepo, put, target } from './scene.mjs';

const DETECT = fileURLToPath(new URL('../tools/detect.mjs', import.meta.url));
const GLOBAL = '.claude/\nAGENTS.md\nCLAUDE.md\n';
const detect = ({ dir, env }) => {
  const r = spawnSync(process.execPath, [DETECT, dir, '--json'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const many = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`src/m${i}.ts`, `export const v${i} = ${i};\n`]));

test('⭐ 제안 — 커밋 20 미만이고 소스 50 미만이면 신규, 아니면 기존. 모드는 둘 다 로컬 전용 — 공유는 사용자가 고른다', () => {
  assert.deepEqual(suggest({ git: true, commits: 19, sources: 49 }).profile, 'new');
  assert.equal(suggest({ git: true, commits: 19, sources: 49 }).mode, 'local');
  assert.equal(suggest({ git: true, commits: 20, sources: 0 }).profile, 'existing');
  assert.equal(suggest({ git: true, commits: 1, sources: 50 }).mode, 'local');
  assert.match(suggest({ git: true, commits: 20, sources: 3 }).why, /커밋 20/);
});

test('⭐ 신규 — 커밋 1 · README 만 · 지시 파일 없음', () => {
  const f = detect(gitRepo({ 'README.md': '# 새 앱\n', 'package.json': '{"scripts":{"test":"node --test"}}' }));
  assert.equal(f.commits, 1);
  assert.equal(f.sources, 0);
  assert.equal(f.suggest.profile, 'new');
  assert.equal(f.suggest.mode, 'local');
  assert.deepEqual(f.suggest.stop, []);
  assert.equal(f.instructions['AGENTS.md'].exists, false);
  assert.deepEqual(f.tests, ['package.json test: node --test']);
});

test('⭐ 기존 — 소스 60 · AGENTS.md 추적 · CLAUDE.md 가 import 함 · 다른 도구 규칙', () => {
  const f = detect(gitRepo({
    ...many(60), 'AGENTS.md': '# 지도\n', 'CLAUDE.md': '@AGENTS.md\n', '.github/copilot-instructions.md': 'x', 'pom.xml': '<project/>',
  }));
  assert.equal(f.sources, 60);
  assert.equal(f.suggest.profile, 'existing');
  assert.equal(f.suggest.mode, 'local');
  assert.deepEqual(f.instructions['AGENTS.md'], { exists: true, tracked: true });
  assert.deepEqual(f.instructions['CLAUDE.md'], { exists: true, tracked: true, importsAgents: true });
  assert.deepEqual(f.otherRules, ['.github/copilot-instructions.md']);
  assert.deepEqual(f.tests, ['pom.xml']);
});

test('⛔ 멈춤 — 이미 설치됨 · 기존 context-graph 감지. 미커밋 변경은 멈춤이 아니라 warn', () => {
  const repo = gitRepo({ 'a.txt': 'x', '.harness/harness.json': '{}', 'tools/graph/requests.jsonl': '{}\n' });
  const clean = detect(repo);
  assert.equal(clean.installed, true);
  assert.equal(clean.contextGraph, true);
  assert.ok(clean.suggest.stop.some((s) => /이미 설치/.test(s)));
  assert.deepEqual(clean.suggest.warn, []);
  spawnSync(process.execPath, ['-e', "require('fs').writeFileSync('a.txt','y')"], { cwd: repo.dir });
  const { stop, warn } = detect(repo).suggest;
  assert.ok(stop.some((s) => /이미 설치/.test(s)));
  assert.ok(!stop.some((s) => /미커밋/.test(s)));
  assert.deepEqual(warn, ['미커밋 변경 1건 — 로컬 전용은 설치 경로가 git 에 안 보여 섞이지 않는다 · 공유를 고르면 ⛔ 커밋하거나 치운 뒤 설치한다']);
});

test('⭐ 미커밋 변경이 설치가 고치고 숨기는 경로에 있으면 겹침을 따로 알린다 — CLAUDE.local.md · .claude/ (접힌 미추적 디렉터리 포함)', () => {
  const repo = gitRepo({ 'a.txt': 'x' });
  put(repo.dir, 'CLAUDE.local.md', '# 내 메모\n');
  put(repo.dir, '.claude/settings.local.json', '{}');
  const { stop, warn } = detect(repo).suggest;
  assert.deepEqual(stop, []);
  assert.equal(warn.length, 2);
  assert.match(warn[0], /^미커밋 변경 2건 /);
  assert.match(warn[1], /^설치가 고치고 git 에서 숨기는 경로에 미커밋 변경: .* — 내용을 먼저 확인한다$/);
  assert.ok(warn[1].includes('CLAUDE.local.md') && warn[1].includes('.claude/'), warn[1]);
});

test('겹침 줄의 한글 경로는 8진수 이스케이프가 아니라 그대로 나온다', () => {
  const repo = gitRepo({ '.claude/한글.md': '옛\n' });
  put(repo.dir, '.claude/한글.md', '새\n');
  const { warn } = detect(repo).suggest;
  assert.ok(warn[1]?.includes('.claude/한글.md'), warn.join(' | '));
});

test('한글 이름 소스 파일도 소스로 센다 — ls-files 의 8진수 따옴표가 SOURCE 의 $ 앵커를 빗나가게 하지 않는다', () => {
  const f = detect(gitRepo({ 'src/한글.java': 'class A {}\n', 'src/b.ts': 'export {};\n' }));
  assert.equal(f.tracked, 2);
  assert.equal(f.sources, 2);
});

test('겹침 판정은 경로만 본다 — 포슬린 줄의 상태 칸 · 따옴표 · 이름 바꾸기, 비슷한 이름은 겹침이 아니다', () => {
  const warn = (...dirty) => suggest({ git: true, commits: 1, sources: 0, dirty }).warn;
  assert.equal(warn(' M src/a.mjs', '?? docs/CLAUDE.local.md', '?? .claude-notes/x', '?? .claudeignore').length, 1);
  assert.equal(warn('?? CLAUDE.local.md', ' M ".claude/my rules.md"', 'R  old.md -> .claude/new.md')[1],
    '설치가 고치고 git 에서 숨기는 경로에 미커밋 변경: CLAUDE.local.md, .claude/my rules.md, .claude/new.md — 내용을 먼저 확인한다');
  assert.deepEqual(warn(), []);
});

test('⛔ 멈춤 — git 저장소가 아니다', () => {
  const f = detect({ dir: target(null, { 'a.txt': 'x' }), env: { ...process.env, GIT_CEILING_DIRECTORIES: '' } });
  assert.equal(f.git, false);
  assert.ok(f.suggest.stop.some((s) => /저장소가 아니다/.test(s)));
});

test('⭐ 설치 경로가 git 에 무시되는가 — 전역 무시 있음/없음 둘 다', () => {
  const hidden = detect(gitRepo({ 'a.txt': 'x' }, { globalIgnore: GLOBAL })).ignored;
  assert.deepEqual(hidden, { '.claude/rules/harness.md': true, '.harness/harness.json': false, 'AGENTS.md': true, 'CLAUDE.md': true });
  const plain = detect(gitRepo({ 'a.txt': 'x' })).ignored;
  assert.deepEqual(Object.values(plain), [false, false, false, false]);
});

test('사람용 출력은 사실과 제안을 한 화면에 낸다', () => {
  const { dir, env } = gitRepo({ 'README.md': '# 새 앱\n' });
  put(dir, 'notes.txt', '메모\n');
  const r = spawnSync(process.execPath, [DETECT, dir], { env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /제안 +프로필 new .* 모드 local \(공유는 사용자가 고른다\)/);
  // 미커밋 변경은 멈춤이 아니라 확인 — ⛔ 멈춤 줄과 같은 너비(라벨 뒤 공백 9칸)
  assert.match(r.stdout, /^⚠️ 확인 {9}미커밋 변경 1건 — /m);
  assert.doesNotMatch(r.stdout, /⛔ 멈춤/);
});

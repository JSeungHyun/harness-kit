import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { suggest } from '../tools/detect.mjs';
import { gitRepo, target } from './scene.mjs';

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

test('⛔ 멈춤 — 미커밋 변경 · 이미 설치됨 · 기존 context-graph 감지', () => {
  const repo = gitRepo({ 'a.txt': 'x', '.harness/harness.json': '{}', 'tools/graph/requests.jsonl': '{}\n' });
  const clean = detect(repo);
  assert.equal(clean.installed, true);
  assert.equal(clean.contextGraph, true);
  assert.ok(clean.suggest.stop.some((s) => /이미 설치/.test(s)));
  spawnSync(process.execPath, ['-e', "require('fs').writeFileSync('a.txt','y')"], { cwd: repo.dir });
  assert.ok(detect(repo).suggest.stop.some((s) => /미커밋 변경 1건/.test(s)));
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
  const r = spawnSync(process.execPath, [DETECT, dir], { env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /제안 +프로필 new .* 모드 local \(공유는 사용자가 고른다\)/);
});

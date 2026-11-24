// 코드 영역마다 덮는 검사 — 감지한 영역(Java · JS/TS · Python)의 소스를 covers 로 덮는 검사가 없으면 갱신 · 이식 검사가 ⛔ (26차)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { target, put, tmp } from './scene.mjs';
import { codeAreas, globMatch } from '../tools/detect.mjs';
import { areaGaps, areaGapText } from '../tools/upgrade.mjs';

const UPGRADE = join(fileURLToPath(new URL('..', import.meta.url)), 'tools', 'upgrade.mjs');
const pkg = JSON.stringify({ scripts: { test: 'node --test' } });
const JS = { id: 'npm-test', cmd: 'npm test', kind: 'exit-code', covers: ['tools/**'], recipe: 'node-npm-test' };
const JAVA = { id: 'compile', cmd: 'javac', kind: 'exit-code', covers: ['src/main/java/**'], recipe: 'java-javac-compile' };
const SOURCES = { 'pom.xml': '<project/>', 'src/main/java/com/example/App.java': 'class App {}\n', 'package.json': pkg, 'tools/a.mjs': '0\n' };
const run = (dir, env = process.env) => spawnSync(process.execPath, [UPGRADE, dir], { encoding: 'utf8', env: { ...env, HARNESS_KIT_DIRTY_OK: '1' } });
const conf = (checks) => ({ profile: 'existing', mode: 'local', checks });

test('globMatch — ** · * · 디렉터리 접두어 · ./ · 백슬래시', () => {
  assert.ok(globMatch('src/**', 'src/a/B.java'));
  assert.ok(globMatch('src/**/*.java', 'src/A.java'));
  assert.ok(globMatch('src/**/*.java', 'src/a/b/C.java'));
  assert.ok(!globMatch('src/**/*.java', 'src/a/b/C.xml'));
  assert.ok(globMatch('src/main/java', 'src/main/java/A.java'));
  assert.ok(globMatch('./tools/lib/**', 'tools/lib/x.mjs'));
  assert.ok(globMatch('backend\\src\\**', 'backend/src/A.java'));
  assert.ok(!globMatch('tools/*.mjs', 'tools/lib/x.mjs'));
  assert.ok(!globMatch('src/**', 'srcs/A.java'));
});

test('⭐ 감지 — 빌드 파일 · 스크립트 단서나 소스가 있으면 영역 · 빌드 파일 없는 Java 도 .java 소스로 · 하위 폴더 한 단계의 단서 · 벤더 폴더는 보지 않는다', () => {
  const ids = (files) => codeAreas(target(null, files)).map((a) => a.id);
  assert.deepEqual(ids({ 'README.md': '# 앱\n' }), []);
  assert.deepEqual(ids(SOURCES), ['java', 'js']);
  assert.deepEqual(ids({ 'src/A.java': 'class A {}\n' }), ['java']);
  assert.deepEqual(ids({ 'build.gradle': '', 'src/main/java/A.java': 'class A {}\n' }), ['java']);
  assert.deepEqual(ids({ 'backend/pom.xml': '<project/>', 'frontend/package.json': pkg }), ['java', 'js']);
  // 스크립트 없는 package.json · 벤더 · 빌드 산출물 · 점 폴더 의 소스는 영역이 아니다
  assert.deepEqual(ids({ 'package.json': JSON.stringify({ scripts: { build: 'vite build' } }), 'src/app.js': '0\n' }), []);
  assert.deepEqual(ids({ 'node_modules/x/A.java': '0', 'target/gen/B.java': '0', '.harness/tools/C.java': '0' }), []);
  assert.deepEqual(ids({ 'pytest.ini': '', 'app/m.py': '0\n' }), ['python']);
  const java = codeAreas(target(null, SOURCES)).find((a) => a.id === 'java');
  assert.deepEqual(java.clues, ['pom.xml']);
  assert.deepEqual(java.sources, ['src/main/java/com/example/App.java']);
});

test('⭐ Java + JS 검사만 → Java 영역 ⛔ · 영역 이름 · 소스 · 처방 후보 · Java 를 덮는 검사를 더하면 통과', () => {
  const dir = target(conf([JS]), SOURCES);
  const gaps = areaGaps(dir, conf([JS]));
  assert.deepEqual(gaps.map((g) => g.id), ['java']);
  const text = areaGapText(gaps[0]).text;
  assert.match(text, /코드 영역 Java/);
  assert.match(text, /pom\.xml/);
  assert.match(text, /maven-compile.*java-javac-compile/);
  assert.doesNotMatch(text, /gradle-compile/);
  assert.deepEqual(areaGaps(dir, conf([JS, JAVA])), []);
  // 같은 설정을 갱신이 ⛔ exit 1 로 · 더한 뒤 exit 0 으로
  const r = run(target(conf([JS]), SOURCES));
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /^⛔ 코드 영역 Java/m);
  assert.match(r.stdout, /maven-compile/);
  assert.equal(run(target(conf([JS, JAVA]), SOURCES)).status, 0);
});

test('⭐ JS 검사의 covers 가 Java 소스에 닿지 않으면 덮지 않은 것이다 — 닿는 glob 이어야 한다', () => {
  const dir = target(null, SOURCES);
  assert.deepEqual(areaGaps(dir, conf([{ ...JS, covers: ['src/main/java/**'] }])).map((g) => g.id), ['js']);
  assert.deepEqual(areaGaps(dir, conf([{ ...JAVA, covers: ['tools/**'] }, JS])).map((g) => g.id), ['java']);
  assert.deepEqual(areaGaps(dir, conf([{ ...JAVA, covers: ['src/**/*.java'] }, JS])), []);
});

test('⭐ 「테스트 없음」 선언은 영역마다 — "area" 를 적은 선언만 그 영역을 맡는다 · area 없는 선언은 어느 영역도 맡지 않는다', () => {
  const dir = target(null, SOURCES);
  const none = { id: 'g', cmd: 'node -e "0"', kind: 'exit-code', tests: 'none', why: 'javac 를 못 돌린다' };
  assert.deepEqual(areaGaps(dir, conf([JS, none])).map((g) => g.id), ['java']);
  assert.deepEqual(areaGaps(dir, conf([JS, { ...none, area: 'java' }])), []);
  assert.deepEqual(areaGaps(dir, conf([JS, { ...none, area: ['java', 'js'] }])), []);
  assert.deepEqual(areaGaps(dir, conf([{ ...none, area: 'java' }])).map((g) => g.id), ['js']);
  assert.deepEqual(areaGaps(dir, conf([{ ...none, area: ['java', 'js'] }])), []);
  // 선언은 area 를 적은 것만 영역마다 — 안내 줄이 area 키를 말한다
  assert.match(areaGapText(areaGaps(dir, conf([JS, none]))[0]).text, /"area": "java"/);
});

test('⭐ 빌드 파일 없는 Java — javac 검사가 src/**/*.java 를 덮어야 한다', () => {
  const files = { 'src/com/example/A.java': 'class A {}\n', 'package.json': pkg, 'tools/a.mjs': '0\n' };
  const javac = { id: 'compile', cmd: 'javac', kind: 'exit-code', covers: ['src/**/*.java'], recipe: 'java-javac-compile' };
  assert.deepEqual(areaGaps(target(null, files), conf([JS])).map((g) => g.id), ['java']);
  assert.deepEqual(areaGaps(target(null, files), conf([JS, javac])), []);
  assert.deepEqual(areaGaps(target(null, files), conf([JS, { ...javac, covers: ['lib/**'] }])).map((g) => g.id), ['java']);
});

test('소스가 아직 없는 영역(신규 · 단서만) — covers 를 가진 검사가 있으면 덮은 것으로 본다(소스가 생기면 그때 대조)', () => {
  const dir = target(null, { 'package.json': pkg });
  assert.deepEqual(areaGaps(dir, conf([{ ...JS, covers: ['src/**'] }])), []);
  assert.deepEqual(areaGaps(dir, conf([{ id: 'x', cmd: 'npm test', kind: 'exit-code' }])).map((g) => g.id), ['js']);
});

test('⭐ mvn 이 PATH 에 없으면 mvnd 압축본 안내 한 줄 — pom.xml 이 있는 Java 영역만 · mvn 이 있으면 없다', () => {
  const dir = target(null, SOURCES);
  const gap = areaGaps(dir, conf([JS]))[0];
  const empty = tmp('nopath-');
  const keep = process.env.PATH;
  try {
    process.env.PATH = empty;
    assert.match(areaGapText(gap).note, /PATH.*mvn.*mvnd/);
    put(empty, process.platform === 'win32' ? 'mvn.cmd' : 'mvn', '');
    assert.equal(areaGapText(gap).note, '');
    process.env.PATH = tmp('nopath-');
    const buildless = areaGaps(target(null, { 'src/A.java': 'class A {}\n' }), conf([]))[0];
    assert.equal(areaGapText(buildless).note, '');
  } finally { process.env.PATH = keep; }
});

test('이전에 통과하던 모양은 그대로 — 단서 없는 대상 · 소스를 덮는 한 검사 · 단일 JS 영역', () => {
  assert.deepEqual(areaGaps(target(null, { 'README.md': '# 앱\n' }), conf([])), []);
  assert.deepEqual(areaGaps(target(null, { 'package.json': pkg, 'src/a.js': '0\n' }), conf([{ ...JS, covers: ['src/**'] }])), []);
  assert.equal(run(target(conf([{ ...JS, covers: ['src/**'] }]), { 'package.json': pkg, 'src/a.js': '0\n' })).status, 0);
});

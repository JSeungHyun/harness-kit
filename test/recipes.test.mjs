import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EVIDENCE_KINDS } from '../lib/config.mjs';
import { target, repoFile } from './scene.mjs';

const RECIPES = JSON.parse(repoFile('policy/recipes.json'));
const IDS = RECIPES.map((r) => r.id);
const DETECT = fileURLToPath(new URL('../tools/detect.mjs', import.meta.url));
const run = (dir, ...args) => spawnSync(process.execPath, [DETECT, dir, ...args], { encoding: 'utf8' });
const picked = (files) => {
  const r = run(target(null, files), '--json');
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).recipes.map((x) => x.id);
};
const pkg = (scripts) => JSON.stringify({ scripts });

test('⛔ 처방 형식 — id 하나씩 · 단서 · 검사(kind · junit 은 evidence) · 수정 직후 자리 · 검증됨|후보 · 근거', () => {
  assert.deepEqual(IDS, [...new Set(IDS)]);
  for (const r of RECIPES) {
    assert.match(r.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, r.id);
    assert.ok(r.label?.trim(), r.id);
    assert.equal(typeof r.when, 'object', r.id);
    if ('files' in r.when) assert.ok(Array.isArray(r.when.files) && r.when.files.length, r.id);
    assert.ok(r.checks?.length, r.id);
    for (const c of r.checks) {
      assert.ok(c.id && c.cmd, r.id);
      assert.ok(EVIDENCE_KINDS.includes(c.kind), `${r.id} ${c.kind}`);
      if (c.kind === 'junit-xml') assert.ok(c.evidence, r.id);
    }
    assert.ok(Array.isArray(r.edit), r.id);
    assert.ok(['검증됨', '후보'].includes(r.status), r.id);
    assert.ok(r.basis?.trim(), r.id);
  }
});

test('처음 처방 — 실제 설치에서 쓰는 것만 검증됨 · 나머지는 후보(자동 적용 안 함) · 수정 직후 검사는 측정 뒤에', () => {
  assert.deepEqual(Object.fromEntries(RECIPES.map((r) => [r.id, r.status])), {
    'graph-check': '검증됨', 'node-npm-test': '검증됨', 'java-javac-compile': '검증됨', 'mybatis-xml': '후보', 'maven-test': '후보', 'node-tsc': '후보', 'python-pytest': '후보',
  });
  for (const r of RECIPES) assert.deepEqual(r.edit, [], r.id);
});

test('⭐ detect 가 스택 단서로 처방 후보를 낸다 — 스택마다 합성 픽스처 · 하위 폴더 한 단계 · 스크립트 없는 package.json 은 후보 아님', () => {
  assert.deepEqual(picked({ 'README.md': '# 앱\n' }), ['graph-check']);
  assert.deepEqual(picked({ 'pom.xml': '<project/>' }), ['graph-check', 'maven-test']);
  assert.deepEqual(picked({ 'build.xml': '<project/>' }), ['graph-check', 'java-javac-compile']);
  assert.deepEqual(picked({ 'package.json': pkg({ test: 'node --test' }) }), ['graph-check', 'node-npm-test']);
  assert.deepEqual(picked({ 'package.json': pkg({ build: 'vite build' }) }), ['graph-check']);
  assert.deepEqual(picked({ 'package.json': pkg({ typecheck: 'tsc --noEmit' }), 'tsconfig.json': '{}' }), ['graph-check', 'node-tsc']);
  assert.deepEqual(picked({ 'pyproject.toml': '[tool.pytest.ini_options]\n' }), ['graph-check', 'python-pytest']);
  assert.deepEqual(picked({ 'backend/pom.xml': '<project/>', 'frontend/package.json': pkg({ test: 'vitest' }) }), ['graph-check', 'node-npm-test', 'maven-test']);
});

test('사람용 출력 — 「처방 후보: <id> — <label> (검증됨|후보)」', () => {
  const out = run(target(null, { 'pom.xml': '<project/>' })).stdout;
  for (const id of ['graph-check', 'maven-test']) {
    const r = RECIPES.find((x) => x.id === id);
    assert.ok(out.split(/\r?\n/).includes(`처방 후보: ${id} — ${r.label} (${r.status})`), out);
  }
});

test('⛔ SETUP ⑤ 표는 처방 목록을 가리킨다 — SETUP 의 처방 id 가 목록에 있고, 처방을 가리킨 줄은 그 명령을 다시 적지 않는다(글과 데이터가 두 벌이 되지 않게)', () => {
  const setup = repoFile('SETUP.md');
  assert.match(setup, /<kit>\/policy\/recipes\.json/);
  const named = [...setup.matchAll(/처방 `([\w-]+)`/g)].map((m) => m[1]);
  assert.ok(named.length >= 4, named.join(' '));
  for (const id of named) assert.ok(IDS.includes(id), `SETUP 의 처방 ${id} 가 목록에 없다`);
  for (const line of setup.split(/\r?\n/)) {
    for (const [, id] of line.matchAll(/처방 `([\w-]+)`/g)) {
      for (const c of RECIPES.find((r) => r.id === id)?.checks ?? []) assert.ok(!line.includes(`\`${c.cmd}\``), `${id}: ${line.slice(0, 60)}`);
    }
  }
});

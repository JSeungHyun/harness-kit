import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, cli } from '../lib/config.mjs';
import { target, put, tmp } from './scene.mjs';

test('경로를 대상 루트 기준 절대경로로 돌려준다', () => {
  const dir = target({ state: { decisions: 'docs/harness/decisions.md', lessons: 'docs/harness/lessons.md' }, checks: [] });
  const cfg = loadConfig(dir);
  assert.equal(cfg.state.decisions, join(dir, 'docs', 'harness', 'decisions.md'));
  assert.equal(cfg.state.lessons, join(dir, 'docs', 'harness', 'lessons.md'));
});

test('~ 로 시작하는 경로를 홈 기준으로 편다', () => {
  const cfg = loadConfig(target({ state: { currentRoot: '~/ref' }, checks: [] }));
  assert.equal(cfg.state.currentRoot, join(homedir(), 'ref'));
});

test('선언되지 않은 상태 파일은 undefined, 검사가 없으면 빈 배열이다', () => {
  const cfg = loadConfig(target({ state: { lessons: 'l.md' } }));
  assert.equal(cfg.state.current, undefined);
  assert.equal(cfg.state.decisions, undefined);
  assert.deepEqual(cfg.checks, []);
});

test('설정 파일이 없으면 경로와 다음 행동을 알려주며 실패한다', () => {
  const dir = tmp('harness-');
  assert.throws(() => loadConfig(dir), /harness\.json 이 없다/);
  assert.throws(() => loadConfig(dir), /SETUP\.md/);
});

test('JSON 이 깨졌으면 경로와 함께 실패한다', () => {
  const dir = target(null, { '.harness/harness.json': '{ 깨짐' });
  assert.throws(() => loadConfig(dir), /읽지 못했다/);
});

test('모르는 검사 종류는 거부하고 쓸 수 있는 것을 알려준다', () => {
  const dir = target({ checks: [{ id: 'x', cmd: 'node -v', kind: '초능력' }] });
  assert.throws(() => loadConfig(dir), /알 수 없는 검사 종류: 초능력/);
  assert.throws(() => loadConfig(dir), /junit-xml/);
});

test('⛔ 결과 파일로 판정하는 검사에 evidence 가 없으면 거부한다', () => {
  const dir = target({ checks: [{ id: 't', cmd: 'npm test', kind: 'junit-xml' }] });
  assert.throws(() => loadConfig(dir), /evidence 가 없다/);
});

// probe 스크립트를 공백·한글이 든 경로에 두고 실제로 실행한다
function probe(body) {
  const dir = target(null);
  const lib = JSON.stringify(new URL('../lib/config.mjs', import.meta.url).href);
  put(dir, '공백 있는 폴더/probe.mjs', `import { cli } from ${lib};\n${body}\n`);
  return spawnSync(process.execPath, [join(dir, '공백 있는 폴더', 'probe.mjs')], { encoding: 'utf8' });
}

test('⭐ 직접 실행하면 main 이 돈다 — 판별이 틀리면 도구가 아무것도 안 하고 exit 0 으로 끝난다', () => {
  const r = probe("cli(import.meta.url, () => console.log('돌았다'));");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /돌았다/);
});

test('main 의 오류는 한 줄로 알리고 exit 1 이다', () => {
  const r = probe("cli(import.meta.url, () => { throw new Error('일부러'); });");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /⛔ 일부러/);
});

test('import 만 하면 main 이 돌지 않는다', async () => {
  let ran = false;
  await cli(new URL('../tools/x.mjs', import.meta.url).href, () => {
    ran = true;
  });
  assert.equal(ran, false);
});

test('⛔ output-match 에 expect 가 없거나 정규식이 깨졌으면 거부한다', () => {
  assert.throws(() => loadConfig(target({ checks: [{ id: 'q', cmd: 'node -v', kind: 'output-match' }] })), /expect/);
  assert.throws(() => loadConfig(target({ checks: [{ id: 'q', cmd: 'node -v', kind: 'output-match', expect: '(' }] })), /정규식/);
  assert.equal(loadConfig(target({ checks: [{ id: 'q', cmd: 'node -v', kind: 'output-match', expect: String.raw`^v\d+` }] })).checks.length, 1);
});

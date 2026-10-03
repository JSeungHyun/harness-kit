import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { runChecks } from '../tools/verify.mjs';
import { target, put, fixture } from './scene.mjs';

const VERIFY = fileURLToPath(new URL('../tools/verify.mjs', import.meta.url));

// src 를 dest 로 새로 쓰고 code 로 끝나는 명령 — 셸을 가리지 않게 node 로 쓴다
const write = (src, dest, code = 0) =>
  `node -e "const f=require('fs'),p=require('path');f.mkdirSync(p.dirname('${dest}'),{recursive:true});f.writeFileSync('${dest}',f.readFileSync('${src}'));process.exit(${code})"`;
const exit = (code) => `node -e "process.exit(${code})"`;
const one = async (dir) => (await runChecks(loadConfig(dir)))[0];

test('exit-code 검사는 종료코드로 판정한다', async () => {
  const ok = await one(target({ checks: [{ id: 'ok', cmd: exit(0), kind: 'exit-code' }] }));
  assert.equal(ok.ok, true);
  assert.equal(ok.reason, '종료코드 0');
  const no = await one(target({ checks: [{ id: 'no', cmd: exit(3), kind: 'exit-code' }] }));
  assert.equal(no.ok, false);
  assert.equal(no.reason, '종료코드 3');
});

test('⭐ 명령이 exit 0 이어도 결과 XML 에 실행된 테스트가 없으면 실패다', async () => {
  const dir = target(
    { checks: [{ id: 't', cmd: write('src/stub.xml', 'results/junit.xml'), kind: 'junit-xml', evidence: 'results' }] },
    { 'src/stub.xml': fixture('junit-node-stub.xml') },
  );
  const r = await one(dir);
  assert.equal(r.ok, false);
  assert.match(r.reason, /실행된 테스트가 0개/);
});

test('결과 XML 이 정상이면 통과다', async () => {
  const dir = target(
    { checks: [{ id: 't', cmd: write('src/pass.xml', 'results/junit.xml'), kind: 'junit-xml', evidence: 'results' }] },
    { 'src/pass.xml': fixture('junit-gradle-pass.xml') },
  );
  const r = await one(dir);
  assert.equal(r.ok, true);
  assert.equal(r.reason, '테스트 3 · 실패 0');
});

test('⭐ 이번 실행이 쓰지 않은 결과 XML 은 증거가 아니다', async () => {
  const dir = target(
    { checks: [{ id: 't', cmd: exit(0), kind: 'junit-xml', evidence: 'results' }] },
    { 'results/old.xml': fixture('junit-gradle-pass.xml') },
  );
  const r = await one(dir);
  assert.equal(r.ok, false);
  assert.match(r.reason, /갱신되지 않았다/);
});

test('결과 XML 이 정상이어도 명령이 실패했으면 실패다', async () => {
  const dir = target(
    { checks: [{ id: 't', cmd: write('src/pass.xml', 'results/junit.xml', 1), kind: 'junit-xml', evidence: 'results' }] },
    { 'src/pass.xml': fixture('junit-gradle-pass.xml') },
  );
  const r = await one(dir);
  assert.equal(r.ok, false);
  assert.equal(r.reason, '종료코드 1 · 테스트 3 · 실패 0');
});

test('evidence 가 파일 하나여도 읽는다', async () => {
  const dir = target(
    { checks: [{ id: 't', cmd: write('src/pass.xml', 'junit.xml'), kind: 'junit-xml', evidence: 'junit.xml' }] },
    { 'src/pass.xml': fixture('junit-gradle-pass.xml') },
  );
  assert.equal((await one(dir)).ok, true);
});

// 산출물을 커밋한 git 저장소. harness.json 은 커밋 뒤에 쓴다
function repo(files) {
  const dir = target(null, files);
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir });
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  git('add', '-A');
  git('commit', '-qm', 'init');
  put(dir, '.harness/harness.json', JSON.stringify({
    checks: [{ id: 'api', cmd: write('gen/api.json', 'api.json'), kind: 'file-unchanged', evidence: 'api.json' }],
  }));
  return dir;
}

test('file-unchanged: 다시 만든 산출물이 그대로면 통과, 바뀌면 실패다', async () => {
  const same = await one(repo({ 'api.json': '{"v":1}\n', 'gen/api.json': '{"v":1}\n' }));
  assert.equal(same.ok, true);
  const changed = await one(repo({ 'api.json': '{"v":1}\n', 'gen/api.json': '{"v":2}\n' }));
  assert.equal(changed.ok, false);
  assert.match(changed.reason, /바뀌었다/);
});

test('⛔ file-unchanged: 커밋된 적 없는 산출물은 그대로가 아니다', async () => {
  const r = await one(repo({ 'readme.md': 'x\n', 'gen/api.json': '{"v":1}\n' }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /바뀌었다/);
});

test('⛔ CLI: 검사가 0개면 exit 1 이다 — 「검사가 없어 전부 통과」는 거짓 신호다', () => {
  const r = spawnSync(process.execPath, [VERIFY, target({ checks: [] })], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /선언된 검사가 없다/);
});

test('CLI: 실패한 검사를 이유와 함께 보이고 exit 1 이다', () => {
  const dir = target({ checks: [{ id: '빌드', cmd: exit(0), kind: 'exit-code' }, { id: '테스트', cmd: exit(2), kind: 'exit-code' }] });
  const r = spawnSync(process.execPath, [VERIFY, dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✅ 빌드 — 종료코드 0/);
  assert.match(r.stdout, /⛔ 테스트 — 종료코드 2/);
});

test('CLI: 전부 통과면 exit 0 이다', () => {
  const r = spawnSync(process.execPath, [VERIFY, target({ checks: [{ id: 'ok', cmd: exit(0), kind: 'exit-code' }] })], { encoding: 'utf8' });
  assert.equal(r.status, 0);
});

// 실패 3건이 든 XML 을 쓰고 exit 1 로 끝나는 러너 — 실패가 있으면 러너는 늘 exit 1 이다
const failing = (base) => target(
  { checks: [{ id: '단위 테스트', cmd: write('src/fail.xml', 'results/junit.xml', 1), kind: 'junit-xml', evidence: 'results' }] },
  { 'src/fail.xml': fixture('junit-gradle-fail.xml'), ...(base ? { '.harness/baseline/단위 테스트.txt': base } : {}) },
);
const KEYS = ['비밀번호가 틀리면 401()', '잠긴 계정은 423()', '토큰을 발급한다()'].map((n) => `com.example.auth.LoginControllerTest::${n}`);

test('⭐ 명령이 exit 1 이어도 실패가 전부 기준선 안이면 통과다', async () => {
  const r = await one(failing(`# 원래 있던 실패\n\n${KEYS.join('\n')}\n`));
  assert.equal(r.ok, true);
  assert.equal(r.reason, '테스트 4 · 실패 0 · 기준선 실패 3');
});

test('⛔ 기준선 밖 실패가 있으면 종료코드와 함께 실패다', async () => {
  const r = await one(failing(KEYS.slice(0, 2).join('\r\n')));
  assert.equal(r.ok, false);
  assert.equal(r.reason, '종료코드 1 · 테스트 4 · 실패 1 (기준선 밖) · 기준선 실패 2');
});

test('검사 id 의 경로 금지 문자는 _ 로 바꾼 파일을 읽는다', async () => {
  const dir = target(
    { checks: [{ id: 'unit/a:b', cmd: write('src/fail.xml', 'results/junit.xml', 1), kind: 'junit-xml', evidence: 'results' }] },
    { 'src/fail.xml': fixture('junit-gradle-fail.xml'), '.harness/baseline/unit_a_b.txt': KEYS.join('\n') },
  );
  assert.equal((await one(dir)).ok, true);
});

test('⭐ CLI --baseline: 지금의 실패를 기준선에 쓰고, 다음 verify 가 통과한다', () => {
  const dir = failing();
  assert.equal(spawnSync(process.execPath, [VERIFY, dir], { encoding: 'utf8' }).status, 1);
  const b = spawnSync(process.execPath, [VERIFY, dir, '--baseline'], { encoding: 'utf8' });
  assert.equal(b.status, 0);
  assert.match(b.stdout, /기준선 3건/);
  const written = readFileSync(join(dir, '.harness', 'baseline', '단위 테스트.txt'), 'utf8');
  assert.deepEqual(written.split(/\r?\n/).filter((l) => l && !l.startsWith('#')), [...KEYS].sort());
  const v = spawnSync(process.execPath, [VERIFY, dir], { encoding: 'utf8' });
  assert.equal(v.status, 0);
  assert.match(v.stdout, /기준선 실패 3/);
});

test('⛔ CLI --baseline: 실행된 테스트가 0개면 쓰지 않고 이유를 낸다', () => {
  const dir = target(
    { checks: [{ id: 't', cmd: write('src/stub.xml', 'results/junit.xml'), kind: 'junit-xml', evidence: 'results' }] },
    { 'src/stub.xml': fixture('junit-node-stub.xml') },
  );
  const r = spawnSync(process.execPath, [VERIFY, dir, '--baseline'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /쓰지 않았다.*실행된 테스트가 0개/);
  assert.equal(existsSync(join(dir, '.harness', 'baseline')), false);
});

const say = (text, code = 0) => `node -e "console.log('${text}');process.exit(${code})"`;

test('output-match: 출력이 기대와 맞으면 통과, 아니면 실패, 명령이 실패하면 실패', async () => {
  const check = (cmd, expect) => one(target({ checks: [{ id: 'q', cmd, kind: 'output-match', expect }] }));
  const hit = await check(say('rows=0'), '^rows=0$');
  assert.equal(hit.ok, true);
  assert.equal(hit.reason, '출력이 기대와 맞는다');
  const miss = await check(say('rows=3'), '^rows=0$');
  assert.equal(miss.ok, false);
  assert.equal(miss.reason, '출력이 /^rows=0$/ 와 맞지 않는다');
  const broke = await check(say('rows=0', 2), '^rows=0$');
  assert.equal(broke.ok, false);
  assert.equal(broke.reason, '종료코드 2');
});

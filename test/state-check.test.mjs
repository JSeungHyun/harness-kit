import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.mjs';
import { hash12 } from '../lib/mdtable.mjs';
import { auditState } from '../tools/state-check.mjs';
import { target } from './scene.mjs';

const STATE_CHECK = fileURLToPath(new URL('../tools/state-check.mjs', import.meta.url));
const HEAD = '| 파일 | 상태 | 해시 |\n|---|---|---|\n';

// 대장은 docs/ledger.md, 대장이 가리키는 원본은 ref/ 아래
function scene(rows, files) {
  const refs = Object.fromEntries(Object.entries(files).map(([k, v]) => [`ref/${k}`, v]));
  return target({ state: { current: 'docs/ledger.md', currentRoot: 'ref' } }, { 'docs/ledger.md': HEAD + rows.join('\n'), ...refs });
}
const audit = (dir) => auditState(loadConfig(dir));

test('해시가 맞으면 재작업 대상이 아니다', () => {
  const body = 'export const x = 1;\n';
  const r = audit(scene([`| \`a.ts\` | 분석완료 | \`${hash12(Buffer.from(body))}\` |`], { 'a.ts': body }));
  assert.deepEqual(r.stale, []);
  assert.deepEqual(r.missing, []);
  assert.equal(r.integrityOk, true);
});

test('⭐ 원본이 바뀌면 재작업 대상으로 돌아오고 현재 해시를 알려준다', () => {
  const r = audit(scene(['| `a.ts` | 분석완료 | `000000000000` |'], { 'a.ts': 'x\n' }));
  assert.deepEqual(r.stale, [{ target: 'a.ts', hash: hash12(Buffer.from('x\n')) }]);
});

test('⛔ 대장이 가리키는 파일이 사라지면 무결성 위반이다', () => {
  const r = audit(scene(['| `gone.ts` | 분석완료 | `abc123abc123` |'], {}));
  assert.deepEqual(r.missing, ['gone.ts']);
  assert.equal(r.integrityOk, false);
});

test('미분석은 잔량이고, 해당없음은 파일이 없어도 어디에도 세지 않는다', () => {
  const r = audit(scene(['| `a.ts` | 미분석 | `` |', '| `old.ts` | 해당없음 | `` |'], { 'a.ts': 'x\n' }));
  assert.deepEqual(r.stale, []);
  assert.deepEqual(r.missing, []);
  assert.equal(r.remaining, 1);
});

test('currentRoot 가 없으면 대상 루트 기준이다', () => {
  const dir = target({ state: { current: 'docs/ledger.md' } }, { 'docs/ledger.md': `${HEAD}| \`src/a.ts\` | 미분석 | \`\` |`, 'src/a.ts': 'x\n' });
  assert.equal(audit(dir).remaining, 1);
});

test('CLI: 대장이 설정되지 않았으면 건너뛴다 (exit 0)', () => {
  const r = spawnSync(process.execPath, [STATE_CHECK, target({})], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /건너뛴다/);
});

test('⛔ CLI: 무결성 위반은 exit 1 이다', () => {
  const r = spawnSync(process.execPath, [STATE_CHECK, scene(['| `gone.ts` | 분석완료 | `abc123abc123` |'], {})], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /gone\.ts — 대장이 가리키는 파일이 없다/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuditRows, cells, hash12 } from '../lib/mdtable.mjs';
import { repoFile } from './scene.mjs';

const LEDGER = [
  '| 값 | 뜻 |',
  '|---|---|',
  '| `분석완료` | 끝까지 읽었다 |',
  '',
  '| 파일 | 상태 | 해시 | 메모 |',
  '|---|---|---|---|',
  '| `src/engine.ts` | 분석완료 | `a1b2c3d4e5f6` | 표본 |',
  '| `src/App.tsx` | 미분석 | `` | |',
].join('\n');

test('경로·상태·해시 세 칸을 가진 행만 뽑는다', () => {
  assert.deepEqual(parseAuditRows(LEDGER), [
    { target: 'src/engine.ts', status: '분석완료', hash: 'a1b2c3d4e5f6' },
    { target: 'src/App.tsx', status: '미분석', hash: '' },
  ]);
});

test('CRLF 파일도 같게 읽는다', () => {
  assert.deepEqual(parseAuditRows(LEDGER.replace(/\n/g, '\r\n')), parseAuditRows(LEDGER));
});

test('⛔ 대장 템플릿의 설명표를 데이터로 오인하지 않는다', () => {
  assert.deepEqual(parseAuditRows(repoFile('templates/state/current.md')), []);
});

test('값 안의 \\| 는 칸 구분자가 아니다', () => {
  assert.deepEqual(cells('| a \\| b | c |'), ['a \\| b', 'c']);
  assert.equal(cells('표가 아닌 줄'), null);
});

test('해시는 12자이고 줄바꿈 방식에 흔들리지 않는다', () => {
  assert.match(hash12(Buffer.from('a\nb')), /^[0-9a-f]{12}$/);
  assert.equal(hash12(Buffer.from('a\r\nb')), hash12(Buffer.from('a\nb')));
});

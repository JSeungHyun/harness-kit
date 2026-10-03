import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.mjs';
import { appendLesson } from '../tools/lesson-append.mjs';
import { promotionCandidates } from '../tools/lesson-promote.mjs';
import { target, repoFile } from './scene.mjs';

const PROMOTE = fileURLToPath(new URL('../tools/lesson-promote.mjs', import.meta.url));
const HEAD = '| id | 분류 | 증상 | 근본 원인 | 무엇이 막는가 |\n|---|---|---|---|---|\n';
const scene = (rows) => target({ state: { lessons: 'l.md' } }, { 'l.md': HEAD + rows.join('\n') });
const cands = (rows) => promotionCandidates(loadConfig(scene(rows)), 2);

test('같은 분류가 임계 이상이고 막는 것이 없으면 후보다', () => {
  assert.deepEqual(cands(['| L001 | 검증 부족 | a | b | ⛔ 아직 없다 |', '| L002 | 검증 부족 | c | d | ⛔ 아직 없다 |']), [
    { category: '검증 부족', count: 2, ids: ['L001', 'L002'] },
  ]);
});

test('임계 미만은 후보가 아니다', () => {
  assert.deepEqual(cands(['| L001 | 검증 부족 | a | b | ⛔ 아직 없다 |']), []);
});

test('⭐ 이미 막는 것이 있는 항목은 세지 않는다 — 승격이 끝난 것이다', () => {
  assert.deepEqual(cands(['| L001 | 검증 부족 | a | b | .claude/rules/edits.md |', '| L002 | 검증 부족 | c | d | ⛔ 아직 없다 |']), []);
});

test('분류가 섞여 있으면 각각 센다', () => {
  const r = cands([
    '| L001 | 검증 부족 | a | b | ⛔ 아직 없다 |',
    '| L002 | 잘못된 도구 | c | d | ⛔ 아직 없다 |',
    '| L003 | 잘못된 도구 | e | f | ⛔ 아직 없다 |',
  ]);
  assert.deepEqual(r.map((c) => c.category), ['잘못된 도구']);
});

test('값 안의 \\| 가 있어도 「무엇이 막는가」 칸을 읽는다', () => {
  assert.deepEqual(cands(['| L001 | 검증 부족 | a \\| b | c | ⛔ 아직 없다 |', '| L002 | 검증 부족 | d | e | ⛔ 아직 없다 |'])[0].count, 2);
});

test('⭐ lesson-append 가 쓴 행을 그대로 읽는다', () => {
  const cfg = loadConfig(target({ state: { lessons: 'l.md' } }, { 'l.md': repoFile('templates/state/lessons.md') }));
  for (const symptom of ['치환이 아무것도 안 바꿨다', '생성 스크립트가 빈 파일을 썼다']) {
    appendLesson(cfg, { symptom, cause: '실패를 알리지 않는 명령의 결과를 확인하지 않았다', category: '검증 부족' });
  }
  assert.deepEqual(promotionCandidates(cfg), [{ category: '검증 부족', count: 2, ids: ['L001', 'L002'] }]);
});

test('CLI: 후보가 없으면 그렇게 말하고 exit 0 이다', () => {
  const r = spawnSync(process.execPath, [PROMOTE, scene([])], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /승격 후보 없음/);
});

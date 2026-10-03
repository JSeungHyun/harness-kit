import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.mjs';
import { cells } from '../lib/mdtable.mjs';
import { appendLesson, NO_GUARD } from '../tools/lesson-append.mjs';
import { target, repoFile } from './scene.mjs';

const APPEND = fileURLToPath(new URL('../tools/lesson-append.mjs', import.meta.url));
const scene = () => target({ state: { lessons: 'docs/lessons.md' } }, { 'docs/lessons.md': repoFile('templates/state/lessons.md') });
const OK = {
  symptom: '치환 명령이 아무것도 안 바꿨는데 커밋됐다',
  cause: '찾는 문자열이 파일에 없었고 치환은 실패를 알리지 않는다',
  category: '검증 부족',
  guard: '',
};
const lastRow = (cfg) => readFileSync(cfg.state.lessons, 'utf8').trimEnd().split(/\r?\n/).at(-1);

test('설치 템플릿의 표에 교훈 한 건을 덧붙이고 id 를 돌려준다', () => {
  const cfg = loadConfig(scene());
  assert.deepEqual(appendLesson(cfg, OK), { id: 'L001' });
  assert.deepEqual(cells(lastRow(cfg)), ['L001', '검증 부족', OK.symptom, OK.cause, NO_GUARD]);
});

test('id 가 증가한다', () => {
  const cfg = loadConfig(scene());
  appendLesson(cfg, OK);
  assert.equal(appendLesson(cfg, OK).id, 'L002');
});

test('막는 것을 적으면 그대로 남는다', () => {
  const cfg = loadConfig(scene());
  appendLesson(cfg, { ...OK, guard: '.claude/rules/edits.md' });
  assert.equal(cells(lastRow(cfg))[4], '.claude/rules/edits.md');
});

test('⛔ 분류가 네 가지 밖이면 거부한다', () => {
  assert.throws(() => appendLesson(loadConfig(scene()), { ...OK, category: '그냥 실수' }), /알 수 없는 분류/);
});

test('⛔ 근본 원인이 비면 거부한다 — 증상만 적는 것은 일기다', () => {
  assert.throws(() => appendLesson(loadConfig(scene()), { ...OK, cause: '  ' }), /근본 원인/);
});

test('값에 | 와 줄바꿈이 들어가도 표가 깨지지 않는다', () => {
  const cfg = loadConfig(scene());
  appendLesson(cfg, { ...OK, symptom: 'a | b\nc' });
  assert.equal(cells(lastRow(cfg)).length, 5);
});

test('CLI: 표준입력의 JSON 을 기록한다', () => {
  const r = spawnSync(process.execPath, [APPEND, scene()], { input: JSON.stringify(OK), encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /기록: L001/);
});

test('⛔ CLI: 거부하면 이유와 함께 exit 1 이다', () => {
  const r = spawnSync(process.execPath, [APPEND, scene()], { input: JSON.stringify({ ...OK, cause: '' }), encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /근본 원인/);
});

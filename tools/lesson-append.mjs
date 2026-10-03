#!/usr/bin/env node
// ④ LESSONS 입구 — 반복 실패를 규약으로 올리려면 입구가 있어야 한다. 설계안.
// ⛔ 자동 추출하지 않는다. 판단을 거친 한 건을 근본 원인과 함께 적는다.

import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig, cli } from '../lib/config.mjs';

export const CATEGORIES = ['누락된 컨텍스트', '잘못된 도구', '미흡한 권한', '검증 부족'];
export const NO_GUARD = '⛔ 아직 없다';

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

export function appendLesson(cfg, entry) {
  if (!cfg.state.lessons) throw new Error('.harness/harness.json 에 state.lessons 가 없다');
  if (!CATEGORIES.includes(entry.category)) {
    throw new Error(`알 수 없는 분류: ${entry.category}\n  쓸 수 있는 것: ${CATEGORIES.join(' · ')}`);
  }
  if (!cell(entry.symptom)) throw new Error('증상이 비었다');
  if (!cell(entry.cause)) throw new Error('근본 원인이 비었다 — 증상만 적는 것은 일기이지 교훈이 아니다');

  const text = readFileSync(cfg.state.lessons, 'utf8');
  const used = [...text.matchAll(/^\|\s*L(\d+)\s*\|/gm)].map((m) => Number(m[1]));
  const id = `L${String(Math.max(0, ...used) + 1).padStart(3, '0')}`;
  const row = `| ${id} | ${entry.category} | ${cell(entry.symptom)} | ${cell(entry.cause)} | ${cell(entry.guard) || NO_GUARD} |`;
  writeFileSync(cfg.state.lessons, `${text.trimEnd()}\n${row}\n`);
  return { id };
}

cli(import.meta.url, () => {
  const { id } = appendLesson(loadConfig(process.argv[2] ?? process.cwd()), JSON.parse(readFileSync(0, 'utf8')));
  console.log(`기록: ${id}`);
});

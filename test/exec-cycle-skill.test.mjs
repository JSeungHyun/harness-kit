// /exec-cycle 스킬 템플릿 — 앞머리(사용자가 부를 때만 · Stop 훅)와 깔리는 문서 목록(26차)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { repoFile } from './scene.mjs';
import { DOCS, partOf } from '../lib/parts.mjs';

const SKILL = 'templates/skills/exec-cycle/SKILL.md';
const head = () => repoFile(SKILL).replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
const body = () => repoFile(SKILL).replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');

test('⭐ 앞머리 — 사용자가 부를 때만(disable-model-invocation) · Stop 훅은 cycle-gate 를 30초 안에', () => {
  const h = head();
  assert.match(h, /^name: exec-cycle$/m);
  assert.match(h, /^description: .{10,}$/m);
  assert.match(h, /^disable-model-invocation: true$/m);
  assert.match(h, /^hooks:\n\s+Stop:/m);
  assert.match(h, /command: 'node "\$\{CLAUDE_PROJECT_DIR\}\/\.harness\/tools\/cycle-gate\.mjs"'/);
  assert.match(h, /timeout: 30/);
});

test('⭐ 본문 — 단계 다섯(설계 · 계획 · 구현 · verify · ponytail)과 보고 · superpowers · ponytail 은 Skill 도구가 아니라 cycle-skill 로 파일을 읽는다', () => {
  const b = body();
  for (const word of ['brainstorming', 'writing-plans', 'executing-plans', 'verify.mjs', 'ponytail-review', 'cycle-skill.mjs']) assert.ok(b.includes(word), word);
  assert.match(b, /Skill 도구/);
  assert.match(b, /net:/);
  assert.match(b, /Lean already/);
  assert.match(b, /그래프/);
  assert.ok(b.length < 2500, `본문 ${b.length}자 — 짧게`);
});

test('깔리는 문서 목록에 있다 — 설치 위치 · 갈래(kit) · 템플릿 파일', () => {
  const d = DOCS.find(([src]) => src === SKILL);
  assert.deepEqual(d, [SKILL, '.claude/skills/exec-cycle/SKILL.md', 'exec-cycle']);
  assert.ok(existsSync(new URL(`../${SKILL}`, import.meta.url)));
  assert.equal(partOf('.claude/skills/exec-cycle/SKILL.md', {}), 'kit');
});

test('⭐ exec-review — 검증 전용 · 같은 훅 · 설계 단계 없이 verify · ponytail · 보고 · 깔리는 문서 목록에 있다', () => {
  const R = 'templates/skills/exec-review/SKILL.md';
  const h = repoFile(R).replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
  const b = repoFile(R).replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
  assert.match(h, /^name: exec-review$/m);
  assert.match(h, /^disable-model-invocation: true$/m);
  assert.match(h, /command: 'node "\$\{CLAUDE_PROJECT_DIR\}\/\.harness\/tools\/cycle-gate\.mjs"'/);
  assert.match(h, /timeout: 30/);
  for (const word of ['verify.mjs', 'ponytail-review', 'cycle-skill.mjs', 'net:', 'Lean already', '그래프']) assert.ok(b.includes(word), word);
  assert.ok(!/brainstorming|writing-plans|executing-plans/.test(b), '설계 · 계획 · 구현 단계가 없다');
  assert.ok(b.length < 1500, `본문 ${b.length}자 — 짧게`);
  assert.deepEqual(DOCS.find(([src]) => src === R), [R, '.claude/skills/exec-review/SKILL.md', 'exec-review']);
  assert.equal(partOf('.claude/skills/exec-review/SKILL.md', {}), 'kit');
});

test('⭐ 27차 — 두 스킬 모두 「⏸ 사용자 대기 — 이유」 표지를 안내한다 · exec-cycle 은 커밋 금지 때 작업 스크립트 대신 계획서에 진행을 적게 한다', () => {
  const R = 'templates/skills/exec-review/SKILL.md';
  const strip = (rel) => repoFile(rel).replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
  for (const b of [body(), strip(R)]) assert.match(b, /⏸ 사용자 대기 — <이유>/);
  assert.match(body(), /커밋을 막았.*task-start.*task-done.*계획서에 진행/s);
  assert.ok(body().length < 2500 && strip(R).length < 1500, '본문 예산');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../tools/plugin-plan.mjs';

// 정책이 켜는 것(superpowers)과 사용자 범위에서 꺼 두는 것(ponytail — 리뷰 스킬만 쓴다)
const IDS = ['superpowers@harness-kit'];
const OFF = ['ponytail@harness-kit'];
const SKILL = 'node C:/kit/tools/plugin-plan.mjs --review-skill';
const p = (id, scope = 'user', enabled = true, version) => ({ id, scope, enabled, version });

test('⭐ 키트가 고정 버전을 올렸으면 — 마켓을 갱신하고 사용자 범위로 올린다(--scope 없이는 그 폴더의 local 기록만 오른다)', () => {
  const list = [p('superpowers@harness-kit', 'user', true, '6.1.1'), p('ponytail@harness-kit', 'user', false, '4.9.0')];
  const pinned = { 'superpowers@harness-kit': '6.2.0', 'ponytail@harness-kit': '4.13.0' };
  assert.deepEqual(plan(list, IDS, 'C:/kit', pinned, OFF), [
    'claude plugin marketplace update harness-kit',
    'claude plugin update superpowers@harness-kit --scope user',
    'claude plugin update ponytail@harness-kit --scope user',
  ]);
});

test('⭐ ponytail 은 리뷰 스킬을 먼저 두고 사용자 범위에서 끈다 — 지우지 않는다(모드를 쓰는 프로젝트가 자기 설정에서 켠다)', () => {
  assert.deepEqual(plan([p('superpowers@harness-kit'), p('ponytail@harness-kit')], IDS, 'C:/kit', {}, OFF, false), [
    SKILL,
    'claude plugin disable ponytail@harness-kit --scope user',
  ]);
});

test('⭐ 다른 마켓으로 쓰던 사용자 범위 플러그인 — 키트 마켓 것을 먼저 깔고 옛 것을 지운다 · ponytail 은 깔지 않는다', () => {
  const list = [p('superpowers@superpowers-marketplace'), p('ponytail@ponytail'), p('ponytail@ponytail', 'local'), p('other@m')];
  assert.deepEqual(plan(list, IDS, 'C:/kit', {}, OFF, false), [
    SKILL,
    'claude plugin marketplace add C:/kit',
    'claude plugin install superpowers@harness-kit',
    'claude plugin uninstall superpowers@superpowers-marketplace --scope user',
    'claude plugin uninstall ponytail@ponytail --scope user',
  ]);
});

test('이미 맞췄으면 할 일이 없다 — 리뷰 스킬 있음 · ponytail 은 꺼져 있거나 없다 · 다른 프로젝트의 local 기록은 보지 않는다', () => {
  assert.deepEqual(plan([p('superpowers@harness-kit'), p('ponytail@harness-kit', 'user', false), p('ponytail@ponytail', 'local')], IDS, 'C:/kit', {}, OFF, true), []);
  assert.deepEqual(plan([p('superpowers@harness-kit')], IDS, 'C:/kit', {}, OFF, true), []);
});

test('설치는 됐는데 꺼져 있으면 켠다 · 아무것도 없으면 superpowers 설치와 리뷰 스킬만', () => {
  assert.deepEqual(plan([p('superpowers@harness-kit', 'user', false)], IDS, 'C:/kit', {}, OFF, true), [
    'claude plugin enable superpowers@harness-kit',
  ]);
  assert.deepEqual(plan([], IDS, 'C:/kit', {}, OFF, false), [
    SKILL,
    'claude plugin marketplace add C:/kit',
    'claude plugin install superpowers@harness-kit',
  ]);
});

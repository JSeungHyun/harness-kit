import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../tools/plugin-plan.mjs';
import { skillInstead } from '../tools/policy-apply.mjs';
import { tmp, put } from './scene.mjs';

const IDS = ['superpowers@harness-kit', 'ponytail@harness-kit'];
const p = (id, scope = 'user', enabled = true, version) => ({ id, scope, enabled, version });

test('⭐ 키트가 고정 버전을 올렸으면 — 마켓을 갱신하고 그 플러그인을 올린다(PC 마다 한 번이면 모든 프로젝트에 퍼진다)', () => {
  const list = [p('superpowers@harness-kit', 'user', true, '6.1.1'), p('ponytail@harness-kit', 'user', true, '4.9.0')];
  const pinned = { 'superpowers@harness-kit': '6.2.0', 'ponytail@harness-kit': '4.9.0' };
  assert.deepEqual(plan(list, IDS, 'C:/kit', pinned), [
    'claude plugin marketplace update harness-kit',
    'claude plugin update superpowers@harness-kit',
  ]);
});

test('⭐ 다른 마켓으로 쓰던 사용자 범위 플러그인 — 키트 마켓 것을 먼저 깔고 옛 것을 지운다', () => {
  const list = [p('superpowers@superpowers-marketplace'), p('ponytail@ponytail'), p('ponytail@ponytail', 'local'), p('other@m')];
  assert.deepEqual(plan(list, IDS, 'C:/kit'), [
    'claude plugin marketplace add C:/kit',
    'claude plugin install superpowers@harness-kit',
    'claude plugin install ponytail@harness-kit',
    'claude plugin uninstall superpowers@superpowers-marketplace --scope user',
    'claude plugin uninstall ponytail@ponytail --scope user',
  ]);
});

test('이미 옮겼으면 할 일이 없다 — 다른 프로젝트의 로컬 범위 옛 id 는 그 프로젝트 갱신이 끈다', () => {
  assert.deepEqual(plan([p('superpowers@harness-kit'), p('ponytail@harness-kit'), p('ponytail@ponytail', 'local')], IDS, 'C:/kit'), []);
});

test('사용자 스킬 ponytail-review 가 있는 PC — ponytail 은 옮길 대상이 아니다', () => {
  const cfg = tmp('claudecfg-');
  put(cfg, 'skills/ponytail-review/SKILL.md', '---\nname: ponytail-review\n---\n');
  const ids = IDS.filter((id) => !skillInstead(id, cfg));
  assert.deepEqual(plan([p('superpowers@superpowers-marketplace')], ids, 'C:/kit'), [
    'claude plugin marketplace add C:/kit',
    'claude plugin install superpowers@harness-kit',
    'claude plugin uninstall superpowers@superpowers-marketplace --scope user',
  ]);
});

test('설치는 됐는데 꺼져 있으면 켠다 · 아무것도 없으면 설치만', () => {
  assert.deepEqual(plan([p('superpowers@harness-kit', 'user', false), p('ponytail@harness-kit')], IDS, 'C:/kit'), [
    'claude plugin enable superpowers@harness-kit',
  ]);
  assert.deepEqual(plan([], IDS, 'C:/kit'), [
    'claude plugin marketplace add C:/kit',
    'claude plugin install superpowers@harness-kit',
    'claude plugin install ponytail@harness-kit',
  ]);
});

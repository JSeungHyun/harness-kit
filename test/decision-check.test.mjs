import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.mjs';
import { auditDecisions } from '../tools/decision-check.mjs';
import { target, repoFile } from './scene.mjs';

const DECISION_CHECK = fileURLToPath(new URL('../tools/decision-check.mjs', import.meta.url));

const BODY = [
  '# 확인 필요 사항',
  '| | |',
  '|---|---|',
  '| 갱신일 | 2026-09-23 |',
  '',
  '# 1. 답변이 필요합니다',
  '',
  '## Q1 · 결제 실패 시 재시도를 3회로 가정했다',
  '내용',
  '## Q2 · 관리자 화면을 이번 범위에서 뺐다',
  '내용',
  '',
  '# 3. 해소된 것',
  '',
  '## Q0 · 로그 보관 기간 · 2026-09-20',
].join('\n');

const scene = (body) => target({ state: { decisions: 'docs/decisions.md' } }, { 'docs/decisions.md': body });
const audit = (body, today) => auditDecisions(loadConfig(scene(body)), new Date(today));

test('1절의 Q 항목만 열린 것으로 센다 — 3절(해소된 것)은 세지 않는다', () => {
  assert.deepEqual(audit(BODY, '2026-09-28').open, [
    { id: 'Q1', title: '결제 실패 시 재시도를 3회로 가정했다' },
    { id: 'Q2', title: '관리자 화면을 이번 범위에서 뺐다' },
  ]);
});

test('갱신일로부터 경과일을 센다', () => {
  const r = audit(BODY, '2026-09-28');
  assert.equal(r.staleDays, 5);
  assert.equal(r.warn, false);
});

test('⭐ 열린 질문이 있고 14일을 넘기면 경고한다', () => {
  assert.equal(audit(BODY, '2026-10-20').warn, true);
});

test('열린 질문이 없으면 오래돼도 경고하지 않는다', () => {
  const body = ['| 갱신일 | 2026-01-01 |', '# 1. 답변이 필요합니다', '', '# 3. 해소된 것'].join('\n');
  assert.equal(audit(body, '2026-10-20').warn, false);
});

test('CRLF 파일도 같게 읽는다', () => {
  assert.deepEqual(audit(BODY.replace(/\n/g, '\r\n'), '2026-09-28'), audit(BODY, '2026-09-28'));
});

test('⛔ 설치 템플릿에는 열린 질문이 없다 — 예시가 질문으로 세지면 설치 직후부터 거짓 경고다', () => {
  const r = audit(repoFile('templates/state/decisions.md'), '2026-10-02');
  assert.deepEqual(r.open, []);
  assert.equal(r.staleDays, null);
});

test('CLI: 경고가 있어도 exit 0 이다 — 답을 기다리는 것은 결함이 아니다', () => {
  // CLI 는 실제 오늘 날짜를 쓴다 — 갱신일을 오늘 기준으로 묵힌다
  const old = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const r = spawnSync(process.execPath, [DECISION_CHECK, scene(BODY.replace('2026-09-23', old))], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /열린 결정 2건/);
  assert.match(r.stdout, /⚠️/);
});

test('CLI: 장부가 설정되지 않았으면 건너뛴다', () => {
  const r = spawnSync(process.execPath, [DECISION_CHECK, target({})], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /건너뛴다/);
});

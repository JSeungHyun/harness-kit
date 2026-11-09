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
const audit = (body) => auditDecisions(loadConfig(scene(body)));

test('1절의 Q 항목만 열린 것으로 센다 — 3절(해소된 것)은 세지 않는다', () => {
  assert.deepEqual(audit(BODY), { open: [
    { id: 'Q1', title: '결제 실패 시 재시도를 3회로 가정했다' },
    { id: 'Q2', title: '관리자 화면을 이번 범위에서 뺐다' },
  ] });
});

test('CRLF 파일도 같게 읽는다', () => {
  assert.deepEqual(audit(BODY.replace(/\n/g, '\r\n')), audit(BODY));
});

test('⛔ 설치 템플릿에는 열린 질문이 없다 — 예시가 질문으로 세지면 설치 직후부터 거짓 목록이다', () => {
  assert.deepEqual(audit(repoFile('templates/state/decisions.md')).open, []);
  // 날짜 경고를 지웠다 — 파일 갱신일은 어느 항목을 고쳐도 다시 시작해 0번 울렸다(plan 11차)
  assert.doesNotMatch(repoFile('templates/state/decisions.md'), /갱신일/);
});

test('⭐ CLI: 열린 질문 목록만 내고 exit 0 이다 — 날짜 경고는 없다(파일 갱신일 기준이라 0번 울렸다)', () => {
  const r = spawnSync(process.execPath, [DECISION_CHECK, scene(BODY)], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /열린 결정 2건/);
  assert.match(r.stdout, /Q1 결제 실패/);
  assert.doesNotMatch(r.stdout, /⚠️|갱신 후|일을 넘겼다/);
});

test('CLI: 장부가 설정되지 않았으면 건너뛴다', () => {
  const r = spawnSync(process.execPath, [DECISION_CHECK, target({})], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /건너뛴다/);
});

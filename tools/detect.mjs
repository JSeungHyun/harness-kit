#!/usr/bin/env node
// 설치 전 판별 — 대상의 사실을 모으고 프로필(신규/기존)·모드(공유/로컬)를 제안한다. ⛔ 대상을 바꾸지 않는다(읽기만). 설계안.
//   node <kit>/tools/detect.mjs <대상> [--json]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cli } from '../lib/config.mjs';

const SOURCE = /\.(c?[jt]sx?|m[jt]s|vue|svelte|java|kts?|scala|groovy|py|rb|go|rs|[ch]|cc|cpp|hpp|cs|php|swift|dart|sql|jsp|sh)$/i;
const INSTRUCTIONS = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md'];
const OTHER_RULES = ['.cursor/rules', '.cursorrules', '.github/copilot-instructions.md'];
export const INSTALL_PROBES = ['.claude/rules/harness.md', '.harness/harness.json', 'AGENTS.md', 'CLAUDE.md'];
const INSTALLED = ['.harness', '.claude/rules/harness.md', '.claude/skills/final-gate'];

function git(dir, ...args) {
  try {
    return { ok: true, out: execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) };
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? '') };
  }
}
const lines = (s) => s.split(/\r?\n/).filter(Boolean);

function testHints(dir) {
  const has = (f) => existsSync(join(dir, f));
  const read = (f) => (has(f) ? readFileSync(join(dir, f), 'utf8') : '');
  const hints = [];
  try {
    const t = JSON.parse(read('package.json') || '{}').scripts?.test;
    if (t) hints.push(`package.json test: ${t}`);
  } catch { hints.push('package.json (읽지 못함)'); }
  for (const f of ['gradlew', 'pom.xml']) if (has(f)) hints.push(f);
  if (has('pytest.ini') || has('conftest.py') || /\[tool\.pytest/.test(read('pyproject.toml'))) hints.push('pytest');
  return hints;
}

export function suggest(f) {
  const isNew = f.commits < 20 && f.sources < 50;
  const stop = [];
  if (!f.git) stop.push('git 저장소가 아니다 — 설치 전후를 비교할 수 없다');
  else if (f.notRoot) stop.push('저장소 루트가 아니다 — 루트에서 설치한다');
  if (f.dirty?.length) stop.push(`미커밋 변경 ${f.dirty.length}건 — 커밋하거나 치운 뒤 설치한다`);
  if (f.installed) stop.push('이미 설치됨 (.harness/ · rules/harness.md · skills/final-gate 중 하나가 있다) — 재설치인지 사용자에게 묻는다');
  if (f.nodeMajor < 22) stop.push(`Node ${f.nodeMajor} — 22 이상이 필요하다`);
  return {
    profile: isNew ? 'new' : 'existing',
    why: isNew ? `커밋 ${f.commits} < 20 · 소스 ${f.sources} < 50` : `커밋 ${f.commits}${f.commits >= 20 ? ' ≥ 20' : ''} · 소스 ${f.sources}${f.sources >= 50 ? ' ≥ 50' : ''}`,
    mode: 'local', // 공유는 사용자가 명시적으로 고른다 — 기록에 사번·실명·이슈 번호가 쌓여 그대로 커밋된다
    stop,
  };
}

export function detect(target) {
  const dir = resolve(target);
  const isGit = git(dir, 'rev-parse', '--is-inside-work-tree').out.trim() === 'true';
  const tracked = isGit ? lines(git(dir, 'ls-files').out) : [];
  const isTracked = (f) => tracked.includes(f);
  const instructions = {};
  for (const f of INSTRUCTIONS) {
    const exists = existsSync(join(dir, f));
    instructions[f] = { exists, tracked: isTracked(f) };
    if (f !== 'AGENTS.md') instructions[f].importsAgents = exists && /^\s*@(\.\/)?AGENTS\.md\b/m.test(readFileSync(join(dir, f), 'utf8'));
  }
  const facts = {
    target: dir,
    node: process.version,
    nodeMajor: Number(process.versions.node.split('.')[0]),
    git: isGit,
    notRoot: isGit && git(dir, 'rev-parse', '--show-prefix').out.trim() !== '',
    dirty: isGit ? lines(git(dir, 'status', '--porcelain').out) : [],
    commits: isGit ? Number(git(dir, 'rev-list', '--count', 'HEAD').out.trim() || 0) : 0,
    tracked: tracked.length,
    sources: tracked.filter((f) => SOURCE.test(f)).length,
    instructions,
    otherRules: OTHER_RULES.filter((f) => existsSync(join(dir, f))),
    tests: testHints(dir),
    ignored: Object.fromEntries(INSTALL_PROBES.map((p) => [p, isGit && git(dir, 'check-ignore', '-q', p).ok])),
    installed: INSTALLED.some((p) => existsSync(join(dir, p))),
    contextGraph: existsSync(join(dir, 'tools', 'graph', 'requests.jsonl')),
  };
  return { ...facts, suggest: suggest(facts) };
}

function print(f) {
  const yes = (b, y, n) => (b ? y : n);
  const inst = Object.entries(f.instructions).map(([k, v]) =>
    `${k} ${v.exists ? `있음(${v.tracked ? '추적' : '미추적'}${v.importsAgents ? ' · @AGENTS.md' : ''})` : '없음'}`).join(' · ');
  const out = [
    `대상            ${f.target}`,
    `git             ${f.git ? `저장소 · 커밋 ${f.commits} · 추적 파일 ${f.tracked} (소스 ${f.sources}) · 미커밋 ${f.dirty.length}` : '저장소 아님'}`,
    `지시 파일       ${inst}`,
    `다른 도구 규칙  ${f.otherRules.join(' · ') || '없음'}`,
    `테스트 단서     ${f.tests.join(' · ') || '없음'}`,
    `설치 경로       ${Object.entries(f.ignored).map(([p, i]) => `${p} ${yes(i, '무시됨', '추적 가능')}`).join(' · ')}`,
    `기존 설치       하네스 ${yes(f.installed, '있음', '없음')} · context-graph ${yes(f.contextGraph, '있음 (tools/graph/requests.jsonl) — 그래프 모듈은 설치하지 않는다', '없음')}`,
    `Node            ${f.node}`,
    `제안            프로필 ${f.suggest.profile} (${f.suggest.why}) · 모드 ${f.suggest.mode} (공유는 사용자가 고른다)`,
    ...f.suggest.stop.map((s) => `⛔ 멈춤         ${s}`),
  ];
  console.log(out.join('\n'));
}

cli(import.meta.url, () => {
  const args = process.argv.slice(2);
  const f = detect(args.find((a) => a !== '--json') ?? process.cwd());
  if (args.includes('--json')) console.log(JSON.stringify(f, null, 2));
  else print(f);
});

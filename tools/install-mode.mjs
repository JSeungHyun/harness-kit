#!/usr/bin/env node
// 설치 모드 — 공유(팀이 커밋)면 설치 경로를 추적 가능하게, 로컬 전용이면 숨긴다. 표식 블록을 한 번만 쓴다. 설계안.
//   node .harness/tools/install-mode.mjs share|local [대상]
// ⛔ 끝에 git check-ignore 로 모드대로인지 확인하고, 아니면 exit 1 — 쓴 규칙이 아니라 git 의 판정을 믿는다.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { cli } from '../lib/config.mjs';

const SHARE_TRACK = ['.harness/harness.json', '.claude/rules/harness.md', '.claude/rules/graph.md', '.claude/skills/final-gate/SKILL.md',
  '.claude/settings.json', 'docs/harness/decisions.md', 'AGENTS.md', 'CLAUDE.md'];
const LOCAL_HIDE = ['/.harness/', '/.claude/rules/harness.md', '/.claude/rules/graph.md', '/.claude/skills/final-gate/', '/.claude/settings.local.json', '/CLAUDE.local.md'];
const LOCAL_PROBES = ['.harness/harness.json', '.claude/rules/harness.md', '.claude/rules/graph.md', '.claude/skills/final-gate/SKILL.md', '.claude/settings.local.json', 'CLAUDE.local.md'];
const PERSONAL = '.claude/settings.local.json';
// 부정 규칙은 맨 위 경로에만 건다 — 부모 디렉터리가 무시되면 안쪽 파일은 되살릴 수 없다(git 규칙)
const NEGATE = { '.claude': '!.claude/', '.harness': '!.harness/', 'AGENTS.md': '!AGENTS.md', 'CLAUDE.md': '!CLAUDE.md' };
const BEGIN = '# harness-kit:begin';
const END = '# harness-kit:end';

export function applyMode(mode, target) {
  if (!['share', 'local'].includes(mode)) throw new Error(`모드는 share | local 이다: ${mode}`);
  const dir = resolve(target);
  const ignored = (p) => spawnSync('git', ['check-ignore', '-q', p], { cwd: dir }).status === 0;
  const gitPath = (p) => resolve(dir, execFileSync('git', ['rev-parse', '--git-path', p], { cwd: dir, encoding: 'utf8' }).trim());
  if (spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir }).status !== 0) throw new Error(`git 저장소가 아니다: ${dir}`);

  const file = mode === 'share' ? join(dir, '.gitignore') : gitPath('info/exclude');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  let wrote = false;
  if (!text.includes(BEGIN)) {
    const rules = mode === 'share'
      ? [...new Set(SHARE_TRACK.filter(ignored).map((p) => NEGATE[p.split('/')[0]]).filter(Boolean)), PERSONAL]
      : LOCAL_HIDE;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const block = [`${BEGIN} (install-mode ${mode})`, ...rules, END].join(eol);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${text}${text && !text.endsWith('\n') ? eol : ''}${block}${eol}`);
    wrote = true;
  }
  const expect = mode === 'share'
    ? [...SHARE_TRACK.map((p) => [p, false]), [PERSONAL, true]]
    : LOCAL_PROBES.map((p) => [p, true]);
  const rows = expect.map(([p, want]) => ({ p, want, ok: ignored(p) === want }));
  const gitDir = resolve(dir, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: dir, encoding: 'utf8' }).trim());
  return { file, wrote, rows, ok: rows.every((r) => r.ok), hook: mode === 'share' ? preCommit(gitPath('hooks/pre-commit'), gitDir) : null };
}

// 공유 모드는 커밋 전마다 민감 정보를 검사한다. ⛔ 이미 있는 훅은 덮지 않는다 — 그 훅의 주인이 한 줄을 더한다
const HOOK_LINE = 'node .harness/tools/scan-shared.mjs || exit 1';
function preCommit(path, gitDir) {
  // ⛔ core.hooksPath 가 git 디렉터리 밖(전역 훅 폴더 · 추적되는 .husky 등)이면 쓰지 않는다 — 다른 레포의 커밋까지 막거나 남의 스크립트를 돌린다
  const rel = relative(gitDir, path);
  if (rel.startsWith('..') || isAbsolute(rel)) return { path, state: 'outside' };
  if (existsSync(path)) return { path, state: readFileSync(path, 'utf8').includes('scan-shared.mjs') ? 'present' : 'foreign' };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n# harness-kit — 공유되는 기록·장부·규칙에 민감 정보 패턴이 있으면 커밋을 막는다\n${HOOK_LINE}\n`, { mode: 0o755 });
  return { path, state: 'wrote' };
}

cli(import.meta.url, () => {
  const [mode, target = process.cwd()] = process.argv.slice(2);
  const r = applyMode(mode, target);
  console.log(`${r.wrote ? '반영' : '이미 있음 (표식 블록) — 그대로 둔다'}: ${r.file}`);
  for (const { p, want, ok } of r.rows) console.log(`${ok ? '✅' : '⛔'} ${want ? '무시됨' : '추적 가능'} 이어야 한다 — ${p}`);
  if (r.hook?.state === 'outside') console.log(`⚠️ core.hooksPath 가 저장소 git 디렉터리 밖(${r.hook.path})을 가리켜 쓰지 않았다 — 그 훅의 주인이 이 한 줄을 더한다: ${HOOK_LINE}`);
  else if (r.hook?.state === 'foreign') console.log(`⚠️ 이미 있는 pre-commit 을 덮지 않았다 — ${r.hook.path} 에 이 한 줄을 더한다: ${HOOK_LINE}`);
  else if (r.hook) console.log(`✅ pre-commit 이 scan-shared 를 부른다 — ${r.hook.path}`);
  if (!r.ok) {
    console.log('⛔ 모드대로 되지 않았다 — 위 ⛔ 경로를 어느 규칙이 잡는지 git check-ignore -v <경로> 로 보고 사용자에게 알린다');
    process.exit(1);
  }
});

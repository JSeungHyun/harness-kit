#!/usr/bin/env node
// 갱신 — 이미 설치된 대상에 키트의 지금 도구 · 정책 · 규칙을 얹는다. 설계안.
//   node <kit>/tools/upgrade.mjs <대상>
// 도구 · lib · 정책은 키트 것이라 덮어쓴다. 규칙 · 스킬은 설치본이 키트 이력의 한 버전과 같을 때만 바꾼다 — 다르면 프로젝트가 고친 것이다.
// ⛔ 설정은 쓰지 않는다 — 권한 설정은 사용자 확인 자리라 실행할 명령만 낸다.
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, cli, CONFIG } from '../lib/config.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
const DOCS = [
  ['templates/rules/harness.md', '.claude/rules/harness.md'],
  ['templates/rules/graph.md', '.claude/rules/graph.md'],
  ['templates/skills/final-gate/SKILL.md', '.claude/skills/final-gate/SKILL.md'],
];
const nl = (s) => s.replace(/\r\n/g, '\n');
const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});

// 키트가 git 저장소가 아니면(압축본) 이력이 없다 — 그러면 다른 규칙은 전부 「고쳤다」로 알린다
function history(src) {
  try {
    const git = (...a) => execFileSync('git', ['-C', KIT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return git('rev-list', 'HEAD', '--', src).split('\n').filter(Boolean).map((c) => git('show', `${c}:${src}`));
  } catch {
    return [];
  }
}

export function upgrade(dir) {
  // 대상의 .harness/tools 사본에는 templates 가 없다 — 그 사본은 자기 위치를 키트로 안다
  if (!existsSync(join(KIT, 'templates'))) throw new Error('키트 저장소의 upgrade 를 돌린다 — node <kit>/tools/upgrade.mjs <대상>');
  loadConfig(dir);
  const raw = JSON.parse(readFileSync(join(dir, CONFIG), 'utf8'));
  // 그래프가 이미 있는 대상(기존 context-graph)은 graph 에 그 도구 폴더와 기록 규칙 위치를 적는다 — 없으면 키트 그래프
  const graph = { tools: '.harness/tools', rules: '`.claude/rules/graph.md`', ...raw.graph };
  const fill = (s) => nl(s).replaceAll('<decisions>', raw.state?.decisions ?? '<decisions>').replaceAll('<lessons>', raw.state?.lessons ?? '<lessons>')
    .replaceAll('<graph-tools>', graph.tools).replaceAll('<graph-rules>', graph.rules);
  const out = [];

  // 그래프 도구 두 벌은 기록을 두 저장소로 가른다 — 대상의 그래프가 따로 있으면 키트 것을 넣지 않는다
  const own = graph.tools !== '.harness/tools';
  const filter = (f) => !(own && /graph-[\w-]+\.(mjs|json)$/.test(f));
  for (const d of ['lib', 'tools', 'policy']) cpSync(join(KIT, d), join(dir, '.harness', d), { recursive: true, filter });
  out.push('✅ .harness/{lib,tools,policy} — 키트의 지금 것으로');

  for (const [src, dst] of DOCS) {
    const at = join(dir, dst);
    if (!existsSync(at)) { out.push(`· ${dst} — 없다(얹지 않은 모듈) · 그대로`); continue; }
    const now = nl(readFileSync(at, 'utf8'));
    const next = fill(readFileSync(join(KIT, src), 'utf8'));
    if (now === next) out.push(`· ${dst} — 이미 지금 것`);
    else if (history(src).some((v) => fill(v) === now)) { writeFileSync(at, next); out.push(`✅ ${dst} — 갱신`); }
    else out.push(`⚠️ ${dst} — 키트 이력의 어느 버전과도 다르다(프로젝트가 고쳤다) · 손대지 않았다. 병합할 지금 것: ${join(KIT, src)}`);
  }

  // 정책이 켜는 이름(superpowers · ponytail)을 옛 마켓 id 로 켜 둔 것 — 남기면 같은 플러그인이 두 번 뜬다
  const ids = Object.keys(read(join(KIT, 'policy', 'settings.json')).enabledPlugins ?? {});
  const names = new Set(ids.map((id) => id.split('@')[0]));
  const stale = ['settings.local.json', 'settings.json'].flatMap((f) =>
    Object.entries(read(join(dir, '.claude', f)).enabledPlugins ?? {})
      .filter(([id, on]) => on && names.has(id.split('@')[0]) && !ids.includes(id)).map(([id]) => ` --off ${id}`));

  out.push('', '다음 — 이 순서로 (설정이라 사용자가 돌리거나 승인한다):',
    `1. node ${KIT.replace(/\\/g, '/').replace(/\/$/, '')}/tools/plugin-plan.mjs — 이전 명령이 나오면 사용자 승인 뒤 먼저 실행한다`,
    `2. node .harness/tools/policy-apply.mjs${raw.mode === 'share' ? '' : ' --local'} --with gate-hook${[...new Set(stale)].join('')}`,
    '3. node .harness/tools/verify.mjs');
  return out.join('\n');
}

cli(import.meta.url, () => console.log(upgrade(process.argv[2] ?? process.cwd())));

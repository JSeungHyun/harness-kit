#!/usr/bin/env node
// 갱신 — 이미 설치된 대상에 키트의 지금 도구 · 정책 · 규칙을 얹는다. 설계안.
//   node <kit>/tools/upgrade.mjs <대상>
// 도구 · lib · 정책은 키트 것이라 덮어쓴다. 규칙 · 스킬은 설치본이 키트 이력의 한 버전과 같을 때만 바꾼다 — 다르면 프로젝트가 고친 것이다.
// ⛔ 설정은 쓰지 않는다 — 권한 설정은 사용자 확인 자리라 실행할 명령만 낸다.
import { cpSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, cli, CONFIG } from '../lib/config.mjs';
import { load, sup } from './graph-find.mjs';
import { testHints } from './detect.mjs';

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
  const git = (...a) => execFileSync('git', ['-C', KIT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let commits;
  try { commits = git('rev-list', 'HEAD', '--', src).split('\n').filter(Boolean); } catch { return []; }
  // 지운 템플릿은 지운 커밋에 없다
  return commits.flatMap((c) => { try { return [git('show', `${c}:${src}`)]; } catch { return []; } });
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

  // 키트에서 지운 것 — 복사는 덮어쓰기만 해서 설치본에 남고, 남은 도구를 가리키는 규칙 · allow 가 거짓이 된다
  const removed = read(join(KIT, 'policy', 'removed.json'));
  const dropped = removed.files.filter((f) => existsSync(join(dir, f)));
  for (const f of dropped) rmSync(join(dir, f));
  for (const [src, key] of Object.entries(removed.templates)) {
    const at = raw.state?.[key];
    if (!at || !existsSync(join(dir, at))) continue;
    // 손대지 않은 템플릿만 걷는다 — 쓴 대장은 프로젝트의 기록이다
    if (history(src).some((v) => nl(v) === nl(readFileSync(join(dir, at), 'utf8')))) { rmSync(join(dir, at)); dropped.push(at); }
    else out.push(`⚠️ ${at} — 키트에서 지운 ${src} 의 설치본인데 내용을 썼다 · 남겼다. harness.json 의 state.${key} 는 이제 아무 도구도 읽지 않는다`);
  }
  if (dropped.length) out.push(`🧹 걷음(키트에서 지운 것): ${dropped.join(', ')}`);
  // 지운 경로를 살아있는 기록이 가리키면 --check 빨강 → verify 빨강 → 모든 코드 턴이 관문에 막힌다 — 같은 턴에 고치게 목록을 낸다
  const gonePaths = new Set([...removed.files, ...dropped]);
  const recs = load(own ? join(dir, graph.tools, 'graph', 'requests.jsonl') : join(dir, '.harness', 'graph', 'requests.jsonl'));
  const dead = new Set(recs.flatMap(sup));
  const pointing = recs.filter((r) => !dead.has(r.req))
    .flatMap((r) => (r.files ?? []).filter((f) => gonePaths.has(f.replace(/\\/g, '/').replace(/^\.\//, ''))).map((f) => `   ${f} ← ${r.req.slice(0, 50)}`));
  if (pointing.length) out.push('⚠️ 그래프 기록이 지운 경로를 가리킨다 — 같은 턴에 그 경로를 뺀 기록으로 supersedes 한다(그대로면 graph-find --check 빨강):', ...pointing);

  // 옛 정책이 쓴 플러그인 선언 · ponytail 모드(옛 마켓 id 포함)는 policy-apply 가 걷는다 — 여기서는 --off 를 내지 않는다
  const sets = ['settings.local.json', 'settings.json'].map((f) => read(join(dir, '.claude', f)));
  // 키트 그래프 훅을 건 설치 — 다시 병합해야 훅 형식이 바뀐다(그 프로젝트 자신의 그래프 훅은 경로가 달라 빠진다)
  const graphHook = sets.some((s) => JSON.stringify(s.hooks ?? {}).includes('.harness/tools/graph-hook.mjs')) ? ' --with graph-hook' : '';
  // 관문 훅만 건 설치(--only gate-hook — 지시 파일이 흐름 · 권한을 정한 프로젝트)에 --with 를 내면 받지 않은 정책이 들어간다
  // 정책 전체를 받은 설치는 키트 도구 허용 규칙이 있다 — 플러그인 선언은 표식이 아니다(--only 대상이 ponytail 을 스스로 켤 수 있다)
  const kitAllow = (read(join(KIT, 'policy', 'settings.json')).permissions?.allow ?? []).filter((r) => r.includes('.harness/tools/'));
  const full = sets.some((s) => (s.permissions?.allow ?? []).some((r) => kitAllow.includes(r)));
  const only = sets.some((s) => JSON.stringify(s.hooks ?? {}).includes('gate-hook.mjs')) && !full;

  out.push('', '다음 — 이 순서로 (설정이라 사용자가 돌리거나 승인한다):',
    `1. node ${KIT.replace(/\\/g, '/').replace(/\/$/, '')}/tools/plugin-plan.mjs — 이전 명령이 나오면 사용자 승인 뒤 먼저 실행한다`,
    `2. node .harness/tools/policy-apply.mjs${raw.mode === 'share' ? '' : ' --local'} ${only ? '--only gate-hook' : `--with gate-hook${graphHook}`}`,
    '3. node .harness/tools/verify.mjs');

  // 갱신이 검사 목록을 다시 본다 — 빌드 도구가 있는데 코드를 덮는 검사가 없으면 verify 녹색은 코드 변경의 증거가 아니다
  const hints = testHints(dir);
  const stop = hints.length > 0 && !(raw.checks ?? []).some((c) => c.covers?.length);
  if (stop) {
    out.push('', `⛔ 빌드 · 테스트 단서(${hints.join(' · ')})가 보이는데 covers 를 가진 검사가 없다 — 관문 훅이 코드 변경마다 /code-review 를 요구하고 verify 는 「코드 검사 없음」을 낸다. `
      + '그 코드를 돌리는 검사를 harness.json 에 더하고 covers 에 그 코드의 glob 을 적은 뒤(SETUP ⑤) 갱신을 다시 돌린다. 이 PC 에서 테스트를 못 돌리면 사용자에게 알리고 보고에 「코드 검사 없음 — 코드 변경은 /code-review」를 남긴다');
  }
  return { text: out.join('\n'), stop };
}

cli(import.meta.url, () => {
  const r = upgrade(process.argv[2] ?? process.cwd());
  console.log(r.text);
  if (r.stop) process.exit(1);
});

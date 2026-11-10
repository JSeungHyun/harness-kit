#!/usr/bin/env node
// 이식 동일성 — 설치본이 키트와 같은지 ①~⑨ 체크리스트로 판정한다. 설계안.
//   node <kit>/tools/install-check.mjs <대상> [--json]
//   node <kit>/tools/install-check.mjs --all <폴더>   # 그 아래 설치마다 ⑨ 판 · ① 동일만 — 키트를 고친 뒤 이 PC 설치가 모두 같은 판인가
// 다를 수 있는 것(그래프 데이터와 그 위치 · 장부 본문 · 기준선 · 검사 명령과 covers 값 · 지시 파일 본문 · 프로젝트가 더한 도구)은 보지 않는다.
// ⛔ 하나라도 ⛔ 면 exit 1 — 「이식 성공」은 이 도구의 판정 줄로만 쓴다(설치 세션의 글이 아니라).
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { join, basename, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { cli, loadConfig, CONFIG } from '../lib/config.mjs';
import { KIT, DOCS, nl, assertKit, kitCommit, graphOf, ownGraph, filler, docState, summary, settingsShape, coversGap, ledgerLeft, graphRefs } from './upgrade.mjs';
import { applyPolicy, settingsPath, readJson } from './policy-apply.mjs';
import { pcPlan, pluginList } from './plugin-plan.mjs';

const slash = (p) => p.replace(/\\/g, '/');
const list = (a) => `${a.slice(0, 4).map(slash).join(', ')}${a.length > 4 ? ` 외 ${a.length - 4}` : ''}`;
const keys = (a, b) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];
// 바뀔 곳 — 권한 · 훅은 한 단계 내려가 이름을 댄다
const differ = (a, b) => keys(a, b).filter((k) => !isDeepStrictEqual(a?.[k], b?.[k]))
  .flatMap((k) => (['permissions', 'hooks'].includes(k) ? keys(a?.[k], b?.[k]).filter((j) => !isDeepStrictEqual(a?.[k]?.[j], b?.[k]?.[j])).map((j) => `${k}.${j}`) : [k]));
const node = (cwd, script, args = [], input = '') => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', input, maxBuffer: 1 << 26 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

// 관문 훅이 실제로 막고 통과시키는가 — 코드만 바꾼 턴은 되돌리고, 증거 세트를 다 갖춘 턴은 통과
function gateProbe(dir) {
  const tmp = mkdtempSync(join(tmpdir(), 'install-check-'));
  try {
    const use = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: name, name, input }] } });
    const skill = (s) => use('Skill', { skill: s });
    const blocks = (lines, n) => {
      const t = join(tmp, `${n}.jsonl`);
      writeFileSync(t, [{ type: 'user', origin: { kind: 'human' }, message: { content: '고쳐줘' } }, ...lines].map((l) => JSON.stringify(l)).join('\n'));
      const r = node(dir, join(dir, '.harness', 'tools', 'gate-hook.mjs'), [], JSON.stringify({ transcript_path: t, stop_hook_active: false, background_tasks: [] }));
      return /"decision":"block"/.test(r.out);
    };
    const edit = use('Edit', { file_path: 'src/install-check-probe.mjs' });
    const done = [edit, skill('ponytail-review'), skill('code-review'), use('Bash', { command: 'node .harness/tools/verify.mjs' }), skill('final-gate')];
    return { blocks: blocks([edit], 1), passes: !blocks(done, 2) };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ① 키트 도구 · lib · 정책 — 갱신이 복사하는 것 그대로(그래프 도구 포함 — 예외 없음) · 프로젝트가 더한 도구는 보지 않는다
function sameFiles(dir, raw) {
  const files = ['lib', 'tools', 'policy'].flatMap((d) => readdirSync(join(KIT, d), { recursive: true }).map((f) => join(d, f)))
    .filter((f) => statSync(join(KIT, f)).isFile());
  const at = (f) => join(dir, '.harness', f);
  const missing = files.filter((f) => !existsSync(at(f)));
  const changed = files.filter((f) => existsSync(at(f)) && nl(readFileSync(at(f), 'utf8')) !== nl(readFileSync(join(KIT, f), 'utf8')));
  const left = JSON.parse(readFileSync(join(KIT, 'policy', 'removed.json'), 'utf8')).files.filter((f) => existsSync(join(dir, f)));
  const { where: lines } = ledgerLeft(dir, raw);
  return {
    observed: [missing.length && `없음 ${list(missing)}`, changed.length && `다름 ${list(changed)}`, left.length && `지운 것 남음 ${list(left)}`, lines.length && `지운 장부 줄 남음 ${list(lines)} — upgrade 가 걷는다`].filter(Boolean).join(' · ') || `${files.length}개 같음`,
    ok: !missing.length && !changed.length && !left.length && !lines.length,
  };
}

// ⑨ 판 — 갱신이 기록한 키트 커밋
function sameCommit(dir) {
  const kit = kitCommit();
  const mine = existsSync(join(dir, '.harness', 'kit-commit')) ? readFileSync(join(dir, '.harness', 'kit-commit'), 'utf8').trim() : '';
  return { observed: `설치본 ${mine.slice(0, 7) || '기록 없음'} · 키트 ${kit?.slice(0, 7) ?? '모름(git 저장소가 아니다)'}`, ok: Boolean(kit) && mine === kit };
}

// 이 PC 설치 현황 — 폴더 아래 설치마다 ⑨ · ① 만(verify · 훅 합성 없이). 키트 개선의 끝은 커밋이 아니라 이 표가 모두 ✅ 인 때다
export function checkAll(root) {
  assertKit('install-check');
  return readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(root, e.name))
    // 키트 저장소(이 레포 · 다른 클론)는 자기 verify 용 harness.json 만 있다 — 설치가 아니다
    .filter((d) => existsSync(join(d, CONFIG)) && !existsSync(join(d, 'templates', 'rules', 'harness.md')))
    .map((d) => ({ name: basename(d), ver: sameCommit(d), files: sameFiles(d, readJson(join(d, CONFIG))) }));
}

export function checkInstall(dir, { plugins } = {}) {
  assertKit('install-check');
  if (!existsSync(join(dir, CONFIG))) throw new Error(`${CONFIG} 이 없다 — 키트를 얹지 않은 대상이다 (SETUP.md)`);
  const raw = readJson(join(dir, CONFIG));
  const rows = [];
  const row = (n, what, observed, ok) => rows.push({ n, what, observed: String(observed), ok: Boolean(ok) });
  const own = ownGraph(raw);
  const graph = graphOf(raw);

  const same = sameFiles(dir, raw);
  row('①', '키트 도구 · lib · 정책(그래프 도구 포함)이 키트 판과 같다 · 키트에서 지운 것 0 (장부의 지운 템플릿 줄 포함)', same.observed, same.ok);

  // ② ③ 키트 소유 문서 — 장부 경로 · 그래프 자리를 채운 키트 판과 같아야 한다. 프로젝트 규칙은 .claude/rules/ 의 별도 파일에
  const fill = filler(raw);
  const docs = (n, what, picked) => {
    const notes = picked.map(([src, dst]) => {
      const name = basename(dst);
      if (!existsSync(join(dir, dst))) return [false, `${name} 없음`];
      const now = nl(readFileSync(join(dir, dst), 'utf8'));
      const d = docState(src, now, fill);
      if (d.state === 'same') return [true, `${name} 같음`];
      if (d.state === 'old') return [false, `${name} 옛 키트 판 — upgrade 로 갱신한다`];
      return [false, `${name} 프로젝트가 고쳤다 ${summary(d.diff, now)} — upgrade --own-rules 로 그 줄을 프로젝트 규칙 파일로 옮긴다`];
    });
    row(n, what, notes.map(([, s]) => s).join(' · '), notes.every(([ok]) => ok));
  };
  // 기록 규칙 자리를 지시 파일 · 스킬로 정한 설치(graph.rules)는 graph.md 를 얹지 않는다
  const rulesElsewhere = graph.rules !== graphOf({}).rules;
  docs('②', `규칙 ${rulesElsewhere ? 'harness.md' : 'harness.md · graph.md'} 가 키트 판(자리 채움)과 같다`, DOCS.filter(([src]) => src.startsWith('templates/rules/') && !(rulesElsewhere && src.endsWith('graph.md'))));
  docs('③', '스킬 final-gate 가 키트 판(자리 채움)과 같다', DOCS.filter(([src]) => src.includes('/skills/')));

  // ④ 정책 — policy-apply 를 그 설치 모양대로 다시 돌려도 바뀌는 것이 없어야 한다(빠진 권한 · 옛 훅 형식 · 걷을 옛 항목)
  const local = raw.mode !== 'share';
  const file = settingsPath(dir, local);
  const now = readJson(file);
  const { graphHook, only } = settingsShape(dir);
  const { settings: want } = applyPolicy(now, { local, only, extra: ['gate-hook', ...(graphHook ? ['graph-hook'] : [])] });
  const diff = differ(now, want);
  row('④', '정책 — policy-apply 를 다시 돌려도 바뀌는 것 없음 (권한 · 관문 훅 exec 형식 · 켠 설치만 그래프 훅)',
    diff.length ? `${slash(relative(dir, file))} 에서 바뀔 곳: ${diff.join(', ')} — upgrade 가 낸 policy-apply 줄을 돌린다`
      : `${slash(relative(dir, file))} 그대로${only ? ' · 관문 훅만(--only gate-hook)' : ''}${graphHook ? ' · 그래프 훅 켬' : ''}`,
    !diff.length);

  // ⑤ harness.json — 값은 프로젝트 것이고 형식 · 있어야 할 것만 본다
  const probs = [];
  try { loadConfig(dir); } catch (e) { probs.push(e.message.split('\n')[0]); }
  if (!['new', 'existing'].includes(raw.profile)) probs.push(`profile ${raw.profile}`);
  if (!['local', 'share'].includes(raw.mode)) probs.push(`mode ${raw.mode}`);
  for (const k of ['decisions', 'lessons']) if (!raw.state?.[k] || !existsSync(join(dir, raw.state[k]))) probs.push(`장부 ${k} 없음 (${raw.state?.[k] ?? '경로 없음'})`);
  // 그래프 — 도구는 .harness/tools 한 벌. 옛 자기 그래프는 이관 미완, 옛 도구를 가리키는 줄이 남으면 모델이 그것을 불러 판이 갈라진다
  if (own) probs.push(`옛 자기 그래프(graph.tools ${graph.tools}) — 이관 미완: node <kit>/tools/upgrade.mjs <대상> --migrate-graph`);
  if (raw.graph?.store && !existsSync(join(dir, raw.graph.store))) probs.push(`graph.store 없음 (${raw.graph.store})`);
  const refs = graphRefs(dir);
  if (refs.length) probs.push(`키트 밖 그래프 도구를 가리키는 곳 ${list(refs)} — .harness/tools/graph-*.mjs 로 고친다`);
  const gap = coversGap(dir, raw);
  if (gap.length) probs.push(`빌드 · 테스트 단서(${gap.join(' · ')})가 있는데 covers 를 가진 검사가 없다 (SETUP ⑤)`);
  row('⑤', 'harness.json — 형식 · 프로필 · 모드 · 장부 · 그래프(이관 · 기록 위치 · 키트 밖 도구 참조) · 단서가 있으면 covers 검사',
    probs.join(' · ') || `검사 ${raw.checks?.length ?? 0} (covers ${(raw.checks ?? []).filter((c) => c.covers?.length).length}) · ${raw.profile} · ${raw.mode}`, !probs.length);

  // ⑥ PC — 대상 밖이다. plugin-plan 의 판정을 그대로 쓴다
  let pc = plugins;
  if (pc === undefined) try { pc = pluginList(); } catch { pc = null; }
  if (pc === null) row('⑥', 'PC — plugin-plan 이 낼 명령 없음', '플러그인 목록을 읽지 못함 (claude plugin list --json)', false);
  else {
    const { cmds } = pcPlan(pc);
    row('⑥', 'PC — plugin-plan 이 낼 명령 없음 (superpowers 고정 판 · ponytail-review 가 고정 커밋에서 받은 그대로)',
      cmds.length ? `낼 명령 ${cmds.length}: ${cmds.join(' ; ')}` : '옮길 것 없다', !cmds.length);
  }

  // ⑦ 지시 파일 — 본문은 프로젝트 것, import 만 본다. 공유는 커밋되는 파일이 import 해야 팀원 세션도 읽는다
  const claudeFiles = ['CLAUDE.md', '.claude/CLAUDE.md', ...(local ? ['CLAUDE.local.md'] : [])];
  const text = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);
  const importer = claudeFiles.find((f) => /^\s*@(\.\/)?AGENTS\.md\b/m.test(text(f) ?? ''));
  const present = claudeFiles.filter((f) => text(f) !== null);
  const agents = text('AGENTS.md') !== null;
  row('⑦', `지시 파일 — ${claudeFiles.join(' · ')} 중 하나가 있고, AGENTS.md 가 있으면 그것을 import 한다`,
    agents ? (importer ? `${importer} → @AGENTS.md` : `AGENTS.md 를 import 하는 ${claudeFiles.join(' · ')} 없음`) : (present.join(' · ') || '없음'),
    agents ? importer : present.length);

  // ⑧ 동작 — 도구가 그 대상에서 실제로 돈다
  const v = node(dir, join(dir, '.harness', 'tools', 'verify.mjs'), [dir]);
  const firstTest = raw.profile === 'new' && v.code === 1 && /실행된 테스트가 0개/.test(v.out);
  const why = v.out.split(/\r?\n/).find((l) => l.startsWith('⛔')) ?? v.out.trim().split(/\r?\n/).at(-1) ?? '';
  const g = node(dir, join(dir, '.harness', 'tools', 'graph-find.mjs'), ['--check']);
  const gate = gateProbe(dir);
  row('⑧', '동작 — verify exit 0 · graph-find --check exit 0 · 관문 훅이 코드만 바꾼 턴을 되돌리고 다 갖춘 턴은 통과',
    [`verify exit ${v.code}${firstTest ? ' (첫 테스트 전 — 신규는 정상)' : v.code ? ` — ${why.slice(0, 80)}` : ''}`,
      `graph-find --check exit ${g.code}`,
      gate.blocks && gate.passes ? '관문 훅 되돌림 · 통과' : `관문 훅이 ${gate.blocks ? '다 갖춘 턴을 막는다' : '코드만 바꾼 턴을 되돌리지 않는다'}`].join(' · '),
    (v.code === 0 || firstTest) && g.code === 0 && gate.blocks && gate.passes);

  const ver = sameCommit(dir);
  row('⑨', '판 — 설치본이 기록한 키트 커밋(.harness/kit-commit) = 키트의 지금 커밋', ver.observed, ver.ok);
  return rows;
}

cli(import.meta.url, () => {
  const args = process.argv.slice(2);
  if (args.includes('--all')) {
    const all = checkAll(args[args.indexOf('--all') + 1] ?? process.cwd());
    const cell = (s) => s.replace(/\|/g, '\\|');
    console.log('| 설치 | ⑨ 판 | ① 도구 · lib · 정책 | 맞나 |\n|---|---|---|---|');
    for (const a of all) console.log(`| ${a.name} | ${cell(a.ver.observed)} | ${cell(a.files.observed)} | ${a.ver.ok && a.files.ok ? '✅' : '⛔'} |`);
    const bad = all.filter((a) => !a.ver.ok || !a.files.ok).map((a) => a.name);
    console.log(!all.length ? '\n⛔ 설치가 없다 — 폴더를 확인한다' : bad.length ? `\n⛔ 뒤처지거나 다른 설치 ${bad.length}곳 (${bad.join(' · ')}) — 그 세션에 「갱신」을 맡긴다`
      : `\n✅ 설치 ${all.length}곳 모두 키트 판 (${kitCommit()?.slice(0, 7)})`);
    process.exit(all.length && !bad.length ? 0 : 1);
  }
  const rows = checkInstall(args.find((a) => !a.startsWith('--')) ?? process.cwd());
  if (args.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log('| | 기대 | 관측 | 맞나 |\n|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.n} | ${r.what} | ${r.observed.replace(/\|/g, '\\|')} | ${r.ok ? '✅' : '⛔'} |`);
    const bad = rows.filter((r) => !r.ok).map((r) => r.n);
    console.log(bad.length ? `\n⛔ 이식 실패 — ⛔ ${bad.length}개 (${bad.join(' ')}) · 「이식 성공」이라고 쓰지 않는다` : `\n✅ 이식 성공 — ${rows.length}/${rows.length}`);
  }
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
});

#!/usr/bin/env node
// 이식 동일성 — 설치본이 키트와 같은지 ①~⑨ 체크리스트로 판정한다. 설계안.
//   node <kit>/tools/install-check.mjs <대상> [--json]
//   node <kit>/tools/install-check.mjs --all <폴더>   # 그 아래 설치마다 ⑨ 판 · ① 동일 · 설치 글의 그래프 쓰는 법(⑤ 일부) — 키트를 고친 뒤 이 PC 설치가 모두 같은 판인가
// 키트 소유 · 프로젝트 설정 · 프로젝트 데이터의 자리는 lib/parts.mjs 한 곳 — 설정 · 데이터는 판정 줄 아래 「프로젝트 맞춤」에 보이고 판정하지 않는다.
// ⛔ 하나라도 ⛔ 면 exit 1 — 「이식 성공」은 이 도구의 판정 줄로만 쓴다(설치 세션의 글이 아니라).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { join, basename, relative } from 'node:path';
import { cli, loadConfig, CONFIG } from '../lib/config.mjs';
import { KIT, DOCS, SHIPPED, PARTS, kitFiles, graphOf } from '../lib/parts.mjs';
import { nl, list, assertKit, kitCommit, kitDirty, shippedSame, ownGraph, filler, docState, summary, settingsShape, areaGaps, areaGapText, recipeGap, grownTests, graphRefs, graphRules, removedDocs, removedRefs } from './upgrade.mjs';
import { applyPolicy, dropGone, settingsPath, readJson } from './policy-apply.mjs';
import { pcPlan, pluginList, cycleReady, claudeVersion } from './plugin-plan.mjs';
import { isUnion } from './install-mode.mjs';

const slash = (p) => p.replace(/\\/g, '/');
const keys = (a, b) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];
// 바뀔 곳 — 권한 · 훅은 한 단계 내려가 이름을 댄다
const differ = (a, b) => keys(a, b).filter((k) => !isDeepStrictEqual(a?.[k], b?.[k]))
  .flatMap((k) => (['permissions', 'hooks'].includes(k) ? keys(a?.[k], b?.[k]).filter((j) => !isDeepStrictEqual(a?.[k]?.[j], b?.[k]?.[j])).map((j) => `${k}.${j}`) : [k]));
const node = (cwd, script, args = []) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

// ① 키트 도구 · lib · 정책 — 갱신이 복사하는 것 그대로(그래프 도구 포함 — 예외 없음) · 프로젝트가 더한 도구는 보지 않는다
function sameFiles(dir, fill) {
  const files = kitFiles();
  const at = (f) => join(dir, '.harness', f);
  const missing = files.filter((f) => !existsSync(at(f)));
  const changed = files.filter((f) => existsSync(at(f)) && nl(readFileSync(at(f), 'utf8')) !== nl(readFileSync(join(KIT, f), 'utf8')));
  const left = JSON.parse(readFileSync(join(KIT, 'policy', 'removed.json'), 'utf8')).files.filter((f) => existsSync(join(dir, f)));
  left.push(...removedDocs(dir, fill).gone);
  return {
    observed: [missing.length && `없음 ${list(missing)}`, changed.length && `다름 ${list(changed)}`, left.length && `지운 것 남음 ${list(left)}`].filter(Boolean).join(' · ') || `${files.length}개 같음`,
    ok: !missing.length && !changed.length && !left.length,
  };
}

// ⑨ 판 — 갱신이 기록한 키트 커밋. 그 뒤 키트가 문서만 바꿨으면 설치본에 갈 것이 없어 같은 판이다
function sameCommit(dir) {
  const kit = kitCommit();
  const mine = existsSync(join(dir, '.harness', 'kit-commit')) ? readFileSync(join(dir, '.harness', 'kit-commit'), 'utf8').trim() : '';
  const at = mine.endsWith('-dirty') ? `${mine.slice(0, 7)}-dirty(커밋 안 된 키트로 갱신됨 — 커밋 뒤 다시 갱신)` : mine.slice(0, 7) || '기록 없음';
  const ok = shippedSame(mine);
  return { observed: `설치본 ${at} · 키트 ${kit?.slice(0, 7) ?? '모름(git 저장소가 아니다)'}${ok && mine !== kit ? ' (그 뒤 문서만 바뀜)' : ''}`, ok };
}

// 키트가 더러우면 ① 은 작업 트리와 · ⑨ 는 HEAD 와 비교해 멀쩡한 설치가 ⛔, 미커밋 판을 받은 설치가 ✅ 로 보인다 — 표는 내되 판정 줄은 내지 않는다
function dirtyKit() {
  const d = process.env.HARNESS_KIT_DIRTY_OK ? [] : kitDirty();
  return d.length ? `⛔ 키트 작업 트리에 커밋 안 된 변경 — 판정은 커밋 뒤에 (${list(d)}) · 아래 표는 참고만` : '';
}

// 이 PC 설치 현황 — 폴더 아래 설치마다 ⑨ · ① 만(verify · 훅 합성 없이). 키트 개선의 끝은 커밋이 아니라 이 표가 모두 ✅ 인 때다
// installs.skip — 키트 저장소 로컬 설정에만 두는 키(설치 대상 harness.json 엔 없다): 사용자가 갱신하지 않기로 한 설치 폴더 이름
export function checkAll(root, config = join(KIT, CONFIG)) {
  assertKit('install-check');
  const skip = readJson(config).installs?.skip ?? [];
  const names = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    // 키트 저장소(이 레포 · 다른 클론)는 자기 verify 용 harness.json 만 있다 — 설치가 아니다
    .filter((n) => existsSync(join(root, n, CONFIG)) && !existsSync(join(root, n, 'templates', 'rules', 'harness.md')));
  const all = names.filter((n) => !skip.includes(n)).map((n) => ({ name: n, ver: sameCommit(join(root, n)), files: sameFiles(join(root, n), filler(readJson(join(root, n, CONFIG)))), rules: graphRules(join(root, n)), gone: removedRefs(join(root, n)) }));
  const cell = (s) => s.replace(/\|/g, '\\|');
  const same = (a) => a.ver.ok && a.files.ok && !a.rules.length && !a.gone.length;
  const bad = all.filter((a) => !same(a)).map((a) => a.name);
  const gone = skip.filter((n) => !names.includes(n));
  const dirty = dirtyKit();
  // 사이클 — /exec-cycle · /exec-review 를 바로 쓸 수 있나는 PC 상태라 설치마다 같은 칸이다. ⛔ 면 설치가 키트 판이어도 끝이 아니다
  let cycle = { problems: [], warns: [], notes: [] };
  try { cycle = cycleReady(undefined, claudeVersion()); } catch (e) { cycle.problems.push(e.message.split('\n')[0]); }
  const tags = [cycle.warns.length && 'superpowers 켜짐(자동 주입)', cycle.notes.some((n) => /훅을 더했다/.test(n)) && 'superpowers 훅 늘어남', cycle.notes.some((n) => /^Claude Code /.test(n)) && 'Claude Code 판 낮음'].filter(Boolean);
  const cyc = cycle.problems.length ? `⛔ ${cell(cycle.problems[0])}` : tags.length ? `⚠️ 사용 가능 — ${tags.join(' · ')}` : '✅ 사용 가능';
  return {
    ok: all.length > 0 && !bad.length && !dirty && !cycle.problems.length,
    text: [...(dirty ? [dirty, ''] : []), '| 설치 | ⑨ 판 | ① 도구 · lib · 정책 | 그래프 쓰는 법 | 지운 것 가리킴 | 사이클 | 맞나 |', '|---|---|---|---|---|---|---|',
      ...names.filter((n) => skip.includes(n)).map((n) => `| ${n} | 제외(.harness/harness.json installs.skip) | | | | | — |`),
      ...all.map((a) => `| ${a.name} | ${cell(a.ver.observed)} | ${cell(a.files.observed)} | ${a.rules.length ? `설치 글에 따로 ${list(a.rules)}` : '키트 graph.md 하나'} | ${a.gone.length ? `설치 글이 지운 것을 가리킴 ${list(a.gone)}` : '없음'} | ${cyc} | ${same(a) ? '✅' : '⛔'} |`),
      ...(gone.length ? ['', `⚠️ installs.skip 에 있는데 이 폴더에 설치가 없다: ${gone.join(' · ')} — 목록이 낡았다`] : []),
      ...(dirty ? [] : ['', ...[...cycle.warns, ...cycle.notes].map((w) => `⚠️ /exec-cycle · /exec-review — ${w}`), ...cycle.problems.map((p) => `⛔ /exec-cycle · /exec-review 를 바로 쓸 수 없다 — ${p}`),
        !all.length ? '⛔ 설치가 없다 — 폴더를 확인한다' : bad.length ? `⛔ 뒤처지거나 다른 설치 ${bad.length}곳 (${bad.join(' · ')}) — 그 세션에 「갱신」을 맡긴다`
          : cycle.problems.length ? '⛔ 설치는 모두 키트 판이지만 이 PC 에서 /exec-cycle · /exec-review 를 바로 쓸 수 없다 — 위 명령을 사용자 승인 뒤 실행한다'
            : `✅ 설치 ${all.length}곳 모두 키트 판 (${kitCommit()?.slice(0, 7)})`])].join('\n'),
  };
}

export function checkInstall(dir, { plugins, version } = {}) {
  assertKit('install-check');
  if (!existsSync(join(dir, CONFIG))) throw new Error(`${CONFIG} 이 없다 — 키트를 얹지 않은 대상이다 (SETUP.md)`);
  const raw = readJson(join(dir, CONFIG));
  const rows = [];
  const row = (n, what, observed, ok) => rows.push({ n, what, observed: String(observed), ok: Boolean(ok) });
  const own = ownGraph(raw);
  const graph = graphOf(raw);

  const fill = filler(raw);
  const same = sameFiles(dir, fill);
  row('①', '키트 도구 · lib · 정책(그래프 도구 포함)이 키트 판과 같다 · 키트에서 지운 것 0', same.observed, same.ok);

  // ② ③ 키트 소유 문서 — 장부 경로 · 그래프 자리를 채운 키트 판과 같아야 한다. 프로젝트 규칙은 .claude/rules/ 의 별도 파일에
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
  docs('②', '규칙 harness.md · graph.md · 스킬 exec-cycle · exec-review 가 키트 판(자리 채움)과 같다', DOCS);
  // ③ 키트에서 지운 문서(스킬 · 에이전트 정의) — 손대지 않은 판은 갱신이 걷고(① 도 본다), 고친 판은 설치가 정리한다
  const rd = removedDocs(dir, fill);
  row('③', '키트에서 지운 문서(policy/removed.json docs — final-gate · kit-implementer · kit-verifier)가 설치본에 0',
    [rd.gone.length && `손대지 않은 판 남음 ${list(rd.gone)} — upgrade 가 걷는다`, rd.kept.length && `고친 채 남음 ${list(rd.kept)} — 필요한 내용만 프로젝트 규칙으로 옮기고 지운다`].filter(Boolean).join(' · ') || '없음', !rd.gone.length && !rd.kept.length);

  // ④ 정책 — policy-apply 를 그 설치 모양대로 다시 돌려도 바뀌는 것이 없어야 한다(빠진 권한 · 옛 훅 형식 · 걷을 옛 항목)
  const local = raw.mode !== 'share';
  const file = settingsPath(dir, local);
  const now = readJson(file);
  const { graphHook, only } = settingsShape(dir);
  const { settings: want } = applyPolicy(now, { local, only, extra: graphHook ? ['graph-hook'] : [] });
  const diff = differ(now, want);
  // 반대편 설정 파일 — policy-apply 가 지운 도구를 가리키는 것만 거는 자리
  const side = settingsPath(dir, !local);
  const left = existsSync(side) ? dropGone(readJson(side)).gone : [];
  const bits = [diff.length && `${slash(relative(dir, file))} 에서 바뀔 곳: ${diff.join(', ')}`, left.length && `반대편 ${slash(relative(dir, side))} 에 걷을 것 남음: ${left.join(', ')}`].filter(Boolean);
  row('④', '정책 — policy-apply 를 다시 돌려도 바뀌는 것 없음 (권한 · 걷은 훅 등록 · 켠 설치만 그래프 훅) · 반대편 설정 파일에 지운 도구의 훅 · allow 0',
    bits.length ? `${bits.join(' · ')} — upgrade 가 낸 policy-apply 줄을 돌린다`
      : `${slash(relative(dir, file))} 그대로${only ? ' · 키트 정책 없음(--only)' : ''}${graphHook ? ' · 그래프 훅 켬' : ''}`,
    !bits.length);

  // ⑤ harness.json — 값은 프로젝트 것이고 형식 · 있어야 할 것만 본다
  const probs = [];
  try { loadConfig(dir); } catch (e) { probs.push(e.message.split('\n')[0]); }
  if (!['new', 'existing'].includes(raw.profile)) probs.push(`profile ${raw.profile}`);
  if (!['local', 'share'].includes(raw.mode)) probs.push(`mode ${raw.mode}`);
  // 그래프 — 도구는 .harness/tools 한 벌. 옛 자기 그래프는 이관 미완, 옛 도구를 가리키는 줄이 남으면 모델이 그것을 불러 판이 갈라진다
  if (own) probs.push(`옛 자기 그래프(graph.tools ${graph.tools}) — 이관 미완: node <kit>/tools/upgrade.mjs <대상> --migrate-graph`);
  if (raw.graph?.store && !existsSync(join(dir, raw.graph.store))) probs.push(`graph.store 없음 (${raw.graph.store})`);
  // 공유 설치는 기록 파일에 여럿이 이어 쓴다 — git 저장소가 아니면 볼 것이 없다
  if (raw.mode === 'share' && spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir }).status === 0 && !isUnion(dir, graph.store)) {
    probs.push(`기록 파일(${graph.store})이 merge=union 이 아니다 — 따로 쓴 기록이 병합 충돌한다: node .harness/tools/install-mode.mjs share`);
  }
  const refs = graphRefs(dir);
  if (refs.length) probs.push(`키트 밖 그래프 도구를 가리키는 곳 ${list(refs)} — .harness/tools/graph-*.mjs 로 고친다`);
  const apart = graphRules(dir);
  if (apart.length) probs.push(`그래프 쓰는 법을 설치 글에 따로 적은 곳 ${list(apart)} — 키트 graph.md · 훅 하나가 정본이다: 일반 규칙은 키트에 제안하고 지운다 · 이 저장소 사실만 남기되 키트 그래프 도구 이름 · supersedes · ⏸ 를 쓰지 않는다`);
  const gone = removedRefs(dir);
  if (gone.length) probs.push(`키트에서 지운 것을 가리키는 곳 ${list(gone)} — 그 줄을 지운다`);
  for (const a of areaGaps(dir, raw)) { const g = areaGapText(a); probs.push(`${g.text}${g.note ? ` — ⚠️ ${g.note}` : ''}`); }
  probs.push(...recipeGap(raw));
  row('⑤', 'harness.json — 형식 · 프로필 · 모드 · 그래프(이관 · 기록 위치 · 키트 밖 도구 참조 · 설치 글에 따로 적은 쓰는 법 · 키트에서 지운 것을 가리키는 곳) · 코드 영역마다 소스를 덮는 covers 검사 또는 영역의 「테스트 없음」 선언 · 검사마다 처방 또는 why',
    probs.join(' · ') || `검사 ${raw.checks?.length ?? 0} (covers ${(raw.checks ?? []).filter((c) => c.covers?.length).length}) · ${raw.profile} · ${raw.mode}`, !probs.length);

  // ⑥ PC — 대상 밖이다. plugin-plan 의 판정을 그대로 쓴다
  let pc = plugins;
  if (pc === undefined) try { pc = pluginList(); } catch { pc = null; }
  if (pc === null) row('⑥', 'PC — plugin-plan 이 낼 명령 없음 · /exec-cycle · /exec-review 를 바로 쓴다', '플러그인 목록을 읽지 못함 (claude plugin list --json)', false);
  else {
    const { cmds, warns: left } = pcPlan(pc);
    const cycle = cycleReady(pc, version ?? (plugins === undefined ? claudeVersion() : undefined));
    row('⑥', 'PC — plugin-plan 이 낼 명령 없음 (superpowers 고정 판 설치 — 켬/끔 무관 · 사용자 스킬 ponytail-review 가 키트 판 그대로 · 옛 ponytail 플러그인 없음은 ⚠️) · /exec-cycle · /exec-review 를 바로 쓴다(사이클이 읽는 스킬 파일이 다 있다) · superpowers 가 켜져 있으면 ⚠️',
      [cmds.length ? `낼 명령 ${cmds.length}: ${cmds.join(' ; ')}` : '옮길 것 없다', ...cycle.problems.map((p) => `⛔ ${p}`), ...(cycle.warns.length || cycle.notes.length || left.length ? ['⚠️ 아래 ⚠️ 줄'] : [])].join(' · '),
      !cmds.length && !cycle.problems.length);
    if (cycle.warns.length || cycle.notes.length || left.length) rows.at(-1).warn = [...cycle.warns, ...cycle.notes, ...left].join(' ');
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
  row('⑧', '동작 — verify exit 0 · graph-find --check exit 0',
    [`verify exit ${v.code}${firstTest ? ' (첫 테스트 전 — 신규는 정상)' : v.code ? ` — ${why.slice(0, 80)}` : ''}`,
      `graph-find --check exit ${g.code}`].join(' · '),
    (v.code === 0 || firstTest) && g.code === 0);

  const ver = sameCommit(dir);
  row('⑨', `판 — 설치본이 기록한 키트 커밋(.harness/kit-commit) = 키트의 지금 커밋 · 또는 그 뒤 ${SHIPPED.join(' · ')} 그대로`, ver.observed, ver.ok);
  return rows;
}

// 프로젝트 맞춤 — lib/parts.mjs 의 프로젝트 설정 · 데이터. 판정하지 않지만 숨기지 않는다(같은 벗어남이 여러 설치에서 반복되면 처방 후보)
export function custom(dir) {
  const raw = readJson(join(dir, CONFIG));
  const g = graphOf(raw);
  const count = (rel) => (existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), 'utf8').split('\n').filter((l) => l.trim()).length : 0);
  const cell = (s) => String(s).replace(/\|/g, '\\|');
  const short = (s) => (s.length > 50 ? `${s.slice(0, 50)}…` : s);
  const from = (c) => [c.recipe && `처방 ${c.recipe}`, c.why?.trim() && `why: ${c.why.trim()}`].filter(Boolean).join(' · ') || '없음';
  const rules = existsSync(join(dir, '.claude', 'rules')) ? readdirSync(join(dir, '.claude', 'rules')).filter((f) => /^project-.+\.md$/.test(f)).map((f) => `.claude/rules/${f}`) : [];
  const names = raw.graph?.names ? raw.graph.names.join(' · ') || '끔' : '기본(저장소 폴더 이름)';
  const grown = grownTests(dir, raw);
  const ledgers = Object.values(raw.state ?? {}).map((at) => `${at} ${count(at)}줄`).join(' · ');
  return ['## 프로젝트 맞춤 — 판정 아님 · 키트와 달라도 되는 자리(lib/parts.mjs)', `> ${PARTS.config}`, `> ${PARTS.data}`, '',
    '| 검사 | kind | 명령 | covers | 처방 · 이유 |', '|---|---|---|---|---|',
    ...(raw.checks ?? []).map((c) => `| ${cell(c.id)} | ${c.kind} | ${cell(short(c.cmd ?? ''))} | ${c.covers?.length ?? 0} | ${cell(from(c))} |`), '',
    ...(raw.checks ?? []).filter((c) => c.tests === 'none').map((c) => `테스트 없음 — 코드 변경마다 /code-review (${c.id}: ${c.why?.trim() ?? ''})`),
    ...(grown ? [grown] : []),
    `그래프 — graph.names ${names} · graph.store ${g.store} · 기록 ${count(g.store)}건`,
    `프로젝트 규칙 ${rules.join(' · ') || '없음'}`,
    `장부 ${ledgers ? `${ledgers} (빈 줄 뺀 수)` : '없음'}`].join('\n');
}

cli(import.meta.url, () => {
  const args = process.argv.slice(2);
  if (args.includes('--all')) {
    const { text, ok } = checkAll(args[args.indexOf('--all') + 1] ?? process.cwd());
    console.log(text);
    process.exit(ok ? 0 : 1);
  }
  const dir = args.find((a) => !a.startsWith('--')) ?? process.cwd();
  const rows = checkInstall(dir);
  const dirty = dirtyKit();
  if (args.includes('--json')) {
    if (dirty) console.error(dirty);
    console.log(JSON.stringify(rows, null, 2));
  } else {
    if (dirty) console.log(`${dirty}\n`);
    console.log('| | 기대 | 관측 | 맞나 |\n|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.n} | ${r.what} | ${r.observed.replace(/\|/g, '\\|')} | ${r.ok ? '✅' : '⛔'} |`);
    const bad = rows.filter((r) => !r.ok).map((r) => r.n);
    for (const r of rows.filter((x) => x.warn)) console.log(`⚠️ ${r.n} — ${r.warn}`);
    if (!dirty) console.log(bad.length ? `\n⛔ 이식 실패 — ⛔ ${bad.length}개 (${bad.join(' ')}) · 「이식 성공」이라고 쓰지 않는다` : `\n✅ 이식 성공 — ${rows.length}/${rows.length}`);
    console.log(`\n${custom(dir)}`);
  }
  process.exit(rows.every((r) => r.ok) && !dirty ? 0 : 1);
});

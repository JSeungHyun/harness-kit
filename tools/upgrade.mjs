#!/usr/bin/env node
// 갱신 — 이미 설치된 대상에 키트의 지금 도구 · 정책 · 규칙을 얹는다. 설계안.
//   node <kit>/tools/upgrade.mjs <대상> [--own-rules]
// 도구 · lib · 정책은 키트 것이라 덮어쓴다. 규칙 · 스킬은 설치본이 키트 이력의 한 버전과 같을 때만 바꾼다 — 다르면 프로젝트가 고친 것이라 ⛔ 로 멈춘다.
//   --own-rules: 프로젝트가 고친 줄을 .claude/rules/project-<이름>.md 로 옮기고 키트 판을 다시 깐다 — 키트 파일은 키트 판 그대로여야 이식 검사 ② ③ 이 맞다
//   --migrate-graph: 옛 자기 그래프(graph.tools)를 키트 그래프 도구로 — 기록은 제자리(graph.store), 기록 files 의 옛 도구 경로만 한 번 바꾼다
// ⛔ 설정은 쓰지 않는다 — 권한 설정은 사용자 확인 자리라 실행할 명령만 낸다.
import { cpSync, existsSync, readFileSync, writeFileSync, appendFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { loadConfig, cli, CONFIG } from '../lib/config.mjs';
import { KIT, SHIPPED, COPIED, DOCS, graphOf } from '../lib/parts.mjs';
import { load, sup } from './graph-find.mjs';
import { testHints, testSources, RECIPES, recipeHints, recipeLine } from './detect.mjs';

const KIT_PATH = KIT.replace(/\\/g, '/').replace(/\/$/, '');
export const nl = (s) => s.replace(/\r\n/g, '\n');
const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
const kitGit = (...a) => execFileSync('git', ['-C', KIT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// 대상의 .harness/tools 사본에는 templates 가 없다 — 그 사본은 자기 위치를 키트로 안다
export function assertKit(tool) {
  if (!existsSync(join(KIT, 'templates'))) throw new Error(`키트 저장소의 ${tool} 를 돌린다 — node <kit>/tools/${tool}.mjs <대상>`);
}

export function kitCommit() {
  try { return kitGit('rev-parse', 'HEAD').trim(); } catch { return null; }
}

// 키트 작업 트리의 커밋 안 된 변경(갱신이 얹는 것) — 있으면 설치본이 미커밋 판을 커밋 이름으로 받는다. git 저장소가 아니면 없다
export function kitDirty() {
  try { return kitGit('status', '--porcelain', '--', ...SHIPPED).split('\n').filter(Boolean).map((l) => l.slice(3)); } catch { return []; }
}

// sha 뒤 키트 HEAD 까지 SHIPPED 가 그대로인가 — 키트가 모르는 커밋 · sha 모양이 아닌 값(-dirty 등)이면 아니다
export function shippedSame(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) return false;
  try { kitGit('diff', '--quiet', sha, 'HEAD', '--', ...SHIPPED); return true; } catch { return false; }
}
export const list = (a) => `${a.slice(0, 4).map((p) => p.replace(/\\/g, '/')).join(', ')}${a.length > 4 ? ` 외 ${a.length - 4}` : ''}`;

export const ownGraph = (raw) => graphOf(raw).tools !== '.harness/tools';
export function filler(raw) {
  const g = graphOf(raw);
  return (s) => nl(s).replaceAll('<decisions>', raw.state?.decisions ?? '<decisions>').replaceAll('<lessons>', raw.state?.lessons ?? '<lessons>')
    .replaceAll('<graph-tools>', g.tools).replaceAll('<graph-rules>', g.rules);
}

// 키트가 git 저장소가 아니면(압축본) 이력이 없다 — 그러면 다른 규칙은 전부 「고쳤다」로 본다
function history(src) {
  let commits;
  try { commits = kitGit('rev-list', 'HEAD', '--', src).split('\n').filter(Boolean); } catch { return []; }
  // 지운 템플릿은 지운 커밋에 없다
  return commits.flatMap((c) => { try { return [kitGit('show', `${c}:${src}`)]; } catch { return []; } });
}

// 줄 단위 LCS — added 는 설치본 쪽 줄 번호(절 제목을 찾으려고), removed 는 빠진 키트 줄. 빈 줄은 세지 않는다
function lineDiff(base, mine) {
  const a = base.split('\n');
  const b = mine.split('\n');
  const L = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const added = [];
  const removed = [];
  for (let i = 0, j = 0; i < a.length || j < b.length;) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; } else if (j < b.length && (i === a.length || L[i][j + 1] >= L[i + 1][j])) added.push(j++);
    else removed.push(a[i++]);
  }
  return { added: added.filter((k) => b[k].trim()), removed: removed.filter((l) => l.trim()) };
}

// 설치본의 키트 소유 문서 — same(지금 판) · old(키트 이력의 한 판) · mine(프로젝트가 고침 — 가장 가까운 키트 판과의 다른 줄)
// to: 다시 깔 때의 자리 채움 — 그래프 이관은 설치본을 옛 값(fill)으로 판정하고 새 값(to)으로 깐다
export function docState(src, now, fill, to = fill) {
  const tmpl = readFileSync(join(KIT, src), 'utf8');
  const next = to(tmpl);
  if (now === next) return { state: 'same', next };
  const versions = [fill(tmpl), ...history(src).map(fill)];
  if (versions.includes(now)) return { state: 'old', next };
  const size = (d) => d.added.length + d.removed.length;
  const diff = [next, ...versions].map((v) => lineDiff(v, now)).reduce((m, d) => (size(d) < size(m) ? d : m));
  return { state: 'mine', next, diff };
}

export function summary(diff, now, max = 1) {
  const lines = now.split('\n');
  const shown = [...diff.added.map((k) => `+ ${lines[k].trim()}`), ...diff.removed.map((l) => `− ${l.trim()}`)].slice(0, max).map((l) => (l.length > 70 ? `${l.slice(0, 70)}…` : l));
  return `+${diff.added.length} −${diff.removed.length}${shown.length ? `: ${shown.join('\n   ')}` : ' (빈 줄만 다르다)'}`;
}

// 프로젝트가 고친 줄을 프로젝트 규칙 파일로 — 더한 줄은 그 절 제목 아래, 뺀 키트 줄은 「따르지 않는다」로
function moveOwn(dir, dst, name, now, diff, mode) {
  if (!diff.added.length && !diff.removed.length) return null;
  const rel = `.claude/rules/project-${name}.md`;
  const at = join(dir, rel);
  const lines = now.split('\n');
  const isHead = (l) => /^#{1,6} /.test(l);
  const added = new Set(diff.added);
  const groups = [];
  let heading = null;
  for (const [k, l] of lines.entries()) {
    if (isHead(l)) heading = l;
    if (!added.has(k)) continue;
    if (groups.at(-1)?.head !== heading) groups.push({ head: heading, lines: [] });
    if (l !== heading) groups.at(-1).lines.push(l);
  }
  const fresh = !existsSync(at);
  const body = [
    ...(fresh ? [`# 이 프로젝트의 규칙 — 키트 \`${dst}\` 를 고쳤던 줄`, '', '> 키트 갱신(`upgrade --own-rules`)이 옮겼다. 키트 판과 어긋나면 이 파일이 이긴다. 키트 갱신은 이 파일을 건드리지 않는다.'] : []),
    ...groups.flatMap((g) => ['', ...(g.head ? [g.head] : []), ...g.lines]),
    ...(diff.removed.length ? ['', '## 이 프로젝트가 따르지 않는 키트 줄', ...diff.removed.map((l) => `> ${l}`)] : []),
  ];
  appendFileSync(at, `${body.join('\n')}\n`);
  if (mode !== 'share') hideLocal(dir, rel);
  return rel;
}

// 로컬 전용 설치는 아무것도 git 에 보이지 않는다 — install-mode 블록은 한 번만 쓰여 새로 생긴 파일을 모른다
function hideLocal(dir, rel) {
  if (spawnSync('git', ['check-ignore', '-q', rel], { cwd: dir }).status !== 1) return; // 0 이미 무시 · 128 저장소 아님
  const exclude = resolve(dir, execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: dir, encoding: 'utf8' }).trim());
  const text = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  appendFileSync(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}/${rel}\n`);
}

// 대상 설정의 모양 — 관문 훅만 건 설치(--only gate-hook)인가 · 키트 그래프 훅을 켰나. 갱신 안내와 이식 검사 ④ 가 같이 쓴다
export function settingsShape(dir) {
  const sets = ['settings.local.json', 'settings.json'].map((f) => read(join(dir, '.claude', f)));
  // 옛 자기 그래프 훅(tools/graph-hook.mjs)도 그래프 훅이다 — 정책 줄이 키트 훅으로 바꿔 끼운다
  const graphHook = sets.some((s) => JSON.stringify(s.hooks ?? {}).includes('graph-hook.mjs'));
  // 정책 전체를 받은 설치는 키트 도구 허용 규칙이 있다 — 플러그인 선언은 표식이 아니다(--only 대상이 ponytail 을 스스로 켤 수 있다)
  const kitAllow = (read(join(KIT, 'policy', 'settings.json')).permissions?.allow ?? []).filter((r) => r.includes('.harness/tools/'));
  const full = sets.some((s) => (s.permissions?.allow ?? []).some((r) => kitAllow.includes(r)));
  return { graphHook, only: sets.some((s) => JSON.stringify(s.hooks ?? {}).includes('gate-hook.mjs')) && !full };
}

// 키트 템플릿에서 지운 장부 줄 — 장부 본문은 프로젝트 것이라 그 줄과 같은 줄(앞뒤 공백 무시)만 본다. 갱신이 걷고 이식 검사 ① 이 남은 것을 본다
export function ledgerLeft(dir, raw) {
  const gone = new Set(Object.values(read(join(KIT, 'policy', 'removed.json')).lines).flat().map((l) => l.trim()));
  const where = [];
  const files = Object.values(raw.state ?? {}).filter((at) => existsSync(join(dir, at))).flatMap((at) => {
    const lines = readFileSync(join(dir, at), 'utf8').split('\n');
    const kept = [];
    lines.forEach((l, i) => (gone.has(l.trim()) ? where.push(`${at}:${i + 1}`) : kept.push(l)));
    return kept.length < lines.length ? [{ at, kept }] : [];
  });
  return { where, files };
}

// 빌드 · 테스트 단서가 있는데 코드를 덮는 검사가 없으면 그 단서 — 그때 verify 녹색은 코드 변경의 증거가 아니다. 「테스트 없음」 선언(tests: none)이면 그 자리는 /code-review 다
export const coversGap = (dir, raw) => ((raw.checks ?? []).some((c) => c.covers?.length || c.tests === 'none') ? [] : testHints(dir));

// 검사마다 처방 id 또는 처방에서 벗어난 이유 — 맞춤의 출처가 남아야 같은 벗어남이 여러 설치에서 반복되는지 본다. 「테스트 없음」은 why 가 그 이유다
export function recipeGap(raw) {
  const why = (c) => typeof c.why === 'string' && c.why.trim();
  const checks = raw.checks ?? [];
  const none = checks.filter((c) => !c.recipe && !why(c) && c.tests !== 'none').map((c) => c.id);
  const unknown = checks.filter((c) => c.recipe && !RECIPES.some((r) => r.id === c.recipe)).map((c) => `${c.id}(${c.recipe})`);
  const noWhy = checks.filter((c) => c.tests === 'none' && !why(c)).map((c) => c.id);
  return [none.length && `처방 · why 없는 검사 ${none.join(', ')} — 그 검사에 "recipe": "<처방 id>" 또는 "why": "<처방에서 벗어난 이유>" 를 적는다`,
    unknown.length && `목록에 없는 처방 ${unknown.join(', ')} — <kit>/policy/recipes.json 의 id 로 고치거나 why 로 바꾼다`,
    noWhy.length && `「테스트 없음」 선언에 why 없음 ${noWhy.join(', ')} — "why": "<테스트가 없는 이유>"`].filter(Boolean);
}

// 「테스트 없음」을 선언했는데 테스트 소스가 생겼다 — 판정은 아니지만 늘 보인다
export function grownTests(dir, raw) {
  const at = (raw.checks ?? []).some((c) => c.tests === 'none') ? testSources(dir) : [];
  return at.length ? `⚠️ 테스트가 생겼다 — junit 검사와 covers 를 더할 때 (${at.join(' · ')})` : '';
}

// 키트 밖 그래프 도구(<폴더>/graph-*.mjs, .harness/tools 가 아닌 것)를 가리키는 줄 — 지시 파일 · 프로젝트 규칙 · 스킬 · harness.json.
// 키트 문서는 ② ③ 이 보고, 설정의 훅은 정책 줄이 바꿔 끼운다. 남아 있으면 모델이 옛 도구를 불러 판이 다시 갈라진다
export function graphRefs(dir) {
  const kitDocs = new Set(DOCS.map(([, dst]) => dst));
  const listed = ['.claude/rules', '.claude/skills'].flatMap((d) => (existsSync(join(dir, d)) ? readdirSync(join(dir, d), { recursive: true }).map((f) => `${d}/${f.replace(/\\/g, '/')}`) : []));
  return ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.harness/harness.json', ...listed]
    .filter((f) => !kitDocs.has(f) && existsSync(join(dir, f)) && statSync(join(dir, f)).isFile())
    .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').flatMap((l, i) =>
      ([...l.matchAll(/((?:[\w.${}-]+\/)+)graph-[\w-]+\.mjs/g)].some((m) => !m[1].endsWith('.harness/tools/')) ? [`${f}:${i + 1}`] : [])));
}

// 옛 자기 그래프 → 키트 그래프 도구. 기록은 제자리(graph.store) · 살아있는 기록 files 의 옛 도구 경로만 한 번 바꾼다 — note 는 그대로, 대체된 기록은 경로 검사에서 이미 빠진다
function migrateGraph(dir, raw) {
  const g = graphOf(raw);
  const store = join(dir, g.store);
  if (!existsSync(store)) throw new Error(`기록이 없다: ${g.store} — harness.json graph.store 에 기존 기록 경로를 적고 다시 돌린다`);
  const prefix = `${g.tools.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')}/`;
  const dead = new Set(load(store).flatMap(sup));
  let n = 0;
  const lines = readFileSync(store, 'utf8').split('\n').map((l) => {
    let r;
    try { r = JSON.parse(l); } catch { return l; }
    const moved = (f) => {
      const p = String(f).replace(/\\/g, '/').replace(/^\.\//, '');
      return p.startsWith(prefix) && /^graph-[\w-]+\.mjs$/.test(p.slice(prefix.length)) ? `.harness/tools/${p.slice(prefix.length)}` : f;
    };
    if (dead.has(r?.req) || !(r?.files ?? []).some((f) => moved(f) !== f)) return l;
    n++;
    return JSON.stringify({ ...r, files: r.files.map(moved) });
  });
  writeFileSync(store, lines.join('\n'));
  const { tools, ...rest } = raw.graph;
  const conf = { ...raw, graph: { ...rest, store: g.store } };
  writeFileSync(join(dir, CONFIG), `${JSON.stringify(conf, null, 2)}\n`);
  return { conf, n, from: tools };
}

export function upgrade(dir, { ownRules = false, migrate = false } = {}) {
  assertKit('upgrade');
  // 시험 · 개발용 우회는 HARNESS_KIT_DIRTY_OK 하나 — 그때 판 이름에 -dirty 를 붙여 이식 검사 ⑨ 가 ⛔ 로 본다
  const dirty = kitDirty();
  if (dirty.length && !process.env.HARNESS_KIT_DIRTY_OK) return { text: `⛔ 키트에 커밋 안 된 변경 — 커밋한 뒤 갱신한다(설치본에 미커밋 판이 커밋 이름으로 적힌다): ${list(dirty)}`, stop: true };
  loadConfig(dir);
  let raw = JSON.parse(readFileSync(join(dir, CONFIG), 'utf8'));
  const fill = filler(raw);
  const own = ownGraph(raw);
  const out = [];
  let stop = false;

  // 그래프 도구도 모든 설치에 — 프로젝트별 값은 harness.json graph 의 기록 위치 · 규칙 자리뿐이다
  for (const d of COPIED) cpSync(join(KIT, d), join(dir, '.harness', d), { recursive: true });
  // 이식 검사 ⑨ 가 이 커밋을 키트의 지금 커밋과 비교한다
  const commit = kitCommit();
  const mark = dirty.length ? '-dirty' : '';
  if (commit) writeFileSync(join(dir, '.harness', 'kit-commit'), `${commit}${mark}\n`);
  out.push(`✅ .harness/{lib,tools,policy} — 키트의 지금 것으로${commit ? ` (키트 ${commit.slice(0, 7)}${mark} — .harness/kit-commit)` : ''}`);
  if (own && migrate) {
    const m = migrateGraph(dir, raw);
    raw = m.conf;
    out.push(`✅ 그래프 이관 — graph.store = ${raw.graph.store} · graph.tools(${m.from}) 걷음 · 기록 ${m.n}건의 files 에서 ${m.from}/graph-*.mjs → .harness/tools/graph-*.mjs`);
  }
  const to = filler(raw);

  for (const [src, dst, name] of DOCS) {
    const at = join(dir, dst);
    if (!existsSync(at)) { out.push(`· ${dst} — 없다(얹지 않은 모듈) · 그대로`); continue; }
    const now = nl(readFileSync(at, 'utf8'));
    const doc = docState(src, now, fill, to);
    if (doc.state === 'same') out.push(`· ${dst} — 이미 지금 것`);
    else if (doc.state === 'old') { writeFileSync(at, doc.next); out.push(`✅ ${dst} — 갱신`); }
    else if (ownRules) {
      const rel = moveOwn(dir, dst, name, now, doc.diff, raw.mode);
      writeFileSync(at, doc.next);
      out.push(`✅ ${dst} — 키트 판을 다시 깔았다 · ${rel ? `프로젝트가 고친 줄(+${doc.diff.added.length} −${doc.diff.removed.length})은 ${rel} 로 옮겼다 — 그 파일을 사용자에게 보여 준다` : '빈 줄만 달랐다'}`);
    } else {
      stop = true;
      out.push(`⛔ ${dst} — 프로젝트가 고쳤다 ${summary(doc.diff, now, 8)}`,
        `   손대지 않았다. 고친 줄을 프로젝트 규칙 파일(.claude/rules/project-${name}.md)로 옮기고 키트 판을 다시 깐다: node ${KIT_PATH}/tools/upgrade.mjs ${dir.replace(/\\/g, '/')} --own-rules`);
    }
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
  const ledger = ledgerLeft(dir, raw);
  for (const f of ledger.files) writeFileSync(join(dir, f.at), f.kept.join('\n'));
  if (ledger.where.length) out.push(`🧹 걷음(키트에서 지운 장부 줄): ${ledger.where.join(', ')}`);
  // 지운 경로를 살아있는 기록이 가리키면 --check 빨강 → verify 빨강 → 모든 코드 턴이 관문에 막힌다 — 같은 턴에 고치게 목록을 낸다
  const gonePaths = new Set([...removed.files, ...dropped]);
  const recs = load(join(dir, graphOf(raw).store));
  const dead = new Set(recs.flatMap(sup));
  const pointing = recs.filter((r) => !dead.has(r.req))
    .flatMap((r) => (r.files ?? []).filter((f) => gonePaths.has(f.replace(/\\/g, '/').replace(/^\.\//, ''))).map((f) => `   ${f} ← ${r.req.slice(0, 50)}`));
  if (pointing.length) out.push('⚠️ 그래프 기록이 지운 경로를 가리킨다 — 같은 턴에 그 경로를 뺀 기록으로 supersedes 한다(그대로면 graph-find --check 빨강):', ...pointing);

  // 그래프 도구는 .harness/tools 한 벌 — 옛 자기 그래프는 이관 안내, 이관 뒤에도 옛 도구를 가리키는 참조가 남으면 멈춘다(이식 검사 ⑤ 와 같은 목록)
  const refs = graphRefs(dir);
  const target = dir.replace(/\\/g, '/');
  if (ownGraph(raw)) {
    stop = true;
    const g = graphOf(raw);
    out.push('', `⛔ 그래프 이관 — 그래프 도구를 ${g.tools} 에 따로 둔 설치다(13차 전 자기 그래프). 키트 그래프 도구는 .harness/tools 에 깔았고 기록 · 규칙 · 옛 도구는 그대로다`,
      `   (a)(b) node ${KIT_PATH}/tools/upgrade.mjs ${target} --migrate-graph — harness.json graph.store 를 기존 기록(${g.store})으로 적고 graph.tools 를 걷는다 · 살아있는 기록 files 의 ${g.tools}/graph-*.mjs 를 .harness/tools/graph-*.mjs 로 한 번 바꾼다(note · 대체된 기록은 그대로) · 규칙 · final-gate 를 키트 도구로 다시 깐다`,
      `   (c) 키트 밖 그래프 도구를 가리키는 곳 — 프로젝트가 .harness/tools/graph-*.mjs 로 고친다: ${refs.join(', ') || '없음'} (설정의 그래프 훅은 「다음」 2 의 정책 줄이 바꿔 끼운다)`,
      `   (d) 옛 ${g.tools}/graph-*.mjs 는 키트가 지우지 않는다 — 프로젝트가 참조를 고친 뒤 지운다. 프로젝트 고유 도구는 그대로다`);
  } else if (refs.length) {
    stop = true;
    out.push('', `⛔ 키트 밖 그래프 도구를 가리키는 곳 — 프로젝트가 .harness/tools/graph-*.mjs 로 고친다(남아 있는 동안 이식 검사 ⑤ ⛔): ${refs.join(', ')}`,
      '   옛 graph-*.mjs 는 키트가 지우지 않는다 — 참조를 고친 뒤 프로젝트가 지운다');
  }

  // 옛 정책이 쓴 플러그인 선언 · ponytail 모드(옛 마켓 id 포함)는 policy-apply 가 걷는다 — 여기서는 --off 를 내지 않는다
  // 관문 훅만 건 설치(--only gate-hook — 지시 파일이 흐름 · 권한을 정한 프로젝트)에 --with 를 내면 받지 않은 정책이 들어간다
  // 키트 그래프 훅을 건 설치 — 다시 병합해야 훅 형식이 바뀐다
  const { graphHook, only } = settingsShape(dir);
  out.push('', '다음 — 이 순서로 (설정이라 사용자가 돌리거나 승인한다):',
    `1. node ${KIT_PATH}/tools/plugin-plan.mjs — 이전 명령이 나오면 사용자 승인 뒤 먼저 실행한다`,
    `2. node .harness/tools/policy-apply.mjs${raw.mode === 'share' ? '' : ' --local'} ${only ? '--only gate-hook' : `--with gate-hook${graphHook ? ' --with graph-hook' : ''}`}`,
    `3. node ${KIT_PATH}/tools/install-check.mjs ${dir.replace(/\\/g, '/')} — 표를 보고에 그대로 붙인다. exit 0 이 아니면 「이식 성공」이라고 쓰지 않는다`);

  // 갱신이 검사 목록을 다시 본다 — 빌드 도구가 있는데 코드를 덮는 검사가 없으면 verify 녹색은 코드 변경의 증거가 아니다
  const hints = coversGap(dir, raw);
  if (hints.length) {
    stop = true;
    out.push('', `⛔ 빌드 · 테스트 단서(${hints.join(' · ')})가 보이는데 covers 를 가진 검사가 없다 — 관문 훅이 코드 변경마다 /code-review 를 요구하고 verify 는 「코드 검사 없음」을 낸다. `
      + '그 코드를 돌리는 검사를 harness.json 에 더하고 covers 에 그 코드의 glob 을 적은 뒤(SETUP ⑤) 갱신을 다시 돌린다. 테스트 소스가 없거나 이 PC 에서 못 돌리면(테스트 명령을 지어내지 않는다) 실제로 도는 검사 하나에 "tests": "none" 과 "why": "<이유>" 를 적는다 — 이식 검사 「프로젝트 맞춤」에 「테스트 없음 — 코드 변경마다 /code-review」가 늘 보인다');
  }
  const grown = grownTests(dir, raw);
  if (grown) out.push('', grown);

  // harness.json 은 프로젝트 설정이라 키트가 쓰지 않는다 — 그 프로젝트 세션이 적도록 줄과 처방 후보를 낸다
  const gap = recipeGap(raw);
  if (gap.length) {
    stop = true;
    out.push('', ...gap.map((g) => `⛔ ${g}`), `   harness.json 은 프로젝트 설정 — 키트가 쓰지 않는다. detect 가 고른 ${recipeHints(dir).map(recipeLine).join(' · ')}`);
  }
  return { text: out.join('\n'), stop };
}

cli(import.meta.url, () => {
  const args = process.argv.slice(2);
  const r = upgrade(args.find((a) => !a.startsWith('--')) ?? process.cwd(), { ownRules: args.includes('--own-rules'), migrate: args.includes('--migrate-graph') });
  console.log(r.text);
  if (r.stop) process.exit(1);
});

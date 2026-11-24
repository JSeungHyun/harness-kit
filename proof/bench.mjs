#!/usr/bin/env node
// 상시 측정 묶음 — 설치마다 입력을 한 번 얼려 두고, 키트를 고칠 때마다 같은 입력을 지금 도구로 돌려 기준 숫자와 견준다. 설계안.
// 입력이 날마다 바뀌면(「최근 300」) 차수끼리 숫자를 잇지 못한다 — 그래서 얼린다. 질문당 비용 0(설치 · 측정 때만 돈다).
//   node proof/bench.mjs --snapshot <설치 폴더…> | --all <폴더>  [--force]
//     얼린다 — 그래프 기록 · 그 기록이 가리키는 경로의 빈 자리 · harness.json · 턴을 연 입력 최근 N개
//   node proof/bench.mjs --run [--accept] [--tools <도구 폴더>]
//     얼린 설치마다 표 — 첫 --run 이 기준 숫자(baseline.json)를 쓰고, 그 뒤로는 --accept 일 때만 덮는다. 허용폭 밖으로 나빠지면 exit 1 · 도구가 못 돌면 exit 2
//   --home <폴더>: 스냅숏 자리(기본 ~/.claude/harness-bench — 저장소 밖) · --sessions <폴더>: 세션 기록 뿌리(기본 ~/.claude/projects)
// 지표를 더하는 자리는 METRICS 배열 하나다. 허용폭은 사전 등록이다 — 결과를 보고 바꾸지 않는다.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, slug } from '../tools/graph-find.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : dflt; };
const flag = (name) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const HOME = resolve(opt('--home', join(homedir(), '.claude', 'harness-bench')));
const SESSIONS = resolve(opt('--sessions', join(homedir(), '.claude', 'projects')));
const TOOLS = resolve(opt('--tools', join(KIT, 'tools')));
const N = 300;
const all = opt('--all');
const force = flag('--force'), accept = flag('--accept');

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 8);
// 커밋 안 된 변경이 있으면 + 를 붙인다 — 그 숫자는 그 커밋의 것이 아니다
const git = (...argv) => execFileSync('git', ['-C', KIT, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const kitCommit = () => { try { return git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain') ? '+' : ''); } catch { return '?'; } };
const node = (file, argv, more = {}) => spawnSync(process.execPath, [file, ...argv.map(String)], { encoding: 'utf8', maxBuffer: 1 << 28, ...more });
const ok = (r) => { if (r.status !== 0) throw new Error(`도구 실행 실패(exit ${r.status}${r.error ? ` · ${r.error.code}` : ''}) ${(r.stderr ?? '').trim().split('\n').at(-1)}`); return r; };

// ── 지표 ─────────────────────────────────────────────────────────────
// 원천 — 얼린 입력에 기존 도구를 부른다. 새로 계산하지 않는다. 한 --run 에 원천마다 한 번만 돈다
const PROMPTS = (s) => { const r = ok(s.tool('graph-measure.mjs', '--prompts', join(s.dir, 'prompts.jsonl'), '--limit', s.meta.prompts, '--dump', s.out('prompts.json'))); return { ...r, dump: json(s.out('prompts.json')) }; };
const SELF = (s) => ok(s.tool('graph-measure.mjs', '--self'));
const CHECK = (s) => s.tool('graph-find.mjs', '--check');
// 그 설치가 세션마다 읽는 키트 규칙 — 줄바꿈은 LF 로 센다(test/rule-budget.test.mjs 와 같다)
const RULES = (s) => s.meta.rules.reduce((n, f) => n + readFileSync(join(KIT, 'templates', 'rules', f), 'utf8').replace(/\r\n/g, '\n').length, 0);

// 읽기 — 도구가 낸 표의 한 칸
const cell = (row, col) => ({ stdout }) => {
  const lines = stdout.split('\n').filter((l) => l.startsWith('| ')).map((l) => l.split('|').map((c) => c.trim()));
  const v = parseFloat(lines.find((c) => c[1] === row)?.[lines.find((c) => c.includes(col))?.indexOf(col)]);
  if (Number.isNaN(v)) throw new Error(`도구 출력에서 「${row}」 줄 「${col}」 칸을 못 읽었다`);
  return v;
};
const selfRate = ({ stdout }) => {
  const m = stdout.match(/자기검색 1위 (\d+)\/(\d+)/);
  if (!m) throw new Error('도구 출력에서 「자기검색 1위」 를 못 읽었다');
  return Math.round((m[1] / m[2]) * 1000) / 10;
};

// 허용폭(사전 등록) — (기준, 지금) → 밖이면 '⛔ …'(exit 1) · '⚠️ …'(exit 0)
// 시간은 ⚠️ 만 — 도구를 안 바꾼 같은 조건 재실행이 −46% ~ +16% 흔들렸다(19차 · node 20~24개)
const slower = (b, n) => n > b * 1.15 && '⚠️ +15% 넘게 느려졌다 — 부하 탓일 수 있다 · 조용할 때 다시 잰다';
const grew = (b, n) => n > b && '⛔ 늘었다';
const grewWarn = (b, n) => n > b && '⚠️ 늘었다 — 의도한 것이면 --accept';
const fell = (pp) => (b, n) => n < b - pp && `⛔ ${pp}%p 넘게 떨어졌다`;
const changed = (b, n) => n !== b && '⚠️ 바뀌었다';

// ⭐ 새 지표는 여기에 한 줄 — { key(baseline.json 의 이름), name, unit, from(원천), read(원천 출력 → 값), judge(없으면 표에만) }
// 값이 [{ id, hash }] 목록이면 기준과 입력마다 견줘 「같음 n/N」과 다른 id 만 낸다(판정은 사람). unit 이 ms 인 줄은 부하에 흔들린다
const METRICS = [
  { key: 'hookP90', name: '프롬프트 훅 p90', unit: 'ms', from: PROMPTS, read: cell('전체', '훅 p90'), judge: slower },
  { key: 'injRate', name: '주입률', unit: '%', from: PROMPTS, read: cell('전체', '주입률') },
  { key: 'injAvg', name: '주입 평균', unit: '자', from: PROMPTS, read: cell('전체', '주입 평균'), judge: grew },
  { key: 'injP90', name: '주입 p90', unit: '자', from: PROMPTS, read: cell('전체', '주입 p90') },
  { key: 'rules', name: '세션 시작 규칙', unit: '자', from: RULES, read: (n) => n, judge: grewWarn },
  { key: 'conf', name: '1단', unit: '%', from: PROMPTS, read: cell('전체', '1단'), judge: fell(2) },
  { key: 'silent', name: '침묵', unit: '%', from: PROMPTS, read: cell('전체', '침묵') },
  { key: 'self', name: '자기검색 1위', unit: '%', from: SELF, read: selfRate, judge: fell(1) },
  { key: 'check', name: '--check exit', unit: '', from: CHECK, read: (r) => r.status, judge: changed },
  { key: 'promptSame', name: '훅 출력 같음', from: PROMPTS, read: (r) => r.dump },
];

// ── 얼리기 ───────────────────────────────────────────────────────────
function snapshot(install) {
  const root = resolve(install);
  const conf = json(join(root, '.harness', 'harness.json'));
  const store = conf.graph?.store ?? '.harness/graph/requests.jsonl';
  // 키는 경로에서 — 이름이 같은 다른 폴더와 겹치지 않게
  const dir = join(HOME, `${basename(root)}-${sha(root.toLowerCase())}`), skel = join(dir, 'install');
  if (!existsSync(join(root, store))) throw new Error(`그래프 기록이 없다: ${join(root, store)}`);
  if (existsSync(dir)) {
    if (!force) throw new Error(`이미 얼린 설치다: ${dir} — 다시 얼리면 기준 숫자도 사라진다. 그래도 하려면 --force`);
    rmSync(dir, { recursive: true, force: true });
  }
  const place = (rel, body) => { mkdirSync(dirname(join(skel, rel)), { recursive: true }); writeFileSync(join(skel, rel), body); };
  place('.harness/harness.json', readFileSync(join(root, '.harness', 'harness.json')));
  place(store, readFileSync(join(root, store)));
  // --check 의 경로 무결성 — 지금 있는 경로는 빈 자리로 남긴다(내용은 안 읽힌다). 저장소 밖 경로는 못 얼린다
  let outside = 0;
  for (const r of load(join(root, store))) for (const f of r.files ?? []) {
    const rel = relative(root, resolve(root, f.replace(/:\d+(-\d+)?$/, '')));
    if (isAbsolute(rel) || rel.startsWith('..')) { outside++; continue; }
    const at = statSync(join(root, rel), { throwIfNoEntry: false });
    if (!at || existsSync(join(skel, rel))) continue;
    if (at.isDirectory()) mkdirSync(join(skel, rel), { recursive: true }); else place(rel, '');
  }
  const ruleDir = join(root, '.claude', 'rules');
  const rules = existsSync(ruleDir) ? readdirSync(ruleDir).filter((f) => existsSync(join(KIT, 'templates', 'rules', f))) : [];

  const from = join(SESSIONS, slug(root));
  const frozen = node(join(TOOLS, 'graph-measure.mjs'), ['--prompts', from, '--limit', N, '--freeze', join(dir, 'prompts.jsonl'), '--store', join(skel, store)]);
  if (frozen.status !== 0) throw new Error(`입력을 못 얼렸다 — ${frozen.stderr.trim()}`);

  const meta = { made: new Date().toISOString(), kit: kitCommit(), install: root, sessions: from, prompts: N, rules, outside };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(`얼림 — ${dir}\n  ${frozen.stdout.trim().replace(/ → .*$/, '')}${outside ? ` · 저장소 밖 경로 ${outside}개는 못 얼림` : ''} · 키트 ${meta.kit}`);
}

// ── 돌리기 ───────────────────────────────────────────────────────────
function run(dir) {
  const meta = json(join(dir, 'meta.json')), skel = join(dir, 'install'), tools = join(skel, '.harness', 'tools');
  // 도구는 설치본 자리(.harness/tools)에 깐다 — 훅 · 도구가 자기 위치로 harness.json 과 기록을 찾는다
  rmSync(tools, { recursive: true, force: true });
  cpSync(TOOLS, tools, { recursive: true });
  const env = { ...process.env };
  delete env.HARNESS_GRAPH_STORE;
  const tmp = mkdtempSync(join(tmpdir(), 'bench-'));
  const s = { dir, meta, out: (name) => join(tmp, name), tool: (name, ...argv) => node(join(tools, name), argv, { cwd: skel, env }) };
  const got = new Map();
  const now = {};
  try {
    for (const m of METRICS) {
      if (!got.has(m.from)) got.set(m.from, m.from(s));
      now[m.key] = m.read(got.get(m.from));
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  const file = join(dir, 'baseline.json'), base = existsSync(file) ? json(file) : null;
  const show = (m, v) => (v === undefined ? '—' : Array.isArray(v) ? `${v.length}개` : `${v}${m.unit}`);
  const notes = [];
  let bad = false;
  console.log(`\n## ${basename(dir)} — 얼린 때 ${meta.made.slice(0, 10)}(키트 ${meta.kit}) · 기준 숫자 ${base ? `${base.made.slice(0, 10)}(키트 ${base.kit})` : '없음'} · 지금 키트 ${kitCommit()}${TOOLS === join(KIT, 'tools') ? '' : ` · 도구 ${TOOLS}`}\n`);
  console.log('| 지표 | 기준 | 지금 | 판정 |\n|---|---|---|---|');
  for (const m of METRICS) {
    const b = base?.metrics[m.key], n = now[m.key];
    let cur = show(m, n), verdict = '';
    if (Array.isArray(n)) {
      const diff = b ? n.filter((x, i) => x.hash !== b[i]?.hash || x.id !== b[i]?.id).map((x) => x.id) : [];
      cur = `${n.length - diff.length}/${n.length}`;
      if (diff.length) { verdict = `다른 입력 ${diff.length}개 — 아래`; notes.push(`${m.name} — 다른 입력 ${diff.length}개: ${diff.join(', ')}`); }
    } else if (b !== undefined && m.judge) verdict = m.judge(b, n) || '';
    bad ||= verdict.startsWith('⛔');
    console.log(`| ${m.name} | ${show(m, b)} | ${cur} | ${verdict} |`);
  }
  if (notes.length) console.log(`\n${notes.join('\n')}`);
  if (!base || accept) {
    writeFileSync(file, JSON.stringify({ made: new Date().toISOString(), kit: kitCommit(), metrics: now }));
    console.log(`\n${base ? '기준 숫자를 덮었다(--accept)' : '기준 숫자를 썼다'}: ${file}`);
    return false;
  }
  return bad;
}

const each = (items, fn) => items.map((x) => { try { return fn(x) ? 1 : 0; } catch (e) { console.error(`⛔ ${x} — ${e.message}`); return 2; } });
if (flag('--snapshot') || all) {
  const installs = all ? readdirSync(all).map((d) => join(all, d)).filter((d) => existsSync(join(d, '.harness', 'harness.json'))) : args;
  if (!installs.length) { console.error('⛔ 얼릴 설치가 없다 — --snapshot <설치 폴더…> | --all <폴더>'); process.exit(1); }
  process.exit(each(installs, snapshot).some(Boolean) ? 1 : 0);
}
if (flag('--run')) {
  const dirs = existsSync(HOME) ? readdirSync(HOME).map((d) => join(HOME, d)).filter((d) => existsSync(join(d, 'meta.json'))) : [];
  if (!dirs.length) { console.error(`⛔ 얼린 설치가 없다: ${HOME} — 먼저 --snapshot`); process.exit(1); }
  const codes = each(dirs, run);
  const worst = Math.max(...codes);
  console.log(worst === 2 ? '\n⛔ 도구가 못 돈 설치가 있다 — 다시 돌린다' : worst ? '\n⛔ 허용폭 밖으로 나빠진 지표가 있다 — 의도한 것이면 --accept' : '\n✅ 허용폭 안');
  process.exit(worst);
}
console.error('사용법: node proof/bench.mjs --snapshot <설치 폴더…> | --all <폴더>  |  --run [--accept] [--tools <도구 폴더>]');
process.exit(1);

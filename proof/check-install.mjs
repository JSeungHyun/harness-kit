#!/usr/bin/env node
// SETUP 종단 실측의 판정 — 설치된 대상을 프로필·모드별 기대와 대조해 표를 낸다. 설계안.
//   node proof/check-install.mjs <대상> <new|existing> <local|share> [--json]
// ⛔ 세션의 자기 보고가 아니라 대상의 파일·git·도구 출력으로만 판정한다. 하나라도 어긋나면 exit 1.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cli } from '../lib/config.mjs';

const sh = (cmd, cwd) => {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', input: '', maxBuffer: 1 << 26 });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const has = (dir, rel) => existsSync(join(dir, rel));
const text = (dir, rel) => (has(dir, rel) ? readFileSync(join(dir, rel), 'utf8') : '');
const jsonOf = (dir, rel) => { try { return JSON.parse(text(dir, rel) || '{}'); } catch { return null; } };
const ignored = (dir, rel) => sh(`git check-ignore -q "${rel}"`, dir).code === 0;
const nameOf = (id) => id.split('@')[0];
const imports = (s) => /^\s*@(\.\/)?AGENTS\.md\b/m.test(s);
const PLACEHOLDER = /<[^>\n!]{1,40}>/;

export function checkInstall(dir, profile, mode) {
  const rows = [];
  const row = (group, what, observed, ok) => rows.push({ group, what, observed: String(observed), ok: Boolean(ok) });
  const cfg = jsonOf(dir, '.harness/harness.json') ?? {};
  const local = mode === 'local';
  const settingsRel = local ? '.claude/settings.local.json' : '.claude/settings.json';
  const settings = jsonOf(dir, settingsRel) ?? {};
  const ledger = local ? '.harness/state' : 'docs/harness';
  const hadAgents = sh('git cat-file -e HEAD:AGENTS.md', dir).code === 0;

  // 공통 — 배치 · 설정 · 플러그인 · 장부 · 그래프
  const tools = ['verify', 'decision-check', 'lesson-append', 'lesson-promote', 'state-check', 'policy-apply', 'install-mode', 'scan-shared',
    'graph-find', 'graph-append', 'graph-alias', 'graph-hook'];
  const missing = tools.filter((t) => !has(dir, `.harness/tools/${t}.mjs`));
  row('공통', '.harness/ 도구 · lib · 정책', missing.length ? `없음: ${missing.join(', ')}` : `도구 ${tools.length}개 · lib · policy`,
    !missing.length && has(dir, '.harness/lib/config.mjs') && has(dir, '.harness/policy/settings.json'));
  row('공통', '규칙 2개 · final-gate 스킬', ['.claude/rules/harness.md', '.claude/rules/graph.md', '.claude/skills/final-gate/SKILL.md'].map((p) => `${p.split('/').pop()} ${has(dir, p) ? '있음' : '없음'}`).join(' · '),
    has(dir, '.claude/rules/harness.md') && has(dir, '.claude/rules/graph.md') && has(dir, '.claude/skills/final-gate/SKILL.md'));
  const left = (text(dir, '.claude/rules/harness.md').match(/<decisions>|<lessons>/g) ?? []).length;
  row('공통', '규칙 자리표시가 남지 않음', `남은 자리 ${left}`, has(dir, '.claude/rules/harness.md') && left === 0);
  row('공통', 'harness.json 검사 1개 이상 · 프로필 · 모드', `검사 ${cfg.checks?.length ?? 0} · profile ${cfg.profile} · mode ${cfg.mode}`,
    cfg.checks?.length >= 1 && cfg.profile === profile && cfg.mode === mode);
  row('공통', `정책 반영 (${settingsRel})`, `ponytail ${settings.env?.PONYTAIL_DEFAULT_MODE ?? '미설정'} · 플러그인 선언 ${Object.keys(settings.enabledPlugins ?? {}).join(', ') || '없음'}`,
    settings.env?.PONYTAIL_DEFAULT_MODE === 'off' && 'ponytail@ponytail' in (settings.enabledPlugins ?? {}));
  const list = sh('claude plugin list --json', dir).out;
  let ids = {};
  try {
    const arr = JSON.parse(list.slice(list.indexOf('['), list.lastIndexOf(']') + 1));
    for (const n of ['superpowers', 'ponytail']) ids[n] = new Set(arr.filter((p) => p.enabled && nameOf(p.id) === n).map((p) => p.id)).size;
  } catch { ids = null; }
  row('공통', '플러그인 id 하나씩', ids ? `superpowers ${ids.superpowers} · ponytail ${ids.ponytail}` : '목록을 읽지 못함', ids && ids.superpowers === 1 && ids.ponytail === 1);
  row('공통', `장부 위치 (${ledger})`, `decisions ${cfg.state?.decisions} · lessons ${cfg.state?.lessons}`,
    cfg.state?.decisions === `${ledger}/decisions.md` && cfg.state?.lessons === `${ledger}/lessons.md` && has(dir, `${ledger}/decisions.md`) && has(dir, `${ledger}/lessons.md`));
  const records = text(dir, '.harness/graph/requests.jsonl').split(/\r?\n/).filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const hook = settings.hooks?.UserPromptSubmit ?? jsonOf(dir, '.claude/settings.json')?.hooks?.UserPromptSubmit ?? jsonOf(dir, '.claude/settings.local.json')?.hooks?.UserPromptSubmit;
  row('공통', '그래프 훅 없음 (20건 미만)', `기록 ${records.length} · 훅 ${hook ? '있음' : '없음'}`, !hook && records.length < 20);
  const chk = sh('node .harness/tools/graph-find.mjs --check', dir);
  row('공통', 'graph-find --check', `exit ${chk.code}`, chk.code === 0);

  // 모드 — git 이 무엇을 보나 · 지시 파일
  if (local) {
    const probes = ['.harness/harness.json', '.claude/rules/harness.md', '.claude/rules/graph.md', '.claude/skills/final-gate/SKILL.md', '.claude/settings.local.json', 'CLAUDE.local.md'];
    const seen = probes.filter((p) => !ignored(dir, p));
    row('로컬', '설치 경로가 무시됨 · settings.json 을 만들지 않음', seen.length ? `보임: ${seen.join(', ')}` : `전부 무시됨 · settings.json ${has(dir, '.claude/settings.json') ? '있음' : '없음'}`,
      !seen.length && !has(dir, '.claude/settings.json'));
    const want = hadAgents ? '@AGENTS.md 한 줄' : '지도 골격';
    const ok = hadAgents ? imports(text(dir, 'CLAUDE.local.md')) : has(dir, 'CLAUDE.local.md') && !PLACEHOLDER.test(text(dir, 'CLAUDE.local.md'));
    row('로컬', `CLAUDE.local.md — ${want} · CLAUDE.md 를 만들지 않음`, `CLAUDE.local.md ${has(dir, 'CLAUDE.local.md') ? (imports(text(dir, 'CLAUDE.local.md')) ? '@AGENTS.md' : '있음') : '없음'}${PLACEHOLDER.test(text(dir, 'CLAUDE.local.md')) ? ' (자리표시 남음)' : ''} · CLAUDE.md ${has(dir, 'CLAUDE.md') ? '있음' : '없음'}`,
      ok && !has(dir, 'CLAUDE.md'));
  } else {
    const probes = ['.harness/harness.json', '.claude/rules/harness.md', '.claude/rules/graph.md', '.claude/skills/final-gate/SKILL.md', '.claude/settings.json', 'AGENTS.md', 'CLAUDE.md', 'docs/harness/decisions.md'];
    const hidden = probes.filter((p) => ignored(dir, p));
    row('공유', '설치 경로가 추적 가능 · settings.local.json 은 무시', hidden.length ? `무시됨: ${hidden.join(', ')}` : '전부 추적 가능',
      !hidden.length && ignored(dir, '.claude/settings.local.json'));
    row('공유', `${hadAgents ? '' : 'AGENTS.md(지도) + '}CLAUDE.md(@AGENTS.md)`, `AGENTS.md ${has(dir, 'AGENTS.md') ? '있음' : '없음'}${!hadAgents && PLACEHOLDER.test(text(dir, 'AGENTS.md')) ? ' (자리표시 남음)' : ''} · CLAUDE.md ${imports(text(dir, 'CLAUDE.md')) ? '@AGENTS.md' : '없음/다름'}`,
      has(dir, 'AGENTS.md') && imports(text(dir, 'CLAUDE.md')) && (hadAgents || !PLACEHOLDER.test(text(dir, 'AGENTS.md'))));
    const hookPath = sh('git rev-parse --git-path hooks/pre-commit', dir).out.trim();
    const pre = existsSync(join(dir, hookPath)) ? readFileSync(join(dir, hookPath), 'utf8') : existsSync(hookPath) ? readFileSync(hookPath, 'utf8') : '';
    row('공유', 'pre-commit 이 scan-shared 를 부른다 · 패턴 파일', `pre-commit ${pre ? (pre.includes('scan-shared.mjs') ? 'scan-shared 호출' : '다른 훅') : '없음'} · scan.json ${has(dir, '.harness/scan.json') ? '있음' : '없음'}`,
      pre.includes('scan-shared.mjs') && has(dir, '.harness/scan.json'));
    const scan = sh('node .harness/tools/scan-shared.mjs', dir);
    row('공유', 'scan-shared exit 0 (소급 기록에 민감 정보 없음)', `exit ${scan.code} · ${(scan.out.match(/민감 정보 패턴[^\n]*/) ?? [scan.out.trim().split(/\r?\n/)[0]])[0]}`, scan.code === 0);
  }

  // 프로필 — 소급 · 기준선 · verify
  const lessonRows = text(dir, cfg.state?.lessons ?? `${ledger}/lessons.md`).split(/\r?\n/).filter((l) => /^\|\s*L\d+\s*\|/.test(l));
  const v = sh('node .harness/tools/verify.mjs', dir);
  const why = (v.out.match(/(?<=— ).*/) ?? [''])[0].trim();
  if (profile === 'new') {
    row('신규', 'lessons 소급 없음', `행 ${lessonRows.length}`, lessonRows.length === 0);
    const seeds = records.filter((r) => /설계 용어/.test(r.note ?? ''));
    const keys = seeds.flatMap((r) => Object.keys(r.terms ?? {})).map((k) => k.replace(/\s+/g, ''));
    row('신규', '그래프 시드 — 스펙 용어 3 · 「설계 용어」 표기', `시드 ${seeds.length} · 용어 ${keys.join(', ') || '없음'}`,
      ['예약금', '픽업슬롯', '꽃다발구성'].every((k) => keys.includes(k)));
    row('신규', 'verify 가 「실행된 테스트가 0개」로 실패', `exit ${v.code} · ${why}`, v.code === 1 && /실행된 테스트가 0개/.test(v.out));
  } else {
    const head = sh('git show HEAD:AGENTS.md', dir);
    row('기존', 'AGENTS.md 내용 그대로', head.code === 0 && head.out === text(dir, 'AGENTS.md') ? '커밋본과 같음' : '바뀜', head.code === 0 && head.out === text(dir, 'AGENTS.md'));
    const base = has(dir, '.harness/baseline') ? readdirSync(join(dir, '.harness', 'baseline')).flatMap((f) => text(dir, `.harness/baseline/${f}`).split(/\r?\n/)).filter((l) => l.trim() && !l.startsWith('#')) : [];
    row('기존', '기준선에 원래 실패 1', `${base.length}건 ${base.join(' · ')}`, base.length === 1 && /옛 반올림 규칙/.test(base[0]));
    row('기존', 'verify exit 0', `exit ${v.code} · ${why}`, v.code === 0 && /기준선 실패 1/.test(why));
    const rooted = lessonRows.filter((l) => (l.split('|')[4] ?? '').trim().length > 5);
    row('기존', 'lessons 소급 ≥ 2 (근본 원인 있음)', `행 ${lessonRows.length} · 근본 원인 ${rooted.length}`, rooted.length >= 2);
    // 기록 단위는 「같은 질문에서 함께 필요한가」(design §6) — 건수가 아니라 인수인계 용어 5개를 주제 기록들이 덮는지 본다
    const HANDOVER = ['주문서', '출고대기', '재고실사', '적립금소멸', '반품회수'];
    const keys = new Set(records.flatMap((r) => (Array.isArray(r.terms) ? [] : Object.keys(r.terms ?? {}))).map((k) => k.replace(/\s+/g, '')));
    const covered = HANDOVER.filter((k) => keys.has(k));
    const filled = records.filter((r) => !Array.isArray(r.terms) && Object.keys(r.terms ?? {}).length);
    row('기존', '그래프 ≥ 3 주제 기록 · 인수인계 용어 ≥ 4/5 · terms 를 채움', `기록 ${records.length} · terms 객체 ${filled.length} · 인수인계 용어 ${covered.length}/5`,
      records.length >= 3 && covered.length >= 4 && filled.length === records.length);
  }
  return rows;
}

cli(import.meta.url, () => {
  const [dir, profile, mode] = process.argv.slice(2);
  if (!dir || !['new', 'existing'].includes(profile) || !['local', 'share'].includes(mode)) {
    console.error('사용법: node proof/check-install.mjs <대상> <new|existing> <local|share> [--json]');
    process.exit(1);
  }
  const rows = checkInstall(dir, profile, mode);
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log(`| 묶음 | 기대 | 관측 | 맞나 |\n|---|---|---|---|`);
    for (const r of rows) console.log(`| ${r.group} | ${r.what} | ${r.observed.replace(/\|/g, '\\|')} | ${r.ok ? '✅' : '⛔'} |`);
  }
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
});

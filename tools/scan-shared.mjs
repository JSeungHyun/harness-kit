#!/usr/bin/env node
// 공유 모드의 커밋 전 검사 — 커밋되는 기록·장부·규칙에 민감 정보 패턴이 있으면 값을 가려 보이고 exit 1. 설계안.
//   node .harness/tools/scan-shared.mjs [대상]     # 패턴은 .harness/scan.json (install-mode share 가 pre-commit 에 건다)
// ponytail: 스테이징본이 아니라 작업 트리를 본다 — 스테이징만 다르게 고친 경우까지 가르려면 git show :<경로> 로 읽는다
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { cli } from '../lib/config.mjs';

const SHARED_DIRS = ['.harness/graph', '.claude/rules'];

function files(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { recursive: true }).map((f) => join(abs, String(f))).filter((f) => statSync(f).isFile());
}

const mask = (s) => `${s.slice(0, 2)}${'*'.repeat(Math.min(Math.max(s.length - 2, 3), 12))}`;

export function scanShared(target) {
  const root = resolve(target);
  const cfgPath = join(root, '.harness', 'scan.json');
  if (!existsSync(cfgPath)) throw new Error(`패턴 파일이 없다: ${cfgPath} — <kit>/templates/scan.json 을 복사하고 프로젝트에 맞게 고친다`);
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const compiled = (cfg.patterns ?? []).map((p) => {
    try {
      return { id: p.id, re: new RegExp(p.re, `${(p.flags ?? '').replace(/g/g, '')}g`) };
    } catch (e) {
      throw new Error(`패턴 '${p.id}' 이 정규식이 아니다: ${e.message}`);
    }
  });
  let state = {};
  try { state = JSON.parse(readFileSync(join(root, '.harness', 'harness.json'), 'utf8')).state ?? {}; } catch { /* 장부 경로 없이 기록·규칙만 본다 */ }
  const targets = [...new Set([...SHARED_DIRS, ...Object.values(state).filter((v) => typeof v === 'string')].flatMap((rel) => files(root, rel)))];

  const hits = [];
  for (const f of targets) {
    readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      for (const { id, re } of compiled) for (const m of line.matchAll(re)) hits.push({ file: relative(root, f), line: i + 1, id, value: mask(m[0]) });
    });
  }
  return { patterns: compiled.length, files: targets.length, hits, reviewed: cfg.reviewed === true };
}

cli(import.meta.url, () => {
  const r = scanShared(process.argv[2] ?? process.cwd());
  for (const h of r.hits) console.log(`⛔ ${h.file}:${h.line} [${h.id}] ${h.value}`);
  // 기본 패턴은 프로젝트 형식을 모른다 — 맞추기 전에는 「걸린 것 0」이 안전하다는 뜻이 아니다. exit 는 걸린 것으로만 정한다
  if (!r.reviewed) console.log('⚠️ 기본 패턴 그대로다 — 이 프로젝트의 사번 · 내부 호스트 · 이슈 형식에 맞춘 뒤 reviewed: true');
  console.log(`민감 정보 패턴 ${r.patterns}종 · 파일 ${r.files}개 · 걸린 것 ${r.hits.length}`);
  if (r.hits.length) {
    console.log('⇒ 값을 역할·성격으로 바꿔 적는다(사람은 역할로, 이슈는 번호 없이 요지로). 오탐이면 .harness/scan.json 의 패턴을 고친다');
    process.exit(1);
  }
});

// 대상 저장소의 .harness/harness.json 로더 — 모든 도구의 유일한 경로 원천. 설계안.
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

export const CONFIG = join('.harness', 'harness.json');
export const EVIDENCE_KINDS = ['junit-xml', 'exit-code', 'file-unchanged', 'output-match'];

const expand = (p) => (p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

export function loadConfig(root) {
  const path = join(root, CONFIG);
  if (!existsSync(path)) {
    throw new Error(`harness.json 이 없다: ${path}\n  SETUP.md 를 먼저 따른다.`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`harness.json 을 읽지 못했다: ${path}\n  ${e.message}`);
  }
  for (const c of raw.checks ?? []) {
    if (!EVIDENCE_KINDS.includes(c.kind)) {
      throw new Error(`알 수 없는 검사 종류: ${c.kind} (검사 '${c.id}')\n  쓸 수 있는 것: ${EVIDENCE_KINDS.join(' · ')}`);
    }
    if (c.kind === 'output-match') {
      if (typeof c.expect !== 'string' || !c.expect) throw new Error(`검사 '${c.id}' 에 expect 가 없다 — output-match 는 stdout 과 맞출 정규식이 있어야 한다`);
      try {
        new RegExp(c.expect, 'm');
      } catch (e) {
        throw new Error(`검사 '${c.id}' 의 expect 가 정규식이 아니다: ${e.message}`);
      }
    } else if (c.kind !== 'exit-code' && !c.evidence) {
      throw new Error(`검사 '${c.id}' 에 evidence 가 없다 — ${c.kind} 는 판정할 결과 파일이 있어야 한다`);
    }
  }
  const abs = (p) => (p ? resolve(root, expand(p)) : undefined);
  return {
    root: resolve(root),
    state: {
      current: abs(raw.state?.current),
      currentRoot: abs(raw.state?.currentRoot),
      decisions: abs(raw.state?.decisions),
      lessons: abs(raw.state?.lessons),
    },
    checks: (raw.checks ?? []).map((c) => ({ ...c, evidence: abs(c.evidence) })),
  };
}

// 직접 실행됐을 때만 main 을 돈다. 오류는 한 줄로 알리고 exit 1.
// ⛔ `file://${argv[1]}` 비교는 Windows·심링크 경로에서 늘 거짓이라 도구가 조용히 아무것도 안 하고 exit 0 이 된다.
export async function cli(url, main) {
  if (!process.argv[1] || url !== pathToFileURL(realpathSync(process.argv[1])).href) return;
  try {
    await main();
  } catch (e) {
    console.error(`⛔ ${e.message}`);
    process.exit(1);
  }
}

// 마크다운 표 — 칸 분리, 대장 행 파서, 줄바꿈에 흔들리지 않는 해시. 설계안.
import { createHash } from 'node:crypto';

// 표 한 줄의 칸. 값 안의 \| 는 구분자가 아니다
export function cells(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  return t
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((s) => s.trim());
}

// | `경로` | 상태 | `해시` | … — 상태 설명표(| `분석완료` | 뜻 |)는 셋째 칸이 백틱 해시가 아니라 걸리지 않는다
export function parseAuditRows(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const c = cells(line);
    if (!c || c.length < 3) continue;
    const target = c[0].match(/^`([^`]+)`$/);
    const hash = c[2].match(/^`([^`]*)`$/);
    if (target && hash) rows.push({ target: target[1], status: c[1], hash: hash[1] });
  }
  return rows;
}

// CRLF 를 LF 로 맞춰 해시한다 — OS 마다 체크아웃 줄바꿈이 달라도 같은 파일은 같은 해시
export const hash12 = (bytes) =>
  createHash('sha256')
    .update(Buffer.from(Buffer.from(bytes).toString('latin1').replace(/\r\n/g, '\n'), 'latin1'))
    .digest('hex')
    .slice(0, 12);

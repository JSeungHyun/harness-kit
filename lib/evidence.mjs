// ⑤ 증거 판정 — 종료코드도 러너 요약도 믿지 않고 결과 XML 의 <testcase> 를 하나씩 센다. 설계안.
// 실측(Node 24): node --test 는 test() 가 없는 파일을 파일 경로 이름의 통과 testcase 로 보고한다.

const ATTRS = String.raw`(?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*`;
const CASE = new RegExp(String.raw`<testcase\b(${ATTRS})\s*(?:\/>|>([\s\S]*?)<\/testcase>)`, 'g');
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unxml = (s) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(Number(e[1].toLowerCase() === 'x' ? `0${e.slice(1)}` : e.slice(1))) : ENT[e] ?? m);

function attr(attrs, name) {
  const m = attrs.match(new RegExp(String.raw`\s${name}\s*=\s*(?:"([^"]*)"|'([^']*)')`));
  return m ? (m[1] ?? m[2]) : undefined;
}

const slash = (p) => p.replace(/\\/g, '/');

function isFileStub(attrs) {
  const name = attr(attrs, 'name');
  const file = attr(attrs, 'file');
  return Boolean(name && file && /\.[cm]?[jt]sx?$/.test(name) && slash(file).endsWith(slash(name)));
}

// 기준선 키 — 한 줄에 하나, verify --baseline 이 쓰고 사람이 읽는다
export const caseKey = (attrs) => `${unxml(attr(attrs, 'classname') ?? '')}::${unxml(attr(attrs, 'name') ?? '')}`;

// known: 알려진 실패 기준선(Set<"classname::name">). 기준선 안의 실패는 실패로 치지 않고 개수만 보고한다
export function judgeJunitXml(contents, { known = new Set() } = {}) {
  let xmls = 0;
  let run = 0;
  let skipped = 0;
  let stubs = 0;
  let knownFailed = 0;
  const failedKeys = [];
  const passed = new Set();

  for (const text of contents) {
    if (!/<testsuites?\b|<testcase\b/.test(text)) continue;
    xmls += 1;
    for (const [, attrs, body = ''] of text.matchAll(CASE)) {
      const bad = /<(failure|error)\b/.test(body);
      if (!bad && isFileStub(attrs)) stubs += 1;
      else if (!bad && /<skipped\b/.test(body)) skipped += 1;
      else {
        run += 1;
        const key = caseKey(attrs);
        if (!bad) passed.add(key);
        else if (known.has(key)) knownFailed += 1;
        else failedKeys.push(key);
      }
    }
  }

  const fixed = [...known].filter((k) => passed.has(k));
  const facts = { run, failedKeys, knownFailed, fixed };
  const notes = [skipped && `건너뜀 ${skipped}`, stubs && `테스트 없는 파일 ${stubs}개는 세지 않았다`].filter(Boolean);
  const tail = notes.map((n) => ` · ${n}`).join('');

  if (xmls === 0) return { ok: false, reason: '결과 XML 을 한 개도 찾지 못했다 — 테스트가 돌지 않았다', ...facts };
  if (run === 0) {
    return { ok: false, reason: `실행된 테스트가 0개다 (XML ${xmls}개${tail}) — 종료코드와 러너 요약은 이것을 통과시킨다`, ...facts };
  }
  const out = failedKeys.length;
  const counts = `테스트 ${run} · 실패 ${out}${out && known.size ? ' (기준선 밖)' : ''}${knownFailed ? ` · 기준선 실패 ${knownFailed}` : ''}`;
  const hint = fixed.length ? ` · 기준선에서 통과 ${fixed.length} — 기준선을 줄인다 (verify --baseline)` : '';
  return { ok: out === 0, reason: `${counts}${tail}${hint}`, ...facts };
}

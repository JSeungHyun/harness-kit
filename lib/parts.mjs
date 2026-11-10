// 설치본의 세 갈래 — 갱신 · 이식 검사 · SETUP 이 이 한 곳을 쓴다. 이 밖의 자리에 생긴 차이는 이식 검사가 ⛔ 로 잡는다(test/install-check). 설계안.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KIT = fileURLToPath(new URL('..', import.meta.url));
// 갱신이 설치본에 얹는 키트 경로 — 이 밖(문서 · 테스트)만 바뀐 커밋은 설치본에 차이가 없다. templates 는 규칙 · 스킬로 깔린다
export const SHIPPED = ['lib', 'tools', 'policy', 'templates'];
export const COPIED = ['lib', 'tools', 'policy'];
// [키트 템플릿, 설치 위치, 프로젝트 규칙 파일 이름]
export const DOCS = [
  ['templates/rules/harness.md', '.claude/rules/harness.md', 'harness'],
  ['templates/rules/graph.md', '.claude/rules/graph.md', 'graph'],
  ['templates/skills/final-gate/SKILL.md', '.claude/skills/final-gate/SKILL.md', 'final-gate'],
];
export const INSTRUCTIONS = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md'];

// 프로젝트 몫 두 갈래 — 이식 검사 「프로젝트 맞춤」 절 머리에 그대로 나간다. 키트 소유는 partOf 가 정한다
export const PARTS = {
  config: '프로젝트 설정 — harness.json(검사의 명령 · kind · covers · 처방 · why · 테스트 없음 · graph.names · graph.store · graph.rules · 장부 경로) · scan.json(공유 모드 민감 정보 패턴) · 지시 파일 본문 · .claude/rules/project-*.md · 설정 파일(키트 몫은 ④): 모양과 출처만(⑤)',
  data: '프로젝트 데이터 — 그래프 기록(graph.store) · 장부 본문 · 기준선(.harness/baseline): 멀쩡한가만(⑧), 내용은 보지 않는다',
};

// 키트가 .harness 에 얹는 파일 — 키트 저장소 기준 경로
export const kitFiles = () => COPIED.flatMap((d) => readdirSync(join(KIT, d), { recursive: true }).map((f) => `${d}/${f.replace(/\\/g, '/')}`))
  .filter((f) => statSync(join(KIT, f)).isFile());

// harness.json graph — 프로젝트별 값은 기록 위치(store) · 기록 규칙 자리(rules) · 이름(names)뿐이고 도구는 늘 .harness/tools 한 벌이다.
// tools 가 다른 값이면 13차 전 「자기 그래프」 설치 — --migrate-graph 로 옮긴다. 그 기록은 <tools>/graph/requests.jsonl 에 있다
export const graphOf = (raw) => {
  const g = { tools: '.harness/tools', rules: '`.claude/rules/graph.md`', ...raw.graph };
  return { store: g.tools === '.harness/tools' ? '.harness/graph/requests.jsonl' : `${g.tools}/graph/requests.jsonl`, ...g };
};

// 설치본 경로(/ 구분) 하나의 갈래 — kit(.harness 의 키트 파일 · 규칙 · final-gate · kit-commit — ① ② ③ ⑨ 가 같은지 본다) · config · data. 키트가 얹지 않은 프로젝트 파일은 null
export function partOf(rel, raw) {
  if (rel === graphOf(raw).store || Object.values(raw.state ?? {}).includes(rel) || rel.startsWith('.harness/baseline/')) return 'data';
  if (['.harness/harness.json', '.harness/scan.json', ...INSTRUCTIONS, '.claude/settings.json', '.claude/settings.local.json'].includes(rel) || /^\.claude\/rules\/project-[^/]+\.md$/.test(rel)) return 'config';
  if (rel === '.harness/kit-commit' || DOCS.some(([, dst]) => dst === rel) || (rel.startsWith('.harness/') && kitFiles().includes(rel.slice('.harness/'.length)))) return 'kit';
  return null;
}

// 장치 장부(docs/devices.md) — 키트가 설치에 얹는 장치마다 근거 · 측정일 · 걷기 조건이 한 행. 장치를 더하거나 지우면 장부도 같이 바뀌어야 한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { repoFile } from './scene.mjs';

const ls = (dir) => readdirSync(new URL(`../${dir}`, import.meta.url)).map((f) => `${dir}/${f}`);

// 장치 하나 = 키 묶음. 훅은 정책 파일과 그것이 띄우는 도구가 한 장치다
function devices() {
  const hooks = ls('policy').flatMap((p) => {
    const groups = Object.values(JSON.parse(repoFile(p)).hooks ?? {}).flat();
    return groups.length ? [[p, `tools/${groups[0].hooks[0].args[0].split('/').pop()}`]] : [];
  });
  const hookTools = hooks.map(([, tool]) => tool);
  return [
    ...hooks,
    ...ls('tools').filter((t) => t.endsWith('.mjs') && !hookTools.includes(t)).map((t) => [t]),
    ...ls('templates/rules').flatMap((r) => [...repoFile(r).matchAll(/^## (.+)$/gm)].map((m) => [`${r}#${m[1].split(' — ')[0]}`])),
    ...ls('templates/skills').map((s) => [`${s}/SKILL.md`]),
    ...Object.keys(JSON.parse(repoFile('policy/settings.json')).permissions).map((k) => [`policy/settings.json#${k}`]),
    ...ls('templates/state').map((s) => [s]),
  ];
}

// 장부 행 = 첫 칸에 `tools/…` · `policy/…` · `templates/…` 키가 있는 표 줄
const rows = () => repoFile('docs/devices.md').split(/\r?\n/).filter((l) => l.startsWith('|')).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
  .map((cells) => ({ cells, keys: [...cells[0].matchAll(/`((?:tools|policy|templates)\/[^`]+)`/g)].map((m) => m[1]) }))
  .filter((r) => r.keys.length);

const names = (list) => list.map((keys) => [...keys].sort().join(' + ')).sort();

test('장부 행 = 키트가 얹는 장치 — 빠진 장치도, 파일 · 절이 없는 행도 없다', () => {
  assert.deepEqual(names(rows().map((r) => r.keys)), names(devices()));
});

test('행마다 일곱 칸(장치 · 강제 방식 · 근거 지표 · 마지막 측정일 · 잰 모델 · 질문당 비용 · 걷기 조건)이 차 있다', () => {
  const bad = rows().filter((r) => r.cells.length !== 7 || r.cells.some((c) => !c)).map((r) => r.cells[0]);
  assert.deepEqual(bad, []);
});

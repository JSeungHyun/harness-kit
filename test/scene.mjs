import { after } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 이 테스트 파일이 만든 임시 폴더 — 파일이 끝나면 지운다. 안 지우면 npm test 한 번에 ~150개씩 쌓인다
const made = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});
export function tmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

// 테스트용 임시 대상 저장소. harness 객체를 주면 .harness/harness.json 을 쓴다.
export function target(harness, files = {}) {
  const dir = tmp('harness-');
  if (harness) put(dir, '.harness/harness.json', JSON.stringify(harness));
  for (const [rel, body] of Object.entries(files)) put(dir, rel, body);
  return dir;
}

export function put(dir, rel, body) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
}

// 이 PC 의 전역 git 설정에 흔들리지 않는 저장소. globalIgnore 를 주면 그것이 전역 무시 파일이 된다
export function gitRepo(files = {}, { commits = 1, globalIgnore } = {}) {
  const dir = target(null, files);
  const home = tmp('gitcfg-');
  const config = join(home, 'gitconfig');
  const ignore = join(home, 'ignore').replace(/\\/g, '/');
  writeFileSync(config, globalIgnore ? `[core]\n\texcludesfile = ${ignore}\n` : '');
  if (globalIgnore) writeFileSync(ignore, globalIgnore);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', XDG_CONFIG_HOME: home };
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, env, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  for (let i = 0; i < commits; i++) {
    if (i === 0) git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', `커밋 ${i + 1}`);
  }
  return { dir, env, git };
}

// 설치된 그래프 — .harness/tools 에 키트 그래프 도구 · .harness/harness.json 의 graph 설정 · 기록은 graph.store(없으면 .harness/graph).
// 줄은 객체(날짜 · files 기본값을 채운다) 또는 원문 문자열(깨진 줄). 환경변수 없이 도구가 설정을 따른다
export function graphInstall(graph, lines = [], name = 'shop-web') {
  const dir = join(tmp('graph-'), name);
  const tools = fileURLToPath(new URL('../tools/', import.meta.url));
  mkdirSync(join(dir, '.harness', 'tools'), { recursive: true });
  for (const f of readdirSync(tools).filter((n) => n.startsWith('graph-'))) cpSync(join(tools, f), join(dir, '.harness', 'tools', f));
  if (graph) put(dir, '.harness/harness.json', JSON.stringify({ graph }));
  const rel = graph?.store ?? '.harness/graph/requests.jsonl';
  put(dir, rel, lines.map((l) => `${typeof l === 'string' ? l : JSON.stringify({ date: '2026-09-01', recorded: '2026-09-01', files: [], ...l })}\n`).join(''));
  const env = { ...process.env };
  delete env.HARNESS_GRAPH_STORE;
  const run = (tool, args = [], input = '', cwd = dir) => spawnSync(process.execPath, [join(dir, '.harness', 'tools', `${tool}.mjs`), ...args], { cwd, input, env, encoding: 'utf8' });
  return { dir, store: join(dir, rel), run, env };
}

export const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
export const repoFile = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { gitRepo, repoFile } from './scene.mjs';

const TOOL = fileURLToPath(new URL('../tools/mybatis-xml.mjs', import.meta.url));
const DETECT = fileURLToPath(new URL('../tools/detect.mjs', import.meta.url));
const javaBin = (n) => (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', n) : n);
const NO_JDK = spawnSync(javaBin('javac'), ['-version']).status !== 0 && 'JDK(javac) 없음';

// 합성 DTD — 매퍼 jar 의 org/apache/ibatis/builder/xml/ 자리에 둔다(폴더도 클래스패스다)
const DTD = `<!ELEMENT mapper (select | insert)*>
<!ATTLIST mapper namespace CDATA #IMPLIED>
<!ELEMENT select (#PCDATA)>
<!ATTLIST select id CDATA #REQUIRED resultType CDATA #IMPLIED>
<!ELEMENT insert (#PCDATA)>
<!ATTLIST insert id CDATA #REQUIRED>
`;
const mapper = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="shop.OrderDao">
${body}
</mapper>
`;
const OK = mapper('  <select id="find" resultType="map"><![CDATA[ SELECT * FROM orders WHERE amount < 10 ]]></select>');
const BROKEN = {
  'unclosed.xml': mapper('  <select id="find">SELECT 1'),
  'typo.xml': mapper('  <selcet id="find">SELECT 1</selcet>'),
  'bare-lt.xml': mapper('  <select id="find">SELECT 1 WHERE a < 1</select>'),
  'bare-amp.xml': mapper('  <select id="find">SELECT 1 WHERE a = 1 & b = 2</select>'),
  'no-id.xml': mapper('  <select resultType="map">SELECT 1</select>'),
};
const repo = (files) => gitRepo({ 'lib/org/apache/ibatis/builder/xml/mybatis-3-mapper.dtd': DTD, ...files }).dir;
const run = (dir, ...args) => spawnSync(process.execPath, [TOOL, '--jar', 'lib', ...args], { cwd: dir, encoding: 'utf8' });

// JVM 을 띄우는 실행은 한 번만 — 병렬로 도는 다른 시험의 프로세스 생성이 이 PC 에서 spawn EPERM 으로 깨졌다(4회: 전체 4번 중 3번 · 2회: 3번 중 1번)
test('⛔ 매퍼 오류 5종(닫는 태그 삭제 · 요소 이름 오타 · CDATA 밖 맨 < · 맨 & · 필수 속성 누락)을 잡고 — 정상 매퍼 · 다른 XML · --skip 한 템플릿은 보지 않는다', { skip: NO_JDK }, () => {
  const files = { 'src/OrderDao.xml': OK, 'pom.xml': '<project><broken></project>', 'gen/template/Dao.xml': mapper('[#SELECT#]') };
  for (const [f, s] of Object.entries(BROKEN)) files[`src/${f}`] = s;
  const r = run(repo(files), '--skip', '**/template/**');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  for (const f of Object.keys(BROKEN)) assert.match(r.stdout, new RegExp(`^src/${f.replace('.', '\\.')}:\\d+: `, 'm'), f);
  assert.doesNotMatch(r.stdout, /OrderDao|pom\.xml|template/);
  assert.match(r.stdout, /⛔ MyBatis XML 6개 — 오류 5$/m);
});

test('⛔ 검사한 파일이 0개 · jar 가 없으면 exit 1 — 조용한 통과가 아니다', () => {
  const none = run(repo({ 'pom.xml': '<project/>' }));
  assert.equal(none.status, 1);
  assert.match(none.stdout + none.stderr, /0개/);
  const noJar = spawnSync(process.execPath, [TOOL, '--jar', 'no/such.jar'], { cwd: repo({ 'src/OrderDao.xml': OK }), encoding: 'utf8' });
  assert.equal(noJar.status, 1);
  assert.match(noJar.stdout + noJar.stderr, /jar 없음/);
});

test('처방 mybatis-xml — 후보 · 이 도구를 부른다 · covers 없음(SQL 의미는 못 본다) · detect 는 MyBatis DOCTYPE XML 이 추적될 때만 낸다', () => {
  const r = JSON.parse(repoFile('policy/recipes.json')).find((x) => x.id === 'mybatis-xml');
  assert.equal(r.status, '후보');
  assert.match(r.checks[0].cmd, /^node \.harness\/tools\/mybatis-xml\.mjs --jar </);
  assert.ok(!('covers' in r.checks[0]));
  const ids = (dir) => JSON.parse(spawnSync(process.execPath, [DETECT, dir, '--json'], { encoding: 'utf8' }).stdout).recipes.map((x) => x.id);
  assert.ok(ids(repo({ 'src/OrderDao.xml': OK })).includes('mybatis-xml'));
  assert.ok(!ids(repo({ 'src/beans.xml': '<beans/>' })).includes('mybatis-xml'));
});

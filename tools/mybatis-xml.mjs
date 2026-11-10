#!/usr/bin/env node
// MyBatis XML 검사 — DOCTYPE 이 MyBatis 인 추적 XML 을 프로젝트 jar 안 DTD 로 검증한다(형식 · 요소 · 필수 속성). SQL 의미 · id 중복 · resultMap 참조는 못 본다. 설계안.
//   node .harness/tools/mybatis-xml.mjs --jar <mybatis jar> [--skip <glob>]…
// JDK 판(8 · 11 · 17 · 21 …)마다 실행 방법이 달라 javac + java 한 길로 간다 — JAVA_HOME 이 있으면 그 bin, 없으면 PATH.

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, posix } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cli } from '../lib/config.mjs';

const MYBATIS = /<!DOCTYPE[^>]*mybatis\.org\/dtd/;
const JAVA = `import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import javax.xml.parsers.*;
import org.xml.sax.*;

public class MybatisXmlCheck {
  public static void main(String[] a) throws Exception {
    PrintStream out = new PrintStream(System.out, true, "UTF-8");
    final ClassLoader jar = new URLClassLoader(new URL[] { new File(a[0]).toURI().toURL() }, null);
    DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
    f.setValidating(true);
    DocumentBuilder b = f.newDocumentBuilder();
    b.setEntityResolver(new EntityResolver() {
      public InputSource resolveEntity(String pub, String sys) throws IOException {
        InputStream in = jar.getResourceAsStream("org/apache/ibatis/builder/xml/" + sys.substring(sys.lastIndexOf('/') + 1));
        if (in == null) throw new IOException("DTD not in jar: " + sys);
        return new InputSource(in);
      }
    });
    b.setErrorHandler(new ErrorHandler() {
      public void warning(SAXParseException e) {}
      public void error(SAXParseException e) throws SAXException { throw e; }
      public void fatalError(SAXParseException e) throws SAXException { throw e; }
    });
    int bad = 0;
    for (String file : Files.readAllLines(Paths.get(a[1]), StandardCharsets.UTF_8)) {
      try { b.parse(new File(file)); }
      catch (SAXParseException e) { bad++; out.println(file + ":" + e.getLineNumber() + ": " + e.getMessage()); }
      catch (Exception e) { bad++; out.println(file + ":0: " + e); }
    }
    System.exit(bad > 0 ? 1 : 0);
  }
}
`;

// 추적되는 XML 중 DOCTYPE 이 MyBatis 인 것 — detect 의 처방 단서도 이것을 쓴다
export function mybatisFiles(dir, skip = []) {
  const r = spawnSync('git', ['ls-files', '-z', '--', '*.xml'], { cwd: dir, encoding: 'utf8' });
  return (r.stdout ?? '').split('\0').filter((f) => f && !skip.some((g) => posix.matchesGlob(f, g)))
    .filter((f) => existsSync(join(dir, f)) && MYBATIS.test(readFileSync(join(dir, f), 'utf8')));
}

export function checkMybatis(dir, { jar, skip = [] }) {
  const files = mybatisFiles(dir, skip);
  if (!files.length) return { code: 1, out: '⛔ MyBatis XML 0개 — 검사한 것이 없다(--skip · 실행 폴더를 본다)' };
  const lib = resolve(dir, String(jar ?? '').replace(/^~(?=[\\/])/, homedir()));
  if (!jar || !existsSync(lib)) return { code: 1, out: `⛔ jar 없음: ${jar ? lib : '--jar 를 준다'}` };
  const bin = (name) => (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name) : name);
  const tmp = mkdtempSync(join(tmpdir(), 'mybatis-xml-'));
  try {
    writeFileSync(join(tmp, 'MybatisXmlCheck.java'), JAVA);
    writeFileSync(join(tmp, 'files.txt'), files.join('\n'));
    const c = spawnSync(bin('javac'), ['-d', tmp, join(tmp, 'MybatisXmlCheck.java')], { encoding: 'utf8' });
    if (c.status !== 0) return { code: 1, out: `⛔ javac 를 못 돌렸다(JAVA_HOME 또는 PATH 의 JDK) — ${c.error?.message ?? c.stderr.trim()}` };
    const r = spawnSync(bin('java'), ['-Duser.language=en', '-cp', tmp, 'MybatisXmlCheck', lib, join(tmp, 'files.txt')], { cwd: dir, encoding: 'utf8' });
    const bad = (r.stdout ?? '').split(/\r?\n/).filter(Boolean);
    if (r.status !== 0 && !bad.length) return { code: 1, out: `⛔ java 실패 — ${r.error?.message ?? r.stderr.trim()}` };
    return { code: bad.length ? 1 : 0, out: [...bad, `${bad.length ? '⛔' : '✅'} MyBatis XML ${files.length}개 — 오류 ${bad.length}`].join('\n') };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

cli(import.meta.url, () => {
  const args = process.argv.slice(2);
  const opt = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
  const r = checkMybatis(process.cwd(), { jar: opt('--jar')[0], skip: opt('--skip') });
  console.log(r.out);
  process.exit(r.code);
});

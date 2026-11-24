# 하네스 — 증거와 기록

> 상태: **설계안** · harness-kit 이 설치했다. 도구는 `.harness/tools/`, 설정은 `.harness/harness.json`

⭐ **코드를 바꾼 작업은 완료를 주장하기 전에 `node .harness/tools/verify.mjs`** · 검사가 덮지 않은 코드 변경이면 `/code-review`

⚠️ 이 프로젝트의 지시 파일(`AGENTS.md` · `CLAUDE.md` 등)이 흐름 · 계획 문서 · ponytail 모드 · 플러그인을 따로 정했으면 그쪽을 따른다 — 이 파일이 더하는 것은 완료 증거다.

- 서브에이전트는 동시에 둘 넘게 안 띄운다 — superpowers 의 「과제마다 리뷰어 둘」 · 병렬 디스패치는 쓰지 않는다

## 완료는 증거로 주장한다

종료코드 0 · `BUILD SUCCESSFUL` · 러너의 `pass` 요약으로 통과를 주장하지 않는다 — 테스트가 0개여도 그렇게 나온다. `verify` 는 이번 실행이 쓴 결과 파일로 판정한다(알려진 실패 기준선은 개수만).

⛔ `node .harness/tools/verify.mjs --baseline` 은 사용자가 「원래 있던 실패」라고 확인한 뒤에만 — 실패를 기준선에 넣으면 더 울리지 않는다.


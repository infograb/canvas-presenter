# 기여 안내

기여해 주셔서 감사합니다. 이 문서 하나로 개발 환경, 무엇을 고치면 무엇을 다시 만들어야 하는지, 무엇을 깨뜨리면 안 되는지, 어떻게 검증하는지를 모두 다룹니다. 참여자는 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)를 따릅니다.

- 보안 취약점은 공개 이슈 대신 [SECURITY.md](SECURITY.md)의 비공개 경로로 신고합니다.
- manifest나 CLI 계약을 바꾸는 변경은 구현 전에 이슈에서 합의합니다.
- 고객 자료, 내부 URL, 토큰, 개인 식별 정보는 커밋하지 않습니다.

## 5분 안에 돌려 보기

Node.js 20 이상이면 됩니다. 브라우저 QA와 예제 포스터 재생성에만 Chromium 계열 브라우저가 더 필요하고, 자동 탐색이 실패하면 `BROWSER_BIN`을 지정합니다.

```bash
npm ci --ignore-scripts
npm run verify
node scripts/canvas.mjs build assets/examples/grouped.json --out /tmp/demo
node scripts/canvas.mjs serve /tmp/demo --port auto
```

## 무엇을 고치면 무엇이 다시 만들어지는가

| 고치는 것 | 파일 | 다시 만들 것 |
|---|---|---|
| 매니페스트 계약, 검증, 레이아웃 | `scripts/core.mjs` | `npm test`, 예제 출력 |
| CLI 동작 | `scripts/canvas.mjs` | `npm test` |
| 발표 화면 | `assets/runtime/player.jsx`, `assets/runtime/theme.css` | `npm run build:runtime` |
| 계약 문서 | `references/schema.md` | 없음 |
| 예제 | `assets/examples/` | 예제 출력, `npm run build:site` |

`assets/runtime/player.js`, `assets/runtime/player.css`, `assets/runtime/THIRD-PARTY-NOTICES.txt`는 **생성물이지만 커밋합니다.** 직접 편집하지 않고 `npm run build:runtime`으로 다시 만들어 같은 커밋에 넣습니다. 사용자가 npm 설치 없이 `scripts/canvas.mjs`만으로 발표물을 만들 수 있어야 하기 때문입니다.

## 검사

pull request 전에 실행합니다.

```bash
npm run verify          # test + validate:examples + version:check + audit:repo
npm run check:generated # 커밋된 번들이 소스와 일치하는지
npm run build:site      # GitHub Pages용 세 예제
```

| 명령 | 범위 |
|---|---|
| `npm test` | 컴파일러·CLI 회귀. 경로 이탈, 외부 참조, 출력 보호, 인라인 소유권, 포트 선택 |
| `npm run validate:examples` | 세 예제 매니페스트와 모든 자산이 경고 0으로 컴파일되는지 |
| `npm run version:check` | package, lockfile, CHANGELOG 버전 일치 |
| `npm run audit:repo` | 필수 문서, 상대 링크, 내부 경로·비밀 패턴, 런타임 라이선스 고지 |
| `npm run check:generated` | 커밋된 런타임 번들이 소스와 일치하는지. 작업 트리를 바꾸지 않습니다 |

브라우저 동작을 바꿨다면 `assets/runtime/browser-qa.mjs`의 해당 시나리오도 같은 PR에서 고칩니다. 실행하지 못한 브라우저나 전체화면 동작을 통과했다고 기록하지 않습니다.

```bash
node assets/runtime/browser-qa.mjs http://127.0.0.1:4177 <qa-out> <demo-root>
```

## 깨뜨리면 안 되는 것

### 계약

1. 원본 슬라이드의 문구·비율·미디어를 바꾸지 않습니다. 변환이 필요하면 `inline`처럼 **사본**을 만듭니다.
2. 정보 위계(`canvas.children`), 공간 배치(`layout`), 발표 순서(`paths`)는 서로 독립입니다. 하나로 합치지 않습니다.
3. `paths[].steps[].target`에는 슬라이드 ID만 들어갑니다.
4. 오류나 지원하지 않는 입력을 조용히 고치거나 삭제하지 않습니다. 실패는 실패로 보고합니다.
5. 기능을 한 예제에만 적용하지 않고 적용 가능한 세 예제를 함께 갱신합니다.

### 보안과 출력 보호

6. HTML의 CSP, sandbox, 외부 네트워크 차단을 약화하는 변경에는 위협 모델과 회귀 테스트가 필요합니다. 신뢰 경계는 [SECURITY.md](SECURITY.md)에 있습니다.
6-1. 마크업과 CSS를 **정규식으로 훑지 않습니다.** `core.mjs`의 `tokenizeMarkup`과 `scanCss`가 유일한 읽기 경로이고, 다시 쓸 때도 토큰과 위치로만 바꿉니다. 정규식 하나를 더 얹어 예외를 막으려는 변경은 근본 원인을 되돌리는 것입니다.
6-2. CSP meta는 `<head>` 안, 실행 가능한 내용보다 앞에 놓입니다. 둘 다 만족시킬 수 없는 문서는 통과시키지 않고 거부합니다.
6-3. 인라인하면 의미가 달라지는 것은 조용히 바꾸지 않고 거부합니다. 외부 스크립트의 `defer`·`async`, 스타일시트의 `media`가 그렇습니다.
7. SVG의 외부 참조는 계속 거부합니다. 우회로는 `inline`이 만드는 사본이며, 원본을 조용히 고치는 경로를 추가하지 않습니다.
8. `build`와 `inline`의 `--force`는 **자기가 만든 것만** 교체합니다. `build`는 다섯 파일 화이트리스트, `inline`은 마커에 기록한 파일 목록으로 판정하고, 목록에 없는 파일이 하나라도 있으면 거부합니다.
9. 교체는 `임시 폴더 생성 → 기존 폴더를 옆으로 rename → 임시를 제자리로 rename → 옆 폴더 삭제` 순서입니다. 목적지를 먼저 지우지 않습니다.

### 발표 화면

10. 발표 화면은 슬라이드 쇼 하나입니다. 별도의 발표 모드를 다시 만들지 않습니다.
11. 슬라이드 쇼는 레이아웃 행을 차지하는 하단 막대를 두지 않습니다. 막대는 슬라이드 위에 겹치는 요소이며 진행 번호와 종료, HTML일 때의 직접 조작만 담습니다.
12. 레이저와 강조 상자는 도구 선택 없이 포인터 제스처로만 갈립니다. 도구 버튼을 만들지 않습니다. 움직임은 레이저, 8px 넘는 끌기는 상자, 끌지 않은 누름은 상자 지우기입니다.
13. 레이저와 상자는 React 상태가 아니라 ref와 `requestAnimationFrame`으로 DOM에 직접 씁니다. 포인터 이동마다 상태를 갱신하면 슬라이드 전체가 매 프레임 재조정됩니다.
14. 아무것도 저장하지 않습니다. 되돌리기·지우기·영속 판서를 넣지 않습니다.
15. 색은 `--laser` 계열 토큰만 씁니다. 개별 규칙에 색을 직접 적지 않습니다.
16. `직접 조작`은 HTML 슬라이드를 마우스로 다루는 유일한 경로이므로 없애지 않습니다. 슬라이드 쇼를 시작할 때마다 꺼진 상태로 되돌립니다.
17. 슬라이드 카드에는 제목 막대, 형식 표시, 둥근 모서리를 넣지 않습니다. 카드 높이는 원본 비율에서만 나옵니다.
18. 캔버스의 한 번 누르기는 확대입니다. 포인터를 누른 위치에서 5px 넘게 끌었으면 무시합니다. 이 판정을 없애면 화면을 이동할 때마다 장면이 튑니다.
19. 발표 바의 세 칸은 `1fr auto 1fr` 격자입니다. 가운데 칸의 너비를 내용에 맡기면 이전·다음 버튼이 슬라이드마다 움직입니다.

### 재발한 적 있는 함정

20. 스테이지의 `ResizeObserver`는 **한 번만** 만들고 실제 크기 변화에만 반응해야 합니다. 의존성 배열에 `focus`나 `focused`를 넣으면 이동할 때마다 옵저버가 다시 만들어지고, 새 `observe()`의 초기 알림이 160ms 뒤 `duration:0` 재맞춤을 걸어 **진행 중인 전환을 잘라냅니다.** 자동 QA는 `reducedMotion:'reduce'`로 돌기 때문에 이 증상을 잡지 못합니다.
21. HTML 슬라이드 안의 키보드 브리지가 전달하는 키 목록과 부모의 `message` 핸들러가 처리하는 키 목록은 **같아야 합니다.** 한쪽에만 있는 키는 스크립트 슬라이드 안에서 조용히 죽습니다.
22. 판서 영역은 `<svg>`가 아니라 `<div>`입니다. `<svg>`로 되돌린다면 `width`·`height`와 `pointer-events:all`이 함께 있어야 화면 전체에서 입력을 받습니다. `inset:0`만으로는 300×150으로 남습니다.
23. 캔버스와 슬라이드 쇼의 HTML iframe은 `transform: scale()`로 줄입니다. Playwright는 프레임 좌표를 부모로 옮길 때 이 배율을 무시하므로, `browser-qa.mjs`에서 프레임 안을 누를 때는 `clickInsideScaledFrame`을 씁니다. `frameLocator(...).click()`을 직접 쓰면 조용히 빗나갑니다.
24. `Player`는 viewport를 구독하지 않습니다. 확대 배율이 필요하면 `ZoomBadge`처럼 그것만 읽는 작은 컴포넌트를 만듭니다. `useViewport()`를 `Player`에 되돌리면 팬·줌 프레임마다 셸 전체가 다시 그려집니다.
25. 슬라이드 쇼가 떠 있는 동안 캔버스 카메라를 움직이지 않습니다. `go()`는 그때 duration 0을 씁니다. 보이지 않는 애니메이션이 전환 순간에 노드를 마운트하고 data URI를 디코드합니다.

## 커밋과 pull request

명령형 제목에 `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:` 접두사를 권장합니다.

pull request에는 해결한 문제와 사용자에게 보이는 변화, 바꾼 계약, 실행한 검사와 **미확인 항목**, 보안·접근성 영향, 추가한 제3자 자산과 라이선스를 적습니다. 호환성이 깨지면 migration 방법과 SemVer 판단을 함께 적습니다. 코드와 관련 문서·테스트는 같은 PR에 넣고, 무관한 정리는 섞지 않습니다.

## 버전

사용자에게 보이는 변경은 `CHANGELOG.md`의 `Unreleased`에 기록합니다.

| 등급 | 기준 |
|---|---|
| patch | 호환되는 버그·문서·보안 수정 |
| minor | 기존 manifest와 호환되는 기능 추가 |
| major | manifest, CLI 또는 출력 계약의 호환성 파괴 |

버전을 파일마다 고치지 말고 `npm run version:set -- X.Y.Z`를 씁니다. 이 명령은 package와 lockfile만 바꾸고, CHANGELOG 제목과 날짜는 사람이 씁니다. 릴리스 절차는 [RELEASING.md](RELEASING.md)에 있습니다.

## 라이선스

기여물을 제출하면 별도 합의가 없는 한 저장소의 [MIT License](LICENSE)로 배포할 수 있음을 확인하는 것입니다. 제출할 권한이 없는 코드나 자료를 포함하지 마세요.

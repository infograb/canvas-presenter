# Changelog

이 프로젝트는 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따르며, 버전 번호는 [Semantic Versioning](https://semver.org/)을 적용합니다.

## [Unreleased]

### Changed

- 아직 공개되지 않은 변경 사항이 없습니다.

## [2.1.0] - 2026-09-11

### Added

- 캔버스 화면의 어두운 모드. 기본은 운영체제 `prefers-color-scheme`을 따르는 자동이고, 헤더 버튼과 `A`로 자동 → 밝게 → 어둡게를 돌린다. 자동이 아닌 선택은 `localStorage`에 남고, 저장이 막히면 조용히 자동으로 돌아간다
- 두 모드의 팔레트를 담는 `:root` 토큰 한 벌. 캔버스 화면의 색 리터럴을 전부 토큰으로 옮겼다
- 매니페스트의 그룹 `color`에서 테마별로 계산하는 `--group-ink`·`--group-border`·`--group-fill`. 밝은 배경을 전제로 고른 짙은 색도 어두운 모드에서 대비 4.5:1을 넘긴다
- 어두운 모드의 axe 검사와 화면 모드 전환을 확인하는 브라우저 QA 시나리오

### Fixed

- `--brand-wash` 위의 글자가 두 모드 모두 대비 4.5:1을 넘기지 못했다. `발표 경로 복귀`, 목차의 현재 항목, 눌린 버튼이 이에 해당한다
- 미니맵과 배경 점의 색을 `requestAnimationFrame` 안에서 읽던 탓에 백그라운드 탭에서 열면 테마가 반영되지 않았다

### Changed

- 슬라이드와 그 배경은 화면 모드와 무관하게 그대로 둔다. `--slide-backdrop`은 두 모드 모두 흰색이다. 슬라이드 쇼도 두 모드에서 모두 어둡다

## [2.0.1] - 2026-09-11

### Security

- 마크업과 CSS 살균을 문맥 없는 정규식에서 자체 토크나이저로 바꿨다. SVG와 HTML은 주석·문자열·속성·rawtext를 구분해 읽고, CSS는 문자열·주석·`url()` 인자·at-rule 이름을 구분하며 이스케이프를 푼다. 판정도 다시 쓰기도 토큰과 위치로만 한다
- 속성값 안의 `<!--`가 뒤따르는 외부 링크를 숨기던 문제를 고쳤다
- CSS 문자열 안의 `url(...)`을 자원 참조로 오인해 다시 쓰던 문제를 고쳤다
- 이스케이프한 `@im\70ort`가 `@import` 검사를 통과하던 문제를 고쳤다
- 네임스페이스 접두사가 붙은 `<s:script>`가 SVG deny list를 통과하던 문제를 고쳤다
- 주석 안의 `<svg width>`에서 슬라이드 크기를 읽던 문제를 고쳤다
- CSP meta를 `<head>` 안에서 실행 가능한 내용보다 앞에 놓는다. 인용부호 안의 `>`가 head 태그를 쪼개던 문제도 함께 사라졌다. 두 조건을 만족시킬 수 없는 문서는 거부한다
- 인라인 뒤 의미가 달라지는 외부 스크립트의 `defer`·`async`와 스타일시트의 `media`를 거부한다
- SVG 참조를 인라인한 결과를 다시 검증한다. 이전에는 인라인 성공을 보고한 뒤 컴파일에서 거부되는 문서가 나올 수 있었다
- SVG의 `#fragment` 참조를 경로와 조각으로 나눠 처리한다. `<use href="icons.svg#check">`가 더 이상 거부되지 않는다

### Fixed

- 트리 연결선 ID를 대상 노드 ID에서 만든다. 하이픈이 들어간 ID 조합이 같은 연결선 ID로 뭉개지던 문제를 고쳤다
- `text` 내용과 `data-href` 속성을 자원 참조로 잘못 보고하던 `inventory`의 오탐을 없앴다
- `package-lock.json`의 루트 이름이 `package.json`과 달랐다. `version:check`가 이름도 비교한다
- `assets/runtime/build.mjs`가 Windows에서 esbuild 실행 파일을 찾지 못하던 문제를 esbuild JS API로 바꿔 해결했다
- 브라우저 QA 하네스가 CSS `transform`으로 축소된 iframe 좌표를 잘못 계산해 프레임 안을 누르지 못하던 문제, 미니맵 고정 좌표가 노드를 빗나가던 문제, 전체화면 응답을 기다리지 않던 경합을 고쳤다

### Changed

- `Player`가 viewport를 구독하지 않는다. 확대 배율은 `ZoomBadge`만 읽으므로 팬·줌 프레임마다 셸 전체가 다시 그려지지 않는다. `data-zoom` 속성은 없앴다
- 슬라이드 쇼가 떠 있는 동안 캔버스 카메라를 움직이지 않는다. 보이지 않는 전환이 노드를 마운트하고 data URI를 디코드하던 비용이 사라졌다
- 슬라이드 쇼의 HTML iframe을 원본 크기로 그리고 `transform`으로 줄인다. 창 크기를 바꿔도 iframe이 다시 만들어지지 않아 내부 상태가 유지된다
- 캔버스와 슬라이드 쇼의 HTML 직접 조작을 하나의 상태로 합쳤다
- 그룹 제목을 눌렀을 때 `focus`가 두 번 실행되며 첫 전환을 끊던 동작을 없앴다
- 한 번의 컴파일 동안 같은 파일의 읽기·검증·base64 결과를 재사용한다
- 슬라이드 쇼 도구 막대와 이동 경로, 카메라 조작에 올바른 ARIA 역할을 주어 `aria-prohibited-attr` 미확정 항목을 없앴다
- `THIRD-PARTY-NOTICES.txt`가 번들에 실제로 들어간 패키지만 표기한다. 타입 전용 `@types/d3-*` 6개가 빠졌다

### Removed

- 내부에서만 쓰이던 `layoutManifest` export와 정규화 노드의 사용되지 않는 `source` 필드

## [2.0.0] - 2026-09-10

### Added

- SVG 안의 외부 참조를 data URI로 바꾼 작업 사본을 만드는 `canvas.mjs inline INPUT_DIR --out DIR [--force]`. 원본은 고치지 않고, 이전 `inline` 결과만 `--force`로 교체한다
- `inventory`가 파일마다 원본 크기, 어떤 슬라이드가 참조하는지(`referencedBy`), SVG 외부 참조 목록과 차단 사유, 그리고 목록에 없는 참조(`unlistedReferences`)를 함께 보고
- 같은 자산이 여러 슬라이드에 중복 인라인되어 합계 256 KB를 넘으면 중복 횟수와 크기를 알리는 빌드 경고
- `serve --port auto`와, 지정한 포트가 사용 중일 때 사용 가능한 포트를 알려 주는 오류 메시지
- 캔버스에서 카드를 한 번 눌러 확대하는 조작. 화면을 끈 뒤의 클릭은 무시한다
- 슬라이드 쇼의 레이저 포인터와 강조 상자. 움직이면 레이저가 따라오고 760ms 멈추면 사라지며, 8px 넘게 끌면 상자가 남고 한 번 누르거나 장을 넘기면 사라진다. 도구 선택이 없다
- 레이저와 상자에 인포그랩 로고의 라임-틸 색을 쓰는 `--laser` 계열 토큰
- 슬라이드 쇼의 `직접 조작`(C). HTML 슬라이드에서만 나오며 포인터 영역을 걷는다. 스크립트 슬라이드 안에 초점이 있어도 `C`가 부모에 전달된다

### Changed

- 슬라이드 카드에서 제목 막대와 형식 표시를 없애고 원본 화면만 표시한다. 카드 높이가 원본 비율과 정확히 같아졌다
- 목차 항목에서도 형식 표시를 없앴다
- 모든 표면의 둥근 모서리를 직각으로 바꿨다
- 슬라이드 적재 실패를 첫 건에서 멈추지 않고 실패한 슬라이드 전체를 한 번에 보고한다
- 발표 바의 `이전 슬라이드`·`다음 슬라이드`를 `이전`·`다음`으로 줄이고 위치를 고정했다. 가운데에는 슬라이드 제목 없이 번호만 둔다
- 스테이지의 크기 감시자를 한 번만 만들고 실제 크기 변화에만 반응하게 했다. 이전에는 장면을 옮길 때마다 감시자가 다시 만들어져 진행 중인 카메라 전환을 약 160ms에서 잘랐다
- `build`와 `inline`의 교체를 `기존 폴더를 옆으로 옮기고 → 새 폴더를 제자리에 → 옆 폴더 삭제` 순서로 바꿨다. 이름 바꾸기가 실패해도 이전 출력이 남는다
- `inline`이 자기가 만든 파일 목록을 마커에 기록하고, `--force`는 그 목록에 없는 파일이 있으면 거부한다. 마커 형식이 2로 올라갔으므로 이전 `inline` 결과 폴더는 지우고 다시 만든다
- `inline`이 입력을 품는 출력 디렉터리도 거부한다
- `serve --port auto`가 점유된 포트를 만나면 다음 후보로 계속 시도한다
- `check:generated`가 작업 트리를 바꾸지 않는다. 검사 뒤 커밋된 번들을 그대로 되돌린다
- 슬라이드 쇼 도구 막대의 기본 불투명도를 0.5로 올렸다

### Removed

- 발표 모드와 `발표 모드` 버튼, `P` 단축키. 슬라이드 쇼가 발표 화면을 겸한다
- 슬라이드 쇼 아래의 82px 고정 막대와 이전·다음 버튼. 슬라이드가 화면을 가득 채우고 도구 막대만 겹쳐 뜬다
- `constants.SLIDE_HEADER`. 슬라이드 노드 높이는 이제 원본 비율에서만 나온다

### Breaking

- `inventory`의 표준 출력이 배열에서 `{root, counts, files}` 객체로 바뀌었다. 파일마다 있던 `role`은 사라지고, 다른 슬라이드가 참조하는 파일에는 `referencedBy`가 붙는다. 참조된다는 이유로 슬라이드 목록에서 빠지지 않는다
- 발표 모드와 `P` 단축키를 없앴다. 발표 화면은 슬라이드 쇼 하나이며, `발표 모드` 버튼을 클릭하던 스크립트는 고쳐야 한다
- 슬라이드 쇼의 이전·다음 버튼을 없앴다. 이동은 키보드로만 한다
- 슬라이드 카드가 더 이상 탭 정지점을 만들지 않는다. 캔버스에서 키보드로 개별 장면에 가려면 목차 패널을 쓴다
- `constants.SLIDE_HEADER`가 사라졌다. 구조 분해로 읽던 소비자는 `undefined`를 받는다
- 슬라이드 노드 높이가 장당 36px 줄어 기존 생성물과 좌표가 달라진다. 기존 발표는 다시 생성한다
- `references/maintenance.md`를 [CONTRIBUTING.md](CONTRIBUTING.md)로, `docs/publication-checklist.md`를 [RELEASING.md](RELEASING.md)로 합쳤다

## [1.2.0] - 2026-09-10

### Added

- `전체화면` 바로 옆에서 시작하는 슬라이드 전용 `슬라이드 쇼`와 이전·다음·종료 컨트롤
- 현재 경로 커서에서 시작하고 `step=-1`에서는 첫 장으로 들어가는 슬라이드 쇼 경로 모델
- HTML 슬라이드 안의 방향키·번호 키·S·Escape를 부모 슬라이드 쇼에 전달하는 sandbox 내부 연결

### Changed

- HTML 슬라이드 쇼에 문서 배율을 적용해 원본 화면 비율과 포인터 좌표를 함께 유지
- Fullscreen API 요청이 거부돼도 현재 창의 몰입형 슬라이드 쇼를 계속하도록 변경
- 런타임 빌드가 설치된 네이티브 esbuild 실행 파일을 우선 사용하도록 보강

## [1.1.0] - 2026-09-10

### Added

- SVG·PNG·HTML 입력, 중첩 그룹, 트리·순차·자유 배치와 미니맵을 지원하는 독립 HTML 생성기
- 포스터와 선택된 iframe 하나만 실행하는 HTML 슬라이드 정책
- 발표 모드, 노트, URL 상태 복원과 키보드 단축키 안내
- 공개 저장소용 README, MIT License, 기여·보안·지원 정책과 GitHub 자동화
- SemVer 점검, 생성 파일 검증, GitHub Pages 데모와 릴리스 아카이브·SHA-256 생성 절차

### Changed

- 발표 경로의 target을 슬라이드 ID로 제한하고 전체 윤곽과 그룹 확대를 탐색용 보기로 분리
- 이전·다음 조작이 슬라이드 단위로만 이동하도록 변경
- React Flow 출처 링크를 화면에서 숨기되 번들 라이선스 고지는 유지

### Security

- 로컬 자산 인라인, 경로 이탈·외부 참조 거부, 제한적인 CSP와 sandbox iframe 적용

[Unreleased]: https://github.com/infograb/canvas-presenter/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/infograb/canvas-presenter/releases/tag/v2.1.0
[2.0.1]: https://github.com/infograb/canvas-presenter/releases/tag/v2.0.1
[2.0.0]: https://github.com/infograb/canvas-presenter/releases/tag/v2.0.0
[1.2.0]: https://github.com/infograb/canvas-presenter/releases/tag/v1.2.0
[1.1.0]: https://github.com/infograb/canvas-presenter/releases/tag/v1.1.0

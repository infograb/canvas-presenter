# Release process

이 문서는 InfoGrab 유지보수자가 Canvas Presenter를 GitHub에 처음 공개하고 이후 버전을 배포하는 절차입니다. npm registry 배포는 현재 범위가 아닙니다.

## 저장소를 처음 공개할 때

1. GitHub 조직에 빈 public 저장소 `infograb/canvas-presenter`를 만듭니다. README, LICENSE, `.gitignore`를 GitHub에서 다시 생성하지 않습니다.
2. 로컬 저장소의 `origin`이 `https://github.com/infograb/canvas-presenter.git`인지 확인합니다.
3. 기본 브랜치를 `main`으로 정하고 push합니다.
4. GitHub Pages의 source를 **GitHub Actions**로 설정합니다.
5. **Private vulnerability reporting**을 활성화합니다.
6. 조직 정책에 맞게 `main` branch protection을 설정하고 CI의 `test`, `generated`, `browser` job을 필수 검사로 지정합니다.
7. Actions가 release를 만들 수 있도록 조직·저장소의 `GITHUB_TOKEN` 정책에서 필요한 `contents: write`를 허용합니다.
8. 필요하면 Discussions를 활성화합니다.

```bash
git remote add origin https://github.com/infograb/canvas-presenter.git  # 아직 없을 때만
git push -u origin main
git push origin --tags
```

첫 push 전에 아래를 사람이 확인합니다. 추정으로 통과시키지 않습니다.

- [ ] 공개할 자체 코드·문서·예제 자산의 저작권 또는 재라이선스 권한
- [ ] `git status`, `git log`, `git tag`에 공개하면 안 되는 과거 내용이 없는지
- [ ] 저장소 설명·topics·웹사이트 URL
- [ ] Actions의 `test`, `generated`, `browser` job이 실제로 통과하는지
- [ ] Pages의 grouped/tree/sequence 링크를 실제 브라우저에서 열어 보기

## 버전 준비

1. `main`을 최신 상태로 만들고 작업 트리가 깨끗한지 확인합니다.
2. SemVer에 맞는 버전을 정합니다.
3. package와 lockfile 버전을 갱신합니다.
4. `CHANGELOG.md`의 `Unreleased` 내용을 새 버전 헤딩 아래로 옮기고 날짜를 넣습니다.
5. 생성 파일과 예제를 다시 만들고 전체 검사를 실행합니다.

```bash
npm ci --ignore-scripts
npm run version:set -- X.Y.Z
# CHANGELOG.md를 검토하고 X.Y.Z 헤딩을 추가합니다.
npm run build:runtime
npm run verify
npm run check:generated
npm run build:site
```

## 커밋과 태그

버전 커밋은 다른 기능 변경과 분리합니다.

```bash
git add -A
git commit -m "chore: release vX.Y.Z"
git tag -a vX.Y.Z -m "Canvas Presenter vX.Y.Z"
```

서명 환경이 준비되어 있다면 annotated tag 대신 signed tag를 사용합니다.

```bash
git tag -s vX.Y.Z -m "Canvas Presenter vX.Y.Z"
```

공개한 태그를 이동하거나 같은 버전의 아카이브를 덮어쓰지 않습니다. 수정이 필요하면 새 patch 버전을 만듭니다.

## 자동 릴리스

`vX.Y.Z` 태그를 push하면 `.github/workflows/release.yml`이 다음을 수행합니다.

1. 태그와 package·lockfile·changelog 버전을 대조합니다.
2. 테스트, 예제 검증과 생성 파일 최신 상태를 확인합니다.
3. 저장소를 ZIP과 tar.gz로 패키징합니다.
4. `release-manifest.json`과 `SHA256SUMS`를 만듭니다.
5. GitHub Release를 generated notes와 함께 발행합니다.

```bash
git push origin main
git push origin vX.Y.Z
```

## 릴리스 확인

- Actions의 CI, Pages, Release workflow가 모두 성공했는지 확인합니다.
- GitHub Release의 태그와 `package.json` 버전이 같은지 확인합니다.
- `SHA256SUMS`로 두 아카이브와 release manifest를 검증합니다.
- 깨끗한 임시 폴더에 아카이브를 풀고 번들 예제를 생성합니다.
- Pages의 grouped/tree/sequence 예제를 각각 엽니다.
- 설치·업그레이드 안내와 `CHANGELOG.md` 링크가 유효한지 확인합니다.

로컬에서 release asset을 미리 만들려면 깨끗한 Git 작업 트리에서 실행합니다.

```bash
npm run release:pack -- --out dist/release --ref HEAD
```

## 릴리스마다 확인

- [ ] `CHANGELOG.md`의 `Unreleased`를 새 버전과 날짜 아래로 옮겼다
- [ ] `npm run verify`가 통과한다
- [ ] `npm run check:generated`가 통과하고 생성 파일 diff가 없다
- [ ] `npm run build:site`가 세 예제를 모두 만든다
- [ ] 새 의존성과 자산의 라이선스·출처·재배포 권한을 확인했다
- [ ] 민감 정보 검색 결과를 사람이 검토했다
- [ ] 호환성 변화에 맞는 SemVer를 골랐다
- [ ] 태그가 `package.json` 버전과 같고 기존 태그를 덮어쓰지 않는다
- [ ] 아카이브 체크섬과 깨끗한 설치를 확인했다
- [ ] [references/qa.md](references/qa.md)의 검증 기록을 이번 릴리스로 갱신했고, 확인하지 못한 항목을 미확인으로 남겼다

## 롤백과 보안 릴리스

이미 공개한 릴리스는 삭제하거나 태그를 옮기는 대신 새 patch 릴리스에서 수정합니다. 유출된 비밀이나 위험한 아카이브처럼 즉시 차단해야 하는 상황에서는 GitHub Release를 내리고 Security Advisory에 사유와 대체 버전을 기록하되, 사고 기록과 기존 tag의 존재를 숨기지 않습니다.

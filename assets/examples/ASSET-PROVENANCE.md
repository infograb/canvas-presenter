# Example asset provenance

번들 예제의 manifest, SVG, HTML과 PNG는 Canvas Presenter의 동작을 검증하기 위해 이 프로젝트에서 작성한 자료입니다. 고객 자료, 제3자의 비공개 자료와 외부에서 내려받은 이미지를 포함하지 않습니다. 별도 표시가 없는 한 저장소의 MIT License를 따릅니다.

| 자산 | 구분 | 원본 또는 생성 관계 |
|---|---|---|
| `slides/01-overview.svg` | 원본 | 프로젝트에서 작성한 SVG |
| `slides/02-inputs.svg` | 원본 | 프로젝트에서 작성한 SVG |
| `slides/03-media-source.svg` | 원본 | PNG 미디어 예제의 벡터 원본 |
| `slides/03-media.png` | 생성 | `03-media-source.svg`를 1920×1080으로 렌더링 |
| `slides/04-layouts.svg` | 원본 | 프로젝트에서 작성한 SVG |
| `slides/05-paths.svg` | 원본 | 프로젝트에서 작성한 SVG |
| `slides/06-interaction.html` | 원본 | 프로젝트에서 작성한 독립 HTML 예제 |
| `slides/06-interaction-poster.png` | 생성 | `06-interaction.html`의 초기 상태를 1920×1080으로 렌더링 |
| `docs/images/overview.png` | 생성 | 2.0.0 grouped 예제 전체 윤곽을 1476×1007, DPR 2에서 캡처 |

PNG 예제는 Chromium 계열 브라우저가 실행되는 환경에서 다음 명령으로 다시 만들 수 있습니다.

```bash
npm ci --ignore-scripts
BROWSER_BIN=/path/to/chrome node scripts/render-example-assets.mjs
```

브라우저·폰트·운영체제에 따라 PNG 바이트가 달라질 수 있으므로 CI는 byte-for-byte 일치를 강제하지 않습니다. 포스터가 HTML의 초기 상태와 시각적으로 일치하는지는 브라우저 QA에서 확인합니다.

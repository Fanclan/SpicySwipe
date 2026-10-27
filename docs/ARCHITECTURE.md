# Architecture

| Path | Responsibility |
| --- | --- |
| `desktop/main.cjs`, `preload.cjs`, `policy.cjs` | Electron lifecycle, IPC boundaries, embedded Tinder, navigation and permissions |
| `desktop/service.cjs` | Local settings, OS-encrypted secrets, provider calls, and activity |
| `desktop/android.cjs` | SDK discovery, ADB commands, device selection and emulator lifecycle |
| `desktop/mobile-controller.cjs` | Per-platform mobile session state and actions |
| `desktop/mobile-screen.cjs`, `bumble-screen.cjs`, `mobile-vision.cjs` | Screen interpretation and evidence |
| `desktop/windows-ocr.*` | Local Windows OCR used by Hinge verification |
| `desktop/mobile-chat.cjs` | Supported Hinge chat context and opener behavior |
| `shared/` | Settings, AI providers, session scheduling, and shared client layer |
| `content/tinder.js` | Current Tinder page integration |
| `background.js`, `content.js`, `popup/` | Chrome extension entry points and UI |
| `ui/` | Shared workspace and sample-data browser preview |
| `tests/` | Node test runner regressions with mocks and sanitized fixtures |
| `scripts/` | Validation and reproducible builds |

Older modules in `content/components/`, other legacy `content/` files, `utils/`, and locale folders are retained as source references. The extension's actual distribution is the explicit allowlist in `scripts/files.js`; `manifest.json` identifies its entry points. Do not assume a historical module is loaded by the current app.

The desktop preload bundle is generated with esbuild and excluded from Git. Electron packages the generated code along with the declared files in `electron-builder.yml`. Tests do not control real Android devices or real accounts. Private local diagnostic scripts and captured account screenshots are intentionally absent from the public snapshot.

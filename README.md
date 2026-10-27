<div align="center">
  <img src="assets/logo.svg" alt="SpicySwipe lightning logo" width="96" height="96">
  <h1>SpicySwipe</h1>
  <p><strong>One workspace. Three dating apps. Your AI.</strong></p>
  <p>Tinder, Hinge, and Bumble sessions, profile review, and AI drafts in a desktop app.</p>
  <p>
    <a href="https://github.com/Fanclan/SpicySwipe/actions/workflows/ci.yml"><img src="https://github.com/Fanclan/SpicySwipe/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
    <a href="https://nodejs.org/en/download"><img src="https://img.shields.io/badge/Node.js-24_LTS-43853d" alt="Node.js 24 LTS"></a>
    <a href="License"><img src="https://img.shields.io/badge/license-personal%20%2F%20noncommercial-e87560" alt="Personal and non-commercial license"></a>
    <a href="https://fanclan.io"><img src="https://img.shields.io/badge/maintained%20by-Fanclan-292524" alt="Maintained by Fanclan"></a>
  </p>
  <p><a href="#quick-start">Quick start</a> · <a href="docs/SETUP.md">Platform setup</a> · <a href="docs/ANDROID.md">Android devices</a> · <a href="docs/AI.md">AI setup</a> · <a href="CONTRIBUTING.md">Contribute</a></p>
</div>

---

**Public preview.** Windows is the primary tested platform. macOS and Linux build targets are included; see the support table below. Dating apps change frequently, so an unrecognized screen can require a compatibility update.

**License status:** this repository is publicly available under the original [SpicySwipe Personal Use License](License). It permits personal, educational, and non-commercial use and requires attribution. It is **source-available, not an OSI-approved open-source license**. Commercial use requires permission from the original rights holder. See [attribution](ATTRIBUTION.md).

## What you can do

- **Keep all three apps together.** Use embedded Tinder and connect separate Android devices for Hinge and Bumble. Each app has its own session controls and progress.
- **Start a paced session.** Set the Like ratio, action cap, duration, profile browsing, and breaks. Plain Likes are the default for Hinge. Bumble uses right swipes for Likes and left swipes for passes.
- **Write with context.** Create editable drafts using OpenAI, Gemini, Claude, DeepSeek, or your own Ollama server. Hinge also supports optional photo comments on supported screens.
- **See the device clearly.** Tap, scroll, type, enlarge the Android view, or pop it into a resizable window.
- **Keep control.** Pause or stop each session. Unknown dialogs and uncertain profile identity stop actions; recognized Rose offers use the ordinary Like option.
- **Use Chrome if you prefer.** The Tinder extension includes a sidebar, popup, and full settings workspace.

## Download the public preview

[**Get SpicySwipe 3.0.0 preview**](https://github.com/Fanclan/SpicySwipe/releases/tag/v3.0.0-preview.1)

| Platform | Download |
| --- | --- |
| Windows x64 | [Setup installer](https://github.com/Fanclan/SpicySwipe/releases/download/v3.0.0-preview.1/SpicySwipe.Setup.3.0.0.exe) |
| macOS Apple Silicon | [ARM64 DMG](https://github.com/Fanclan/SpicySwipe/releases/download/v3.0.0-preview.1/SpicySwipe-3.0.0-arm64.dmg) |
| macOS Intel | [Intel DMG](https://github.com/Fanclan/SpicySwipe/releases/download/v3.0.0-preview.1/SpicySwipe-3.0.0.dmg) |
| Linux x64 | [AppImage](https://github.com/Fanclan/SpicySwipe/releases/download/v3.0.0-preview.1/SpicySwipe-3.0.0.AppImage) |
| Chrome extension | [Extension ZIP](https://github.com/Fanclan/SpicySwipe/releases/download/v3.0.0-preview.1/spicyswipe-3.0.0.zip) |

Installers do not require Node.js. They are **unsigned previews**; Mac builds are not notarized. Read the [platform notes](docs/SETUP.md) before installing. Android tools and your own app sign-ins are still needed for Hinge/Bumble. The release includes a SHA-256 checksum manifest.

## Quick start

Install [Git](https://git-scm.com/downloads) and [Node.js 24 LTS](https://nodejs.org/en/download) (24.15.0+; Node 22.22.2+ on the 22.x line is also supported), then run:

```sh
git clone https://github.com/Fanclan/SpicySwipe.git
cd SpicySwipe
npm ci
npm run desktop
```

On Windows, clone into a local folder such as your home directory, rather than a network share. If PowerShell blocks npm's script shim, use `npm.cmd` for these commands.

1. Open **Tinder** and sign in inside the app.
2. For **Hinge** or **Bumble**, follow the [Android setup guide](docs/ANDROID.md), connect a device, and sign in there.
3. Choose your session settings and press **Start session**. Plain Likes do not require an AI provider.
4. Optionally configure **AI settings** for drafts or Hinge comments.

For concurrent Hinge and Bumble sessions, give each app a separate Android device or emulator. Tinder uses the embedded browser and needs no Android device. Enable background operation for sessions that should continue while you switch tabs, and keep SpicySwipe open.

## Platform and feature support

| Capability | Windows x64 | macOS ARM64 / Intel | Linux x64 |
| --- | --- | --- | --- |
| Desktop workspace and Tinder | Tested | Basic desktop use tested on Apple Silicon; Intel needs native testing | Build target; native use needs testing |
| Android connection and manual controls | Tested | Available; verify on your device | Available; verify on your device |
| Hinge automated Likes and comments | Tested with Windows OCR | Not supported by the current OCR implementation | Not supported by the current OCR implementation |
| Bumble Like / pass sessions | Tested | Not yet validated | Not yet validated |
| Chrome extension for Tinder | Available in Chrome | Available in Chrome | Available in Chrome |

Hinge defaults to plain Likes. AI comments and automatic openers are separate opt-ins. Bumble automation currently covers Likes and passes; Compliments and automatic messaging are not implemented. Test a short session after any dating-app update. Session counters represent actions attempted by the app, not independently confirmed unique matches or accepted Likes.

## Build an installer

Run the command on the matching operating system after `npm ci`:

| Platform | Command | Output in `release/` |
| --- | --- | --- |
| Windows x64 | `npm run desktop:win` | NSIS installer (`.exe`) |
| macOS Apple Silicon | `npm run desktop:mac` | `.dmg` and `.zip` |
| macOS Intel | `npm run desktop:mac:x64` | `.dmg` and `.zip` |
| Linux x64 | `npm run desktop:linux` | `.AppImage` |

These preview builds do not include a verified publisher signature or Apple notarization. No automatic updater is configured. The [desktop build workflow](.github/workflows/desktop.yml) produces downloadable CI artifacts; it does not automatically publish a GitHub Release. See [platform-specific setup](docs/SETUP.md) and the [release checklist](docs/RELEASING.md).

## Try it without signing in

```sh
npm ci
npm run dev
```

Open [localhost:5173](http://127.0.0.1:5173/ui/dashboard.html). This browser preview uses sample data and simulated actions; it does not contact Tinder or AI providers. It previews the shared workspace, not the full Electron device integration.

## Install the Chrome extension

```sh
npm ci
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/spicyswipe`. Pin SpicySwipe, open Tinder, and use the coral sidebar launcher. A distributable ZIP is also created in `dist/`.

For updates, rebuild and reload the same extension folder to keep its identity and saved settings. Desktop and extension sign-ins and settings are separate.

## Privacy and account actions

Settings and activity are stored locally. Desktop API keys use Electron's OS-backed encryption; the app refuses to save keys when secure encryption is unavailable. Extension API keys use `chrome.storage.local`, which is not an encrypted vault. AI requests send the selected text context to the provider you configure. See [privacy and data flow](docs/PRIVACY.md).

Automated sessions perform real account actions. Review settings before starting, use only your own accounts, and respect other users and each platform's rules. The project does not promise account protection, undetectability, or uninterrupted compatibility. It is not affiliated with or endorsed by Tinder, Hinge, Bumble, or their owners.

## Development

```sh
npm ci
npm test
npm run check
npm run build
npm run desktop:build
```

Tests use mocks and sanitized fixtures; they do not require signed-in accounts or send real Likes or messages. See [contributing](CONTRIBUTING.md), [architecture](docs/ARCHITECTURE.md), [security reporting](SECURITY.md), and the [changelog](CHANGELOG.md).

## About Fanclan

This edition of SpicySwipe is maintained under the **[Fanclan](https://github.com/Fanclan)** organization. Fanclan is a creator discovery directory built around search and useful profile context. Learn about the platform and its approach on the [official Fanclan About page](https://www.fanclan.io/about).

[Visit Fanclan](https://fanclan.io) · [Fanclan on GitHub](https://github.com/Fanclan)

SpicySwipe runs independently; no Fanclan account is required. The original SpicySwipe project was created by **Soufienne Rahali**. Original author attribution and license terms are preserved in [ATTRIBUTION.md](ATTRIBUTION.md) and [License](License).

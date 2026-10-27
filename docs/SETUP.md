# Desktop setup

## Install a preview build

Download the matching installer from the [public preview release](https://github.com/Fanclan/SpicySwipe/releases/tag/v3.0.1-preview.1). Installers do not require Node.js or Git. They are unsigned, and macOS builds are not notarized; read the platform notes below. Android setup and app sign-in remain separate.

## Source-build requirements

- Git and [Node.js 24 LTS](https://nodejs.org/en/download); use 24.15.0 or newer on the 24.x line. Node 22.22.2+ on the 22.x line is also supported.
- A graphical desktop and internet access for the dating apps and initial dependency downloads.
- For Hinge/Bumble: [Android Studio](https://developer.android.com/studio) with SDK Platform-Tools and Android Emulator, or a USB-debugging-enabled Android phone.
- Hardware virtualization for comfortable emulator use. Running two emulators needs substantially more memory and CPU than Tinder alone. Start one at a time on smaller machines.

Clone the repository, run `npm ci`, then `npm run desktop`. Never copy `node_modules` between operating systems or CPU architectures.

## Windows

1. Install Git for Windows and Node.js. Open a new PowerShell terminal.
2. Clone into a local directory, for example `$HOME\source\SpicySwipe`. Avoid UNC/network shares for npm and Electron build tools.
3. Run `npm ci` and `npm run desktop`. Use `npm.cmd` if PowerShell's execution policy blocks `npm.ps1`.
4. For Android, install Android Studio's SDK tools. The usual SDK location is `%LOCALAPPDATA%\Android\Sdk`; choose it in **Devices → Choose SDK folder** if detection fails.
5. Use x86_64 Google Play emulator images on supported x64 hosts. Configure hardware acceleration following [Android's Windows instructions](https://developer.android.com/studio/run/emulator-acceleration).

Hinge's screenshot text verification uses Windows OCR. If the app reports that a recognizer is unavailable, install the relevant Windows language/OCR component and try again. Current screen recognition is designed around English app labels.

Build: `npm run desktop:win`. The NSIS installer allows choosing an installation folder. Current preview builds are unsigned; verify the source or build locally rather than disabling Windows security globally.

## macOS

1. Install the Node.js build matching your Mac: ARM64 for Apple Silicon, x64 for Intel.
2. Run `npm ci` and `npm run desktop` from a local folder.
3. Android Studio normally installs the SDK at `~/Library/Android/sdk`. Apple Silicon needs an ARM64 Google Play system image; Intel needs an x86_64 image.
4. Allow any OS permission the app actually needs, such as Tinder location or access to a configured LAN Ollama server.

Build on Apple Silicon with `npm run desktop:mac`, or on Intel with `npm run desktop:mac:x64`. The current build configuration uses ad-hoc signing; it is not Developer ID signed or notarized. A downloaded preview may be blocked by Gatekeeper. Prefer running from reviewed source if its origin cannot be verified.

Hinge automation depends on Windows OCR and is unavailable here. Android manual controls and text-based AI drafting remain available. Native Intel and extended mobile-session behavior still need validation.

## Linux

1. Install Git, a supported Node.js version, and the desktop libraries required by Electron on your distribution.
2. Run `npm ci` and `npm run desktop` in a graphical session, as your normal user.
3. Android's default SDK directory is `~/Android/Sdk`. Install the emulator and platform-tools, and configure KVM access using [Android's Linux acceleration guide](https://developer.android.com/studio/run/emulator-acceleration).
4. If using cloud API keys, configure a supported desktop secret store. SpicySwipe refuses to save keys if Electron falls back to insecure plaintext storage.

Build with `npm run desktop:linux`. Mark the resulting AppImage executable before launching. AppImage support and system libraries vary by distribution; see [Electron's prerequisites](https://www.electronjs.org/docs/latest/tutorial/tutorial-prerequisites) and [AppImage documentation](https://docs.appimage.org/user-guide/run-appimages.html). Do not launch Electron as root or disable its sandbox to work around setup problems.

Linux is a packaging target, not a claim of completed native end-to-end testing. Hinge's Windows OCR path is unavailable.

## After launch

Sign in to Tinder in its embedded view. Set up Android once for each mobile app using the [device guide](ANDROID.md). Plain Like sessions do not require AI setup. Choose conservative settings for the first short test, then adjust after confirming behavior on your device.

See [troubleshooting](TROUBLESHOOTING.md) for device, model, and session errors.

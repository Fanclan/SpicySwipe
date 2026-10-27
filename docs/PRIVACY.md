# Privacy and data flow

SpicySwipe has no required Fanclan account or Fanclan application backend. The desktop app, extension, dating apps, and AI providers have separate data boundaries.

| Data | Where it goes |
| --- | --- |
| Tinder sign-in and web data | Embedded browser profile on your computer; Tinder's services |
| Hinge/Bumble sign-in | Selected Android device or emulator; the dating app's services |
| Preferences and action history | Local application settings, or Chrome extension storage |
| Desktop API keys | OS-encrypted values in local settings; used for requests to your selected provider |
| Extension API keys | `chrome.storage.local`; local, but not an encrypted vault |
| AI context and draft requests | The configured provider endpoint, including a remote Ollama server if selected |
| Android screenshot crops used for OCR | Local Windows OCR temporary files; cleanup is attempted after processing |

The current AI layer generates from text; profile photos are not uploaded as AI image inputs by that layer. Screen previews still display real personal information locally. Treat screenshots, UI dumps, browser profiles, emulator data, and diagnostic logs as sensitive.

The app relies on third-party services for sign-in, profiles, and cloud inference. Their privacy policies and retention rules apply to those interactions. Disabling cloud AI does not stop the dating apps' own network traffic.

## Credentials and cleanup

Desktop secret storage uses Electron `safeStorage`. If secure encryption is unavailable, key saving is refused. Settings live in Electron's platform-specific user-data directory. Browser cookies and Android app data are separate from those settings.

Clearing an API key in the UI removes it from the saved configuration. To remove everything, quit the app, remove its user-data directory, and separately remove the relevant browser extension data and Android app/emulator data. Back up anything you want to keep first. Uninstalling an executable alone may leave user data behind.

Do not publish real profiles, conversation text, phone numbers, API keys, sign-in tokens, HAR files, emulator images, or unredacted settings in issues or pull requests. Use synthetic fixtures. Report suspected credential exposure privately using [SECURITY.md](../SECURITY.md).

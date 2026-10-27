# Troubleshooting

| Symptom | What to check |
| --- | --- |
| npm install or Electron fails after moving from another OS | Use a local clone and run `npm ci` on the current OS/architecture. Do not reuse another platform's dependencies. |
| PowerShell says npm.ps1 cannot run | Use `npm.cmd ci` and `npm.cmd run desktop`. |
| SDK not found | Choose the SDK root in Devices. It must contain `platform-tools/adb` and, for virtual devices, the emulator tool. |
| No emulator listed | Create a Google Play AVD in Android Studio Device Manager, then refresh. |
| Device is unauthorized or offline | Approve USB debugging on the phone; let the emulator finish booting; reconnect and refresh. |
| Hinge or Bumble is not installed | Open its Play Store page on the selected device, install, and sign in manually. |
| Both mobile sessions affect the same screen | Assign a different Android device to each platform. |
| Profile changed or a dialog interrupted review | Pause; inspect the selected device for an overlay, loading state, or manually changed screen. Return to ordinary discovery and start a short test. If repeatable, file a sanitized bug report. |
| A Like was submitted but the screen did not advance | Do not repeatedly click Send. Check network connectivity and the account's own limits; an uncertain outcome is not proof the action failed. |
| Hinge OCR unavailable | Use Windows with an installed supported OCR language and English app labels. This OCR path is not implemented on macOS/Linux. |
| Emulator closes, freezes, or renders incorrectly | Check virtualization and graphics in Android Studio; cold boot the affected device. Record GPU, emulator, and app versions for a bug report. |
| Ollama model list empty | Confirm the server URL and install a chat model on that server. Model discovery lists installed models only. |
| Cloud models list but generation fails | Check the selected model, provider permissions, billing, and quota. Discovery is not a generation test. |
| A session stops when changing tabs | Check that platform's background setting. |
| Counters differ from received Likes or matches | Counters track attempted actions, not server-confirmed unique recipients or matches. |

For bugs, include your OS, SpicySwipe version, device/app versions, the exact error, and a small reproducible sequence. Replace names, photos, messages, and credentials with sample data before attaching anything. Account challenges, sign-in verification, and platform rate limits must be handled normally in the original app.

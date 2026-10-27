# Hinge and Bumble devices

Tinder runs in the desktop browser view. Hinge and Bumble use Android through ADB. For simultaneous mobile sessions, use **one device per app**; two controllers cannot safely drive one foreground Android screen at the same time.

## One-time setup

1. Install [Android Studio](https://developer.android.com/studio). In SDK Manager, install **Android SDK Platform-Tools** and **Android Emulator**.
2. Open **Device Manager → Create Virtual Device**. Choose a phone profile marked for Google Play, then a compatible **Google Play** system image. A Google APIs-only image does not include the Play Store. Follow [Android's device guide](https://developer.android.com/studio/run/managing-avds).
3. Match the image architecture to the host: ARM64 on Apple Silicon, x86_64 on Windows/Linux x64 and Intel Mac. Recent API 36 Google Play images were used during Windows testing; availability and app compatibility may change.
4. Create two clearly named devices, for example `SpicySwipe_Hinge` and `SpicySwipe_Bumble`. Boot one at a time for initial setup.
5. Sign in to Google Play yourself, install the intended app, and complete its normal sign-in. SpicySwipe does not supply accounts, bypass verification, or install modified APKs.

You can use physical Android phones instead. Enable Developer options and USB debugging, connect by USB, and approve your computer's debugging prompt. Use two phones, or a phone and an emulator, for concurrent mobile sessions.

## Connect in SpicySwipe

1. Select **Hinge** or **Bumble**, then **Devices**.
2. If tools are missing, choose the SDK root containing `platform-tools` and `emulator` with **Choose SDK folder**.
3. Choose the matching emulator and click **Start emulator**, or select an already online device.
4. Click **Connect selected device**. Use **Open app in Play Store** if installation is still needed, then **Open app**.
5. Sign in and open the ordinary discovery/profile screen. Repeat for the other app with its separate device.

Device preferences are stored per platform. After setup, **Start session** prepares the saved connection and launches the app when possible. Sign-in screens, missing apps, disconnected devices, and unsupported dialogs still require attention.

## Run sessions

- **Hinge:** choose plain Likes (default) or opt into AI comments. Profile scrolling and photo selection are configurable. The recognized Rose offer uses **Send Like anyway**; Roses are not purchased or sent by this flow. Hinge OCR automation currently requires Windows and English screen labels.
- **Bumble:** right swipe means Like; left swipe means pass. The current automated flow supports these actions, not Compliments or messaging.
- Set each app's Like ratio, action cap, timing, breaks, and session duration. Enable background operation for a session that should keep running when another platform tab is selected.
- Start each app's session separately. Keep the desktop app open. Use its status, pause, and stop controls to manage each run.

Do not manually navigate a device while its automated session is acting. Pause first. A profile change, unknown overlay, or uncertain action result can stop the session to prevent acting on the wrong screen. See [troubleshooting](TROUBLESHOOTING.md).

## View and input

Use **Larger view** to give the phone more space, or **Pop out** for a separate resizable window. Click the preview to tap; use the provided scroll/back buttons and keyboard input. Basic English text entry is supported through ADB; use the device keyboard for emoji and unsupported characters.

## Advanced SDK configuration

The app checks `ANDROID_HOME`, `ANDROID_SDK_ROOT`, then the conventional OS SDK location. The folder chosen in the app can override detection. For virtualization and graphics problems, consult [Android's acceleration documentation](https://developer.android.com/studio/run/emulator-acceleration). Graphics behavior depends on your GPU and emulator version; a successful boot does not guarantee an app's long-running rendering stability.

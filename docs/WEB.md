# Run the web workspace

This single-user Linux service serves the workspace UI to your browser. Its API runs the same settings service, Android controllers and Tinder command handlers as the desktop app. Only Tinder and Android device views use remotely rendered images. Everyone with the workspace password controls the same accounts. Use one browser tab at a time.

From this checkout, with Docker Compose installed, generate secrets once and start the service:

```sh
(umask 077; set -C; { echo "SPICYSWIPE_PASSWORD=$(openssl rand -hex 24)"; echo "SPICYSWIPE_STORAGE_KEY=$(openssl rand -hex 32)"; } > .env)
docker compose up -d --build
```

On your computer run `ssh -N -L 8187:127.0.0.1:8187 user@server`, then open [the workspace](http://127.0.0.1:8187). Enter the workspace password (`SPICYSWIPE_PASSWORD` in the server’s .env file). The browser stays signed in for up to 12 hours. Choose **Sign out** to lock the workspace on that browser. Restarting the service also ends browser sessions. For a domain, route an HTTPS reverse proxy to the private service port and disable buffering for /api/events. The supplied Compose mapping only listens on server loopback.

Use **Show Tinder** to sign in to the server's browser. Click the Tinder image to tap, type, paste, or scroll. Location requests default to denied. Sign-in methods requiring a local hardware device, camera or passkey need separate validation.

For Hinge or Bumble, first connect an Android device reachable from the container. For a phone with wireless debugging enabled, run these commands using the two addresses shown in Android's wireless debugging settings:

```sh
docker compose exec spicyswipe adb pair PHONE_IP:PAIRING_PORT
docker compose exec spicyswipe adb connect PHONE_IP:DEBUG_PORT
docker compose exec spicyswipe adb devices -l
```

Choose the corresponding platform and online device in the workspace. An already-running emulator reachable at a private ADB endpoint can also be connected with adb connect. The container includes ADB. To launch AVDs inside it, supply a compatible Linux SDK and configured AVDs and pass through /dev/kvm with permissions for UID 10001. The default deployment does not provision an emulator. Use separate Android instances for simultaneous Hinge and Bumble sessions. Hinge automation that requires Windows OCR retains the desktop Linux limitation.

The workspace volume holds server-side Tinder cookies, settings, Android pairing keys and mobile session checkpoints. Back up that volume and the .env together. The storage key encrypts saved provider credentials. Use `docker compose down` to stop the service while retaining data. Ollama must be reachable from inside the container.

The Chromium renderer uses namespaces. Compose loads the [Playwright seccomp profile](https://github.com/microsoft/playwright/blob/v1.56.1/utils/docker/seccomp_profile.json) so Chromium can start its sandbox on Docker. The server was exercised on Linux x86-64.

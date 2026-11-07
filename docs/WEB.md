# Run the web workspace

This single-user Linux service serves the workspace UI to your browser. Its API runs the same settings service, Android controllers and Tinder command handlers as the desktop app. Only Tinder and Android device views use remotely rendered images. Everyone with the workspace password controls the same accounts. Use one browser tab at a time.

Deploy this application through Coolify. Use the GitHub source `Fanclan/SpicySwipeWeb`, branch `main`, the Docker Compose build pack, and `/compose.yaml`. Enable automatic deployments on push. The GitHub App must have access to the repository and deliver push events to this Coolify instance.

In Coolify, set the runtime variables `SPICYSWIPE_PASSWORD`, `SPICYSWIPE_STORAGE_KEY`, and `SPICYSWIPE_LAN_IP`. The password must contain at least 16 characters and the storage key must be 32 bytes encoded as 64 hex characters. For a migration, reuse both existing secrets and the existing Docker volume `spicyswipe_workspace` on the same server. The Compose definition mounts that external volume at `/data`. For a first installation, provision the named volume before deploying.

Open `http://<server-LAN-IP>:8187` on the same network and enter the workspace password. The browser stays signed in for up to 12 hours. Choose **Sign out** to lock the workspace on that browser. Restarting the service also ends browser sessions. The direct LAN connection uses HTTP. For a domain, route an HTTPS reverse proxy to container port 8080 and disable buffering for /api/events.

Use **Show Tinder** to sign in to the server's browser. Click the Tinder image to tap, type, paste, or scroll. Location requests default to denied. Sign-in methods requiring a local hardware device, camera or passkey need separate validation.

For Hinge or Bumble, first connect an Android device reachable from the container. For a phone with wireless debugging enabled, use the Coolify application terminal for the running service and the two addresses shown in Android's wireless debugging settings:

```sh
adb pair PHONE_IP:PAIRING_PORT
adb connect PHONE_IP:DEBUG_PORT
adb devices -l
```

Choose the corresponding platform and online device in the workspace. An already-running emulator reachable at a private ADB endpoint can also be connected with adb connect. The container includes ADB. To launch AVDs inside it, supply a compatible Linux SDK and configured AVDs and pass through /dev/kvm with permissions for UID 10001. The default deployment does not provision an emulator. Use separate Android instances for simultaneous Hinge and Bumble sessions. Hinge automation that requires Windows OCR retains the desktop Linux limitation.

The workspace volume holds server-side Tinder cookies, settings, Android pairing keys and mobile session checkpoints. Back up the volume and its corresponding Coolify secrets together. The storage key encrypts saved provider credentials. Use Coolify to stop or redeploy the service. Ollama must be reachable from inside the container.

The Chromium renderer uses namespaces. Compose loads the [Playwright seccomp profile](https://github.com/microsoft/playwright/blob/v1.56.1/utils/docker/seccomp_profile.json) so Chromium can start its sandbox on Docker. The server was exercised on Linux x86-64.

# Run the web workspace

This single-user Linux service serves the workspace UI to your browser. Its API runs the same settings service, Android controllers and Tinder command handlers as the desktop app. Only Tinder and Android device views use remotely rendered images. Everyone with the workspace password controls the same accounts. Use one browser tab at a time.

Deploy this application through Coolify. Use the GitHub source `Fanclan/SpicySwipeWeb`, branch `main`, and the Docker Compose build pack. For a fresh workspace, select `/compose.install.yaml`. Coolify creates its persistent volume automatically. For the existing production workspace or a migration using the named volume `spicyswipe_workspace`, select `/compose.yaml`. Keep the selected manifest on redeployments so the same data stays mounted. Enable automatic deployments on push. Keep pull request previews disabled for this application because its fixed ports and workspace volume belong to production. The GitHub App must have access to the repository and deliver push events to this Coolify instance.

In Coolify, set the runtime variables `SPICYSWIPE_PASSWORD`, `SPICYSWIPE_STORAGE_KEY`, and `SPICYSWIPE_LAN_IP`. The password must contain at least 16 characters and the storage key must be 32 bytes encoded as 64 hex characters. Both manifests mount the workspace volume at `/data`. For a migration, reuse both existing secrets along with the external volume on the same server.

On the first deployment, the x86-64 server downloads the Android Emulator and the Android 16 Google Play system image directly from Google, verifies pinned SHA-256 checksums and caches them in the workspace volume. Allow approximately 2.2 GB of downloads and 20 GB of free disk space for the SDK and two growing phone disks. Each phone has 3 GB of guest RAM. Both use private loopback ADB endpoints. The emulator uses KVM when the container's user has read/write access to `/dev/kvm` and otherwise uses software CPU emulation, which increases boot time. Review the [Android SDK license](https://developer.android.com/studio/terms) for the SDK's permitted uses.

### Accelerate the Android phones with KVM

1. On the Linux server running Docker for Coolify, run `stat -c '%F %a %g' /dev/kvm`. It should identify a character device and a numeric group with read/write access.
2. If Docker runs inside a Proxmox LXC that lacks the device, the Proxmox administrator can assign the host's `/dev/kvm` under the Coolify container's **Resources → Add → Device Passthrough**. Set mode `0660` and the numeric `kvm` group ID from `getent group kvm` **inside the LXC**. Apply any pending container changes during a maintenance window, then repeat the `stat` check inside the LXC. [Proxmox device configuration](https://pve.proxmox.com/pve-docs/pct.conf.5.html)
3. In the application's Coolify environment, set `SPICYSWIPE_KVM_DEVICE=/dev/kvm` and `SPICYSWIPE_KVM_GID` to the numeric group from `stat`. Redeploy the same Git source and Compose manifest. Existing phone data stays in the workspace volume.
4. In the Coolify application terminal, run `/opt/android/emulator/emulator -accel-check` as the app user. Look for `KVM … is installed and usable`. The application logs report `acceleration on` when each phone starts. [Android acceleration checks](https://developer.android.com/studio/run/emulator-acceleration)

Open `http://<server-LAN-IP>:8187` on the same network and enter the workspace password. The browser stays signed in for up to 12 hours. Choose **Sign out** to lock the workspace on that browser. Restarting the service also ends browser sessions. The direct LAN connection uses HTTP. For a domain, route an HTTPS reverse proxy to container port 8080 and disable buffering for /api/events.

Use **Show Tinder** to sign in to the server's browser. Click the Tinder image to tap, type, paste, or scroll. To use nearby profiles, open the workspace over HTTPS (or localhost through an SSH tunnel), choose **Share device location**, and allow your browser to use your location. The workspace accepts a device reading up to one minute old and retries once at higher accuracy if the browser cannot get a fix. On a Mac, turn on Wi-Fi and allow the browser under **System Settings → Privacy & Security → Location Services**. If both attempts fail, you can enter your current coordinates from a map and choose **Share approximate location**. The workspace rounds manually entered coordinates to two decimal places before sending them. Tinder reloads when sharing succeeds. The reading is available for up to 15 minutes. Choose **Stop sharing** to end access sooner. The plain HTTP LAN address does not support browser geolocation. Sign-in methods requiring a local hardware device, camera or passkey need separate validation.

Choose **Hinge** or **Bumble** in the workspace. Each app opens its own persistent Android phone. The phone pane shows boot progress, then the app itself or its Google Play listing. On first use, sign in to Google Play on that phone and install the app. Leave the tab open to launch it when installation finishes, or choose **Check installation**. Sign in to Hinge or Bumble directly on the phone. Set Hinge to English so the server can verify the comment field before sending a Like. If setup reports an error, choose **Try again**.

New web sessions default to **Keep running when this tab closes**. With that setting enabled, you can close the tab or turn off your computer. The server keeps each session’s count and deadline. Closing the tab that shared your location still ends location sharing. If the managed Hinge phone returns to its Android home screen, the session can reopen Hinge and check the previous Like before continuing.

To change Android preferences on the connected phone, choose **Advanced settings** and **Open Android settings**. Use **Reopen Google Play** to return to the listing during installation, or **Open Hinge** or **Open Bumble** to return to an installed app.

To use an external Android device, connect it to ADB on the server, select the app tab, then open **Advanced settings** and choose the online device. That app keeps the selected device across reloads. **Use assigned phone** switches it back. For a phone with wireless debugging, run these commands in the Coolify application terminal using the pairing and debugging addresses from the phone:

```sh
adb pair PHONE_IP:PAIRING_PORT
adb connect PHONE_IP:DEBUG_PORT
adb devices -l
```

The workspace volume holds server-side Tinder cookies, settings, Android pairing keys, both phones' data disks and mobile session checkpoints. Stop the app in Coolify before backing up the volume and its corresponding secrets together. The storage key encrypts saved provider credentials. Use Coolify to stop or redeploy the service. Ollama must be reachable from inside the container.

The Chromium renderer uses namespaces. Compose loads the [Playwright seccomp profile](https://github.com/microsoft/playwright/blob/v1.56.1/utils/docker/seccomp_profile.json) so Chromium can start its sandbox on Docker. The server was exercised on Linux x86-64.

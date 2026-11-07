#!/bin/bash
set -eu -o pipefail
umask 077

runtime="$HOME/android-runtime"
sdk="$runtime/sdk"
images=system-images/android-36/google_apis_playstore
repository=https://dl.google.com/android/repository
mkdir -p "$runtime" "$ANDROID_AVD_HOME"

status() {
  printf '%s\n' "$1" >"$runtime/status.new"
  mv "$runtime/status.new" "$runtime/status"
}

install_package() {
  local url=$1 checksum=$2 target=$3 archive="$runtime/install/package.zip"
  mkdir -p "$target"
  curl --fail --location --silent --show-error --retry 3 --connect-timeout 20 --max-time 2400 \
    "$url" -o "$archive"
  echo "$checksum  $archive" | sha256sum --check --status
  unzip -qo "$archive" -d "$target"
  rm -f "$archive"
}

if [[ ${1:-} == install ]]; then
  # Only a complete SDK becomes visible to the app. Private writable phone
  # disks live separately, so a failed download cannot reset an account.
  staging="$runtime/install/sdk"
  install_package "$repository/emulator-linux_x64-16740729.zip" \
    cbc7c3cfb83220b8a0f9c513fdab557712e74d339ec19ddffa43f23350ae9bdd "$staging"
  install_package "$repository/sys-img/google_apis_playstore/x86_64-36_r07.zip" \
    279c419c2829627e2bb95104f47e6de02ca9d14774506195d5db93d71bd583c8 "$staging/$images"
  mv -T "$staging" "$sdk"
  exit
fi

create_avd() {
  local avd=$1 dir="$ANDROID_AVD_HOME/$1.avd"
  mkdir -p "$dir"
  if [[ ! -f "$dir/config.ini" ]]; then
    cat >"$dir/config.ini.new" <<EOF
AvdId=$avd
PlayStore.enabled=true
abi.type=x86_64
avd.ini.encoding=UTF-8
disk.dataPartition.size=6G
hw.cpu.arch=x86_64
hw.cpu.ncore=2
hw.gpu.enabled=yes
hw.gpu.mode=swiftshader
hw.keyboard=yes
hw.lcd.density=320
hw.lcd.height=1280
hw.lcd.width=720
hw.ramSize=3072
image.sysdir.1=$images/x86_64/
tag.id=google_apis_playstore
tag.display=Google Play
EOF
    mv "$dir/config.ini.new" "$dir/config.ini"
  fi
  if [[ ! -f "$ANDROID_AVD_HOME/$avd.ini" ]]; then
    printf 'avd.ini.encoding=UTF-8\npath=%s\ntarget=android-36\n' "$dir" >"$ANDROID_AVD_HOME/$avd.ini.new"
    mv "$ANDROID_AVD_HOME/$avd.ini.new" "$ANDROID_AVD_HOME/$avd.ini"
  fi
}

run_phone() {
  local avd=$1 port=$2
  while true; do
    echo "Starting $avd on emulator-$port (acceleration $accel)"
    "$ANDROID_HOME/emulator/emulator" "@$avd" -port "$port" -accel "$accel" -gpu swiftshader \
      -no-window -noaudio -no-snapshot -no-boot-anim -no-metrics || true
    echo "$avd stopped. Retrying in 30 seconds."
    sleep 30
  done
}

# Protect both user disks through overlapping deployments on the same volume.
exec 9>"$runtime/phones.lock"
flock 9
if [[ $(uname -m) != x86_64 ]]; then
  status unsupported
  echo 'Managed Android images require an x86-64 host.'
  exit 1
fi
until [[ -x "$sdk/emulator/emulator" && -f "$sdk/$images/x86_64/system.img" ]]; do
  status installing
  echo 'Installing the Google Android Emulator and Google Play API 36 image.'
  bash "$0" install || { status retrying; echo 'Android SDK installation failed. Retrying in 60 seconds.'; sleep 60; }
done
status starting

# Starting the daemon first creates this installation's persistent ADB host
# key before Android reads it on first boot. ADB listens on loopback.
"$ANDROID_HOME/platform-tools/adb" start-server
accel=off
if [[ -r /dev/kvm && -w /dev/kvm ]] && "$ANDROID_HOME/emulator/emulator" -accel-check >/dev/null 2>&1; then
  accel=on
fi
create_avd SpicySwipe_Phone_API_36
create_avd SpicySwipe_Bumble_API_36
run_phone SpicySwipe_Phone_API_36 5554 &
run_phone SpicySwipe_Bumble_API_36 5556 &
wait

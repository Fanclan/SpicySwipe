#!/bin/bash
set -u

if [[ ${SPICYSWIPE_MANAGED_ANDROID:-1} != 1 ]]; then
  exec "$@"
fi

# Give each service a process group so SIGTERM reaches the emulator and browser
# children as well as their shell wrappers when Coolify replaces the container.
setsid bash /app/web/managed-phones.sh &
phones=$!
setsid "$@" &
web=$!
cleanup() {
  trap '' TERM INT
  kill -TERM -- "-$web" "-$phones" 2>/dev/null || true
  wait "$web" "$phones" 2>/dev/null || true
}
trap 'cleanup; exit 0' TERM INT
status=0
wait "$web" || status=$?
cleanup
exit "$status"

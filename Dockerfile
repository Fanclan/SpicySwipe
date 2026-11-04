FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci && node -e "require('electron')" && test -f node_modules/electron/dist/electron
COPY . .
RUN npm run desktop:build && npm test

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends xvfb xauth adb libgtk-3-0t64 libnss3 libasound2t64 libgbm1 libxss1 libxtst6 libsecret-1-0 fonts-liberation ca-certificates dbus-x11 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 10001 spicy && install -d -o spicy -g spicy /data && install -d /opt/android/platform-tools && ln -s /usr/bin/adb /opt/android/platform-tools/adb
WORKDIR /app
COPY --from=build /app/node_modules/electron/dist /opt/electron
RUN chmod 4755 /opt/electron/chrome-sandbox
COPY --from=build /app/desktop ./desktop
COPY shared shared
COPY ui ui
COPY assets assets
COPY web web
COPY package.json .
ENV ANDROID_HOME=/opt/android HOME=/data SPICYSWIPE_WEB=1
USER spicy
EXPOSE 8080
CMD ["dbus-run-session","--","xvfb-run","-a","/opt/electron/electron","--disable-gpu","/app"]

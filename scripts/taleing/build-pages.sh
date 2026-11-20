#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
export TALEING_BASE_PATH=/taleing/
export VITE_APP_GIT_SHA="$(git rev-parse HEAD)"
export VITE_APP_ENABLE_TRACKING=false

corepack yarn build:app:docker
corepack yarn build:version

build=excalidraw-app/build
mkdir -p "$build/licenses"
sed -i 's|href="/sitemap.xml"|href="/taleing/sitemap.xml"|' "$build/index.html"
cp LICENSE "$build/LICENSE"
cp packages/laser-pointer/LICENSE "$build/licenses/laser-pointer.txt"
sed -i \
  -e 's|href="/|href="/taleing/|g' \
  -e 's|Open Excalidraw|Open Taleing|g' \
  -e 's@Page not found | Excalidraw@Page not found | Taleing@g' \
  "$build/404.html"
sed -i 's|https://excalidraw.com/sitemap.xml|https://vahiela.github.io/taleing/sitemap.xml|' "$build/robots.txt"

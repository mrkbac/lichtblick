#!/usr/bin/env bash
# Cloudflare Pages build (the dashboard build command runs this script).
# The Pages image installs the pnpm version from `packageManager`.
set -euo pipefail
pnpm install --frozen-lockfile
pnpm web:build:prod
cp web/.cloudflare/* web/.webpack/
git archive --format=zip --prefix=licht-ws-proxy/ -o web/.webpack/licht-ws-proxy.zip HEAD:chrome-extension

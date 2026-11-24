#!/usr/bin/env bash
# Cloudflare Pages build (the dashboard build command runs this script).
# The Pages image installs the pnpm version from `packageManager`.
set -euo pipefail
pnpm install --frozen-lockfile
pnpm web:build:prod
cp packages/suite-web/.cloudflare/* web/.webpack/
git archive --format=zip --prefix=digitalis-proxy/ -o web/.webpack/digitalis-proxy.zip HEAD:chrome-extension

#!/bin/bash
# Remove build outputs and TypeScript build info (written by `yarn build:packages`).
rimraf --glob .webpack "*/.webpack" dist "packages/*/dist" storybook-screenshots storybook-static coverage "packages/**/*.tsbuildinfo"
echo "Build cleaned."

#!/bin/bash
# Remove build outputs: bundles, `tsc --build` output of the packages, Storybook and coverage.
rm -rf .webpack */.webpack benchmark/.webpack-desktop dist packages/*/dist packages/*/tsconfig.tsbuildinfo storybook-screenshots storybook-static coverage
echo "Build cleaned."

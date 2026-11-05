#!/bin/bash
# Remove build outputs. Packages are typechecked with noEmit, so there is no tsc output to clean.
rimraf --glob .webpack "*/.webpack" dist storybook-screenshots storybook-static coverage
echo "Build cleaned."

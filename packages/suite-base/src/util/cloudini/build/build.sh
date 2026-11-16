#!/usr/bin/env bash
# Rebuilds ../wasm/cloudini_decoder.{js,wasm} from upstream Cloudini (Apache-2.0) with Docker.
# Bump CLOUDINI_COMMIT to update; the decoder reads every wire version up to that release.
set -euo pipefail

CLOUDINI_COMMIT=60ddb44740f24a8c4d9585d7e3764443ff7c385a # 1.4.1+, reads V2-V6
EMSDK_IMAGE=emscripten/emsdk:4.0.10

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -sSfL "https://github.com/facontidavide/cloudini/archive/${CLOUDINI_COMMIT}.tar.gz" |
  tar -xz -C "$work"
cp "$here/CMakeLists.txt" "$here/decoder.cpp" "$work/"

docker run --rm -v "$work:/src" -w /src "$EMSDK_IMAGE" bash -c "
  emcmake cmake -B build -S . -DCLOUDINI_SOURCE_DIR=/src/cloudini-${CLOUDINI_COMMIT} \
    -DCMAKE_CXX_FLAGS='-fwasm-exceptions' -DCMAKE_C_FLAGS='-fwasm-exceptions' >/dev/null &&
  cmake --build build --target cloudini_decoder -j8 >/dev/null"

cp "$work/build/cloudini_decoder.js" "$work/build/cloudini_decoder.wasm" "$here/../wasm"
cp "$work/cloudini-${CLOUDINI_COMMIT}/LICENSE" "$here/../wasm/LICENSE"
ls -l "$here/../wasm"

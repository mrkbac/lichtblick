#!/bin/sh
# SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
# SPDX-License-Identifier: MPL-2.0
#
# Rebuilds zstd.wasm: zstd's decompressor (BSD-3-Clause, https://github.com/facebook/zstd) plus
# zstd.c, compiled with zig's clang and wasi-libc. Needs curl and zig 0.17.x. The output is
# committed, so this only runs when zstd, zstd.c or the flags change.
set -eu

ZSTD_VERSION=1.5.7
ZSTD_SHA256=eb33e51f49a15e023950cd7825ca74a4a2b43db8354825ac24fc1b7ee09e6fa3

case "$(zig version)" in
  0.17.*) ;;
  *) echo "zig 0.17.x required, found $(zig version)" >&2; exit 1 ;;
esac

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

curl -sSfL -o "$work/zstd.tar.gz" "https://github.com/facebook/zstd/releases/download/v$ZSTD_VERSION/zstd-$ZSTD_VERSION.tar.gz"
echo "$ZSTD_SHA256  $work/zstd.tar.gz" | shasum -a 256 -c - >/dev/null
tar xzf "$work/zstd.tar.gz" -C "$work"
lib="$work/zstd-$ZSTD_VERSION/lib"

# -msimd128 and -mbulk-memory: every browser we support has them. Legacy formats, asm, tracing and
# debug logging are compiled out.
zig cc -target wasm32-wasi -mexec-model=reactor -O3 -msimd128 -mbulk-memory \
  -Wl,--export=__heap_base -Wl,--export-memory -Wl,-z,stack-size=131072 -Wl,--strip-all \
  -DZSTD_LEGACY_SUPPORT=0 -DZSTD_DISABLE_ASM -DDYNAMIC_BMI2=0 -DZSTD_TRACE=0 -DDEBUGLEVEL=0 \
  -DXXH_NAMESPACE=ZSTD_ -DNDEBUG \
  -I"$lib" -I"$lib/common" \
  "$here/zstd.c" \
  "$lib/common/entropy_common.c" "$lib/common/error_private.c" "$lib/common/fse_decompress.c" \
  "$lib/common/xxhash.c" "$lib/common/zstd_common.c" \
  "$lib/decompress/huf_decompress.c" "$lib/decompress/zstd_ddict.c" \
  "$lib/decompress/zstd_decompress.c" "$lib/decompress/zstd_decompress_block.c" \
  -o "$here/zstd.wasm"

shasum -a 256 "$here/zstd.wasm"

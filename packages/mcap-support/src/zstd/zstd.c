// SPDX-License-Identifier: MPL-2.0

// Decompress-only zstd for wasm (built by build.sh): one static decompression context and no
// allocator, so the JS side owns the rest of linear memory for staging input and output.

#define ZSTD_STATIC_LINKING_ONLY
#include <stddef.h>

#include "zstd.h"

// The static context never allocates; these only satisfy references in zstd's common code.
void* malloc(size_t size) { (void)size; return NULL; }
void* calloc(size_t count, size_t size) { (void)count; (void)size; return NULL; }
void free(void* ptr) { (void)ptr; }

static _Alignas(16) unsigned char workspace[1 << 18];
static ZSTD_DCtx* dctx;

// Decompresses one or more frames from src into dst. Returns the decompressed size, or
// (size_t)-1 on any error (corrupt input, dst too small).
__attribute__((export_name("decompress"))) size_t decompress(void* dst, size_t dstCapacity, const void* src, size_t srcSize) {
  if (dctx == NULL) {
    dctx = ZSTD_initStaticDCtx(workspace, sizeof(workspace));
    if (dctx == NULL) {
      return (size_t)-1;
    }
  }
  size_t result = ZSTD_decompressDCtx(dctx, dst, dstCapacity, src, srcSize);
  return ZSTD_isError(result) ? (size_t)-1 : result;
}

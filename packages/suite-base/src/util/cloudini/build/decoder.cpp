// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Decode-only entry points for the Cloudini WASM module. Unlike upstream's wasm_functions.cpp, the
// caller passes the output capacity: the payload header, not the message, says how many bytes the
// decoder writes, and a file must not be able to make it write past the buffer.

#include <emscripten/emscripten.h>

#include <cstring>
#include <exception>
#include <string>

#include "cloudini_lib/cloudini.hpp"

extern "C" {

// Decodes into `output`, zeroing it first (the decoder skips padding bytes). Returns 0 on success,
// otherwise a pointer to a static error message.
EMSCRIPTEN_KEEPALIVE const char* cldn_Decode(
    const uint8_t* input, uint32_t input_size, uint8_t* output, uint32_t output_capacity) {
  static std::string error;
  try {
    Cloudini::ConstBufferView view(input, input_size);
    const auto info = Cloudini::DecodeHeader(view);
    const uint64_t size = uint64_t(info.width) * info.height * info.point_step;
    if (size != output_capacity) {
      error = "decoded size " + std::to_string(size) + " does not match the message (" +
              std::to_string(output_capacity) + " bytes)";
      return error.c_str();
    }
    std::memset(output, 0, output_capacity);
    Cloudini::PointcloudDecoder().decode(info, view, Cloudini::BufferView(output, output_capacity));
    return nullptr;
  } catch (const std::exception& ex) {
    error = ex.what();
    return error.c_str();
  }
}
}

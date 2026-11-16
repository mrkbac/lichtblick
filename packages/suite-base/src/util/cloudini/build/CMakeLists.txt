cmake_minimum_required(VERSION 3.16)
project(cloudini_decoder CXX C)

set(CMAKE_BUILD_TYPE Release)
add_subdirectory(${CLOUDINI_SOURCE_DIR}/cloudini_lib cloudini_lib)

add_executable(cloudini_decoder decoder.cpp)
target_compile_features(cloudini_decoder PRIVATE cxx_std_20)
target_link_libraries(cloudini_decoder PRIVATE cloudini_lib)
set_target_properties(cloudini_decoder PROPERTIES SUFFIX ".js")
target_link_options(cloudini_decoder PRIVATE
  -fwasm-exceptions
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createCloudiniModule
  -sENVIRONMENT=web,worker,node
  -sFILESYSTEM=0
  -sALLOW_MEMORY_GROWTH=1
  -sMAXIMUM_MEMORY=4GB
  -sEXPORTED_FUNCTIONS=_malloc,_free,_cldn_Decode
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,UTF8ToString
)

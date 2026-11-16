// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { HUDItem } from "@lichtblick/suite-base/panels/ThreeDeeRender/HUDItemManager";
import { t3D } from "@lichtblick/suite-base/panels/ThreeDeeRender/t3D";

export const IMAGE_TOPIC_PATH = ["imageMode", "imageTopic"];
export const DECODE_IMAGE_ERR_KEY = "CreateBitmap";

export const IMAGE_MODE_HUD_GROUP_ID = "IMAGE_MODE";

export const BOTH_TOPICS_DO_NOT_EXIST_HUD_ITEM_ID = "BOTH_TOPICS_DO_NOT_EXIST";
export const IMAGE_TOPIC_DOES_NOT_EXIST_HUD_ITEM_ID = "IMAGE_TOPIC_DOES_NOT_EXIST";
export const CALIBRATION_TOPIC_DOES_NOT_EXIST_HUD_ITEM_ID = "CALIBRATION_TOPIC_DOES_NOT_EXIST";
export const WAITING_FOR_SYNC_NOTICE_HUD_ID = "WAITING_FOR_SYNC_NOTICE";
export const WAITING_FOR_SYNC_EMPTY_HUD_ID = "WAITING_FOR_SYNC_EMPTY";
export const WAITING_FOR_IMAGES_EMPTY_HUD_ID = "WAITING_FOR_IMAGES_EMPTY";
export const WAITING_FOR_BOTH_MESSAGES_HUD_ID = "WAITING_FOR_BOTH_MESSAGES";
export const WAITING_FOR_CALIBRATION_HUD_ID = "WAITING_FOR_CALIBRATION";
export const WAITING_FOR_IMAGES_NOTICE_ID = "WAITING_FOR_IMAGES_NOTICE";

export const CALIBRATION_TOPIC_PATH = ["imageMode", "calibrationTopic"];
export const IMAGE_TOPIC_UNAVAILABLE = "IMAGE_TOPIC_UNAVAILABLE";
export const CALIBRATION_TOPIC_UNAVAILABLE = "CALIBRATION_TOPIC_UNAVAILABLE";
export const MISSING_CAMERA_INFO = "MISSING_CAMERA_INFO";
export const IMAGE_TOPIC_DIFFERENT_FRAME = "IMAGE_TOPIC_DIFFERENT_FRAME";
export const CAMERA_MODEL = "CameraModel";
export const DEFAULT_FOCAL_LENGTH = 500;
export const REMOVE_IMAGE_TIMEOUT_MS = 50;

export {
  ALL_SUPPORTED_CALIBRATION_SCHEMAS,
  ALL_SUPPORTED_IMAGE_SCHEMAS,
  SUPPORTED_RAW_IMAGE_SCHEMAS,
} from "./schemas";

export {
  DEFAULT_IMAGE_CONFIG,
  INITIAL_BRIGHTNESS,
  INITIAL_CONTRAST,
  MAX_BRIGHTNESS,
  MAX_CONTRAST,
  MIN_BRIGHTNESS,
  MIN_CONTRAST,
} from "../../settingsNodes/imageMode";

// Brightness should be in the range of -1 and 1.
// It was trimmed by 0.4 to improve visualization.
export const LOWER_BRIGHTNESS_LIMIT = -0.6;
export const UPPER_BRIGHTNESS_LIMIT = 0.6;

// Contrast should be in the range of 0 and 2.
// It was trimmed by 0.1 to improve visualization.
export const LOWER_CONTRAST_LIMIT = 0.1;
export const UPPER_CONTRAST_LIMIT = 1.9;

export const NO_IMAGE_TOPICS_HUD_ITEM: HUDItem = {
  id: "NO_IMAGE_TOPICS",
  group: IMAGE_MODE_HUD_GROUP_ID,
  getMessage: () => t3D("noImageTopicsAvailable"),
  displayType: "empty",
};

export const VERTEX_SHADER = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

// Custom GLSL scrpit to apply brightness, contrast and other properties to the image texture
// Source: https://github.com/mrdoob/three.js/blob/master/src/materials/ShaderMaterial.js
export const FRAGMENT_SHADER = `
    uniform sampler2D map;
    uniform float brightness;
    uniform float contrast;
    uniform vec3 color;
    uniform float opacity;
    varying vec2 vUv;

    void main() {
        vec4 texColor = texture2D(map, vUv);

        // Apply brightness
        texColor.rgb += brightness;

        // Apply contrast
        texColor.rgb = ((texColor.rgb - 0.5) * contrast) + 0.5;

        // Apply tint color and opacity
        texColor.rgb *= color;
        texColor.a *= opacity;

        gl_FragColor = texColor;
    }
`;

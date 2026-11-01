// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { fromUrl } from "geotiff";

import { LngLat, utmToLngLat, webMercatorToLngLat } from "./geo";
import type { ImageOverlay } from "./layers";

// ponytail: the whole image is decoded once, downsampled to this size. Streaming tiles from
// Cloud Optimized GeoTIFFs would lift the limit if huge orthophotos become common.
const MAX_SIZE = 4096;

/** Returns a converter from the file's CRS to lon/lat, or throws for unsupported CRSs. */
export function crsToLngLat(epsg: number): (x: number, y: number) => LngLat {
  if (epsg === 4326 || epsg === 4258 || epsg === 4269) {
    return (x, y) => [x, y];
  }
  if (epsg === 3857 || epsg === 900913 || epsg === 102100) {
    return webMercatorToLngLat;
  }
  if ((epsg >= 32601 && epsg <= 32660) || (epsg >= 32701 && epsg <= 32760)) {
    const zone = epsg % 100;
    const hemisphere = epsg >= 32701 ? "S" : "N";
    return (x, y) => utmToLngLat(x, y, zone, hemisphere);
  }
  throw new Error(
    `Unsupported coordinate system EPSG:${epsg}. Reproject to EPSG:4326, EPSG:3857, or UTM (e.g. with gdalwarp).`,
  );
}

function toRgba(
  bands: ArrayLike<number>[],
  width: number,
  height: number,
  noData: number | null,
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (bands.length >= 3) {
    const [r, g, b, a] = bands;
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = r![i]!;
      rgba[i * 4 + 1] = g![i]!;
      rgba[i * 4 + 2] = b![i]!;
      const transparent =
        noData != undefined && r![i] === noData && g![i] === noData && b![i] === noData;
      rgba[i * 4 + 3] = transparent ? 0 : a ? a[i]! : 255;
    }
    return rgba;
  }
  // Single band (elevation, intensity, ...): stretch min..max to grayscale.
  const band = bands[0]!;
  let min = Infinity;
  let max = -Infinity;
  for (const v of Array.from(band)) {
    if (v !== noData && isFinite(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  const scale = max > min ? 255 / (max - min) : 0;
  for (let i = 0; i < width * height; i++) {
    const v = band[i]!;
    const valid = v !== noData && isFinite(v);
    const gray = valid ? (v - min) * scale : 0;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = gray;
    rgba[i * 4 + 3] = valid ? 255 : 0;
  }
  return rgba;
}

/** Decode a georeferenced GeoTIFF into an image the map can place by its four corners. */
export async function loadGeoTiff(url: string, signal: AbortSignal): Promise<ImageOverlay> {
  const tiff = await fromUrl(url, {}, signal);
  const image = await tiff.getImage();
  const keys = image.getGeoKeys() ?? {};
  const epsg = Number(keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey ?? 4326);
  const toLngLat = crsToLngLat(epsg);
  const [minX, minY, maxX, maxY] = image.getBoundingBox() as [number, number, number, number];

  const scale = Math.min(1, MAX_SIZE / Math.max(image.getWidth(), image.getHeight()));
  const width = Math.max(1, Math.round(image.getWidth() * scale));
  const height = Math.max(1, Math.round(image.getHeight() * scale));

  // Palette and YCbCr images need color conversion; plain bands are read directly.
  const photometric = Number(image.fileDirectory.getValue("PhotometricInterpretation"));
  const bands =
    photometric === 3 || photometric === 6
      ? await image.readRGB({ width, height, enableAlpha: true, signal })
      : await tiff.readRasters({
          width,
          height,
          samples: [...Array(Math.min(image.getSamplesPerPixel(), 4)).keys()],
          signal,
        });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const rgba = toRgba(
    bands as unknown as ArrayLike<number>[],
    width,
    height,
    image.getGDALNoData(),
  );
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, width, height), 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) {
        resolve(b);
      } else {
        reject(new Error("Failed to encode image"));
      }
    }, "image/png");
  });

  return {
    url: URL.createObjectURL(blob),
    coordinates: [
      toLngLat(minX, maxY),
      toLngLat(maxX, maxY),
      toLngLat(maxX, minY),
      toLngLat(minX, minY),
    ],
  };
}

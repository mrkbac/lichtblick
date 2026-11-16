# /// script
# requires-python = ">=3.10"
# dependencies = ["mcap==1.3.0", "numpy==2.2.6", "pillow==11.3.0", "scipy==1.15.3", "jsonschema==4.25.1", "av==16.1.0"]
# ///
# SPDX-License-Identifier: MPL-2.0
"""Build the Boreas demo MCAP: uv run ci/create-boreas-sample.py (after pnpm install).

The dataset is CC BY 4.0 (Keenan Burnett et al., University of Toronto,
https://www.boreas.utias.utoronto.ca/); attribution is embedded in the MCAP metadata.
The file is not committed: upload the output to the host behind
SAMPLE_BOREAS_DATA_SOURCE_URL (packages/suite-base/src/dataSources/constants.ts).
"""

import base64
import csv
import io
import json
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
from pathlib import Path

import av
import jsonschema
import numpy as np
from mcap.reader import make_reader
from mcap.writer import CompressionType, Writer
from PIL import Image
from scipy.spatial.transform import Rotation

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(tempfile.gettempdir()) / "lichtblick-boreas"
OUTPUT = CACHE / "boreas-sample.mcap"
SEQUENCE = "boreas-2021-09-02-11-42"
BASE = "https://boreas.s3.amazonaws.com/"
LICENSE = "https://creativecommons.org/licenses/by/4.0/"
ATTRIBUTION = (
    "Boreas: A Multi-Season Autonomous Driving Dataset, Keenan Burnett et al., "
    "University of Toronto. https://www.boreas.utias.utoronto.ca/ — CC BY 4.0. "
    "Adapted for Lichtblick: 20-second excerpt starting 170 seconds into "
    f"{SEQUENCE}; camera sampled at 10 Hz, resized to 1280 pixels wide and H.265 encoded; "
    "LiDAR sampled at 5 Hz with every fourth point retained, coordinates rounded to 12 "
    "mantissa bits and intensity stored as 8 bits; radar sampled at 4 Hz, range bins "
    "averaged in pairs and stored as a JPEG polar intensity image (columns: range, rows: azimuth); "
    "recorded IMU at 200 Hz and postprocessed GPS at 10 Hz; local pose origin shifted. "
    "GPS altitude is the dataset's relative altitude, not height above sea level. "
    "Original selected sensor timestamps retained. No motion compensation added."
)


def fetch(key: str) -> Path:
    cache = CACHE / key
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(3):
            try:
                with urllib.request.urlopen(BASE + key, timeout=120) as response:
                    data = response.read()
                break
            # urlopen wraps connection timeouts in URLError; other errors (e.g. 404) raise at once.
            except (TimeoutError, urllib.error.URLError) as error:
                timed_out = isinstance(error, TimeoutError) or isinstance(
                    error.reason, TimeoutError
                )
                if not timed_out or attempt == 2:
                    raise
                print(f"Retrying download ({error}): {key}", flush=True)
        # Write then rename, so an interrupted run never leaves a truncated cache entry.
        cache.with_suffix(".part").write_bytes(data)
        cache.with_suffix(".part").replace(cache)
    return cache


def download(key: str) -> bytes:
    return fetch(key).read_bytes()


def stamp(microseconds: int) -> dict[str, int]:
    return {"sec": microseconds // 1_000_000, "nsec": microseconds % 1_000_000 * 1000}


def frames(sensor: str, start: int, end: int, interval: int) -> list[tuple[int, str]]:
    query = urllib.parse.urlencode(
        {
            "list-type": "2",
            "prefix": f"{SEQUENCE}/{sensor}/",
            "max-keys": 1000,
            "start-after": f"{SEQUENCE}/{sensor}/{start}",
        }
    )
    with urllib.request.urlopen(BASE + "?" + query, timeout=90) as response:
        listing = ET.fromstring(response.read())
    keys = [x.text for x in listing.findall("{*}Contents/{*}Key") if x.text]
    candidates = sorted(
        (int(Path(k).stem), k) for k in keys if k.endswith((".png", ".bin"))
    )
    assert candidates and candidates[-1][0] >= end, (
        f"{sensor} listing does not cover excerpt"
    )
    selected: list[tuple[int, str]] = []
    for t, key in candidates:
        # Allow timestamp jitter while selecting the requested nominal sensor rate.
        if start <= t < end and (
            not selected or t - selected[-1][0] >= interval - 2000
        ):
            selected.append((t, key))
    return selected


def main() -> None:
    schemas = json.loads(
        subprocess.check_output(
            [
                "pnpm",
                "--filter",
                "@lichtblick/suite-base",
                "exec",
                "node",
                "-e",
                "console.log(JSON.stringify(require('@foxglove/schemas/jsonschema')))",
            ],
            cwd=ROOT,
            text=True,
        )
    )
    poses = list(
        csv.DictReader(
            io.StringIO(download(f"{SEQUENCE}/applanix/lidar_poses.csv").decode())
        )
    )
    start = int(poses[0]["GPSTime"]) + 170_000_000
    end = start + 20_000_000
    selected = [p for p in poses if start <= int(p["GPSTime"]) < end]
    origin = np.array(
        [float(selected[0][k]) for k in ("easting", "northing", "altitude")]
    )
    lidar = frames("lidar", start, end, 200_000)
    camera = frames("camera", start, end, 100_000)
    radar = frames("radar", start, end, 250_000)
    keys = [key for _, key in lidar + camera + radar]
    keys += [f"{SEQUENCE}/applanix/{name}.csv" for name in ("imu", "gps_post_process")]
    print(
        f"Downloading {len(lidar)} LiDAR, {len(camera)} camera, {len(radar)} radar frames and navigation",
        flush=True,
    )
    with ThreadPoolExecutor(max_workers=8) as pool:
        for i, _ in enumerate(pool.map(fetch, keys)):
            if i % 25 == 0:
                print(f"Downloaded {i + 1}/{len(keys)}", flush=True)
    events: list[tuple[int, str, str, dict]] = []
    identity = {"x": 0, "y": 0, "z": 0, "w": 1}
    for name, fields in {
        "Motion": ("speed", "velocity_east", "velocity_north", "velocity_up"),
        "Imu": (
            "accel_x",
            "accel_y",
            "accel_z",
            "angular_velocity_x",
            "angular_velocity_y",
            "angular_velocity_z",
        ),
    }.items():
        schemas[name] = {
            "type": "object",
            "properties": {k: {"type": "number"} for k in fields},
            "required": list(fields),
        }
    for row in selected:
        t = int(row["GPSTime"])
        translation = (
            np.array([float(row[k]) for k in ("easting", "northing", "altitude")])
            - origin
        )
        # Boreas defines C_enu_sensor = Rx(-roll) Ry(-pitch) Rz(-heading).
        quaternion = Rotation.from_euler(
            "XYZ", [-float(row[k]) for k in ("roll", "pitch", "heading")]
        ).as_quat()
        events.append(
            (
                t,
                "/boreas/tf",
                "FrameTransform",
                {
                    "timestamp": stamp(t),
                    "parent_frame_id": "map",
                    "child_frame_id": "lidar",
                    "translation": dict(zip(("x", "y", "z"), translation.tolist())),
                    "rotation": dict(zip(("x", "y", "z", "w"), quaternion.tolist())),
                },
            )
        )
        velocity = [float(row[k]) for k in ("vel_east", "vel_north", "vel_up")]
        events.append(
            (
                t,
                "/boreas/motion",
                "Motion",
                {
                    "speed": float(np.linalg.norm(velocity)),
                    **dict(
                        zip(
                            ("velocity_east", "velocity_north", "velocity_up"), velocity
                        )
                    ),
                },
            )
        )
    for sensor in ("camera", "radar", "applanix"):
        matrix = np.linalg.inv(
            np.loadtxt(io.BytesIO(download(f"{SEQUENCE}/calib/T_{sensor}_lidar.txt")))
        )
        events.append(
            (
                start,
                "/boreas/tf_static",
                "FrameTransform",
                {
                    "timestamp": stamp(start),
                    "parent_frame_id": "lidar",
                    "child_frame_id": sensor,
                    "translation": dict(zip(("x", "y", "z"), matrix[:3, 3].tolist())),
                    "rotation": dict(
                        zip(
                            ("x", "y", "z", "w"),
                            Rotation.from_matrix(matrix[:3, :3]).as_quat().tolist(),
                        )
                    ),
                },
            )
        )
    for t, key in lidar:
        raw = download(key)
        assert len(raw) % 24 == 0
        source = np.frombuffer(raw, dtype="<f4").reshape(-1, 6)[::4]
        assert np.isfinite(source[:, :4]).all() and len(source) > 1000
        # Rounding to 12 mantissa bits (<3 cm at 100 m) and 8-bit intensity compress far better.
        xyz = (source[:, :3].view("<u4") & np.uint32(0xFFFFF800)).view("<f4")
        # Zero padding keeps a 4-byte-aligned stride (the 3D panel's fast path) and compresses away.
        points = np.zeros(
            len(source),
            dtype=[("xyz", "<f4", 3), ("intensity", "u1"), ("pad", "u1", 3)],
        )
        points["xyz"] = xyz
        points["intensity"] = np.clip(np.rint(source[:, 3]), 0, 255)
        events.append(
            (
                t,
                "/boreas/lidar",
                "PointCloud",
                {
                    "timestamp": stamp(t),
                    "frame_id": "lidar",
                    "pose": {
                        "position": {"x": 0, "y": 0, "z": 0},
                        "orientation": identity,
                    },
                    "point_stride": 16,
                    "fields": [
                        *(
                            {"name": k, "offset": i * 4, "type": 7}
                            for i, k in enumerate(("x", "y", "z"))
                        ),
                        {"name": "intensity", "offset": 12, "type": 1},
                    ],
                    "data": base64.b64encode(points.tobytes()).decode(),
                },
            )
        )
    encoder = av.CodecContext.create("libx265", "w")
    encoder.width, encoder.height = 1280, 1070
    encoder.pix_fmt = "yuv420p"
    encoder.time_base = Fraction(1, 10)
    encoder.framerate = Fraction(10, 1)
    encoder.options = {
        "preset": "fast",
        "crf": "23",
        "x265-params": "bframes=0:keyint=10:min-keyint=10:scenecut=0:repeat-headers=1:log-level=error",
    }
    packets: list[av.Packet] = []
    decoder = av.CodecContext.create("hevc", "r")
    decoded = 0
    for i, (_, key) in enumerate(camera):
        image = Image.open(io.BytesIO(download(key))).convert("RGB")
        image = image.resize((1280, 1070), Image.Resampling.LANCZOS)
        frame = av.VideoFrame.from_image(image)
        frame.pts = i
        packets.extend(encoder.encode(frame))
    packets.extend(encoder.encode(None))
    assert len(packets) == len(camera)
    for i, packet in enumerate(packets):
        assert packet.pts == i and packet.dts == i, (
            "B-frames/reordered video are unsupported"
        )
        t = camera[i][0]
        events.append(
            (
                t,
                "/boreas/camera",
                "CompressedVideo",
                {
                    "timestamp": stamp(t),
                    "frame_id": "camera",
                    "format": "h265",
                    "data": base64.b64encode(bytes(packet)).decode(),
                },
            )
        )
        # Each keyframe must also decode independently, as required when seeking.
        if packet.is_keyframe:
            independent = av.CodecContext.create("hevc", "r")
            assert (
                len(
                    independent.decode(av.Packet(bytes(packet)))
                    + independent.decode(None)
                )
                == 1
            )
        decoded += len(decoder.decode(av.Packet(bytes(packet))))
    decoded += len(decoder.decode(None))
    assert decoded == len(camera)
    for t, key in radar:
        raw = np.asarray(Image.open(io.BytesIO(download(key))))
        assert raw.ndim == 2 and raw.shape[1] > 1000
        # Data only: remove timestamps/encoder/validity columns, preserving polar intensity.
        intensity = raw[:, 11:].copy()
        intensity[raw[:, 10] != 255] = 0
        encoded = io.BytesIO()
        image = Image.fromarray(intensity)
        image = image.resize((image.width // 2, image.height), Image.Resampling.BOX)
        image.save(encoded, format="JPEG", quality=85)
        events.append(
            (
                t,
                "/boreas/radar",
                "CompressedImage",
                {
                    "timestamp": stamp(t),
                    "frame_id": "radar",
                    "format": "jpeg",
                    "data": base64.b64encode(encoded.getvalue()).decode(),
                },
            )
        )
    for row in csv.DictReader(
        io.StringIO(download(f"{SEQUENCE}/applanix/imu.csv").decode())
    ):
        t = round(float(row["GPSTime"]) * 1_000_000)
        if start <= t < end:
            events.append(
                (
                    t,
                    "/boreas/imu",
                    "Imu",
                    {
                        **{
                            f"accel_{axis}": float(row[f"accel{axis}"])
                            for axis in "xyz"
                        },
                        **{
                            f"angular_velocity_{axis}": float(row[f"angvel_{axis}"])
                            for axis in "xyz"
                        },
                    },
                )
            )
    next_gps = start
    for row in csv.DictReader(
        io.StringIO(download(f"{SEQUENCE}/applanix/gps_post_process.csv").decode())
    ):
        t = round(float(row["GPSTime"]) * 1_000_000)
        if next_gps <= t < end:
            next_gps = t + 99_000
            events.append(
                (
                    t,
                    "/boreas/gps",
                    "LocationFix",
                    {
                        "timestamp": stamp(t),
                        "frame_id": "applanix",
                        "latitude": float(np.degrees(float(row["latitude"]))),
                        "longitude": float(np.degrees(float(row["longitude"]))),
                        "altitude": float(row["altitude"]),
                        "position_covariance": [0] * 9,
                        "position_covariance_type": 0,
                    },
                )
            )
    counts = Counter(topic for _, topic, _, _ in events)
    assert counts["/boreas/lidar"] >= 95 and counts["/boreas/camera"] >= 195, counts
    assert (
        counts["/boreas/radar"] >= 75
        and counts["/boreas/imu"] >= 3900
        and counts["/boreas/gps"] >= 195
    ), counts
    with urllib.request.urlopen(
        "https://raw.githubusercontent.com/foxglove/foxglove-sdk/main/LICENSE",
        timeout=30,
    ) as response:
        schema_license = response.read().decode()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    intermediate = CACHE / "boreas-unrechunked.mcap"
    validators = {
        name: jsonschema.Draft7Validator(schema) for name, schema in schemas.items()
    }
    with intermediate.open("wb") as output:
        writer = Writer(output, compression=CompressionType.ZSTD)
        writer.start(profile="", library="Lichtblick Boreas sample converter")
        channels: dict[str, int] = {}
        for topic, name in sorted({(topic, name) for _, topic, name, _ in events}):
            schema_name = (
                f"lichtblick.Boreas{name}"
                if name in ("Motion", "Imu")
                else f"foxglove.{name}"
            )
            schema = writer.register_schema(
                schema_name, "jsonschema", json.dumps(schemas[name]).encode()
            )
            channels[topic] = writer.register_channel(topic, "json", schema)
        writer.add_metadata(
            "attribution",
            {
                "credit": ATTRIBUTION,
                "license": LICENSE,
                "source": BASE + SEQUENCE + "/",
                "schema_license": schema_license,
            },
        )
        for t, topic, name, message in sorted(events, key=lambda e: e[0]):
            validators[name].validate(message)
            writer.add_message(
                channels[topic],
                t * 1000,
                json.dumps(message, separators=(",", ":"), allow_nan=False).encode(),
                publish_time=t * 1000,
            )
        writer.finish()
    staged = OUTPUT.with_suffix(".pending.mcap")
    subprocess.run(
        [
            "uvx",
            "pymcap-cli==0.35.0",
            "rechunk",
            str(intermediate),
            "-o",
            str(staged),
            "--strategy",
            "all",
            "--chunk-size",
            "4194304",
            "--compression",
            "zstd",
            "--force",
        ],
        check=True,
    )
    with staged.open("rb") as output:
        reader = make_reader(output, validate_crcs=True)
        summary = reader.get_summary()
        assert (
            summary
            and summary.statistics
            and summary.statistics.message_count == len(events)
        )
        assert (
            Counter(channel.topic for _, channel, _ in reader.iter_messages()) == counts
        )
        assert next(reader.iter_metadata()).metadata["credit"] == ATTRIBUTION
        duration = (
            summary.statistics.message_end_time - summary.statistics.message_start_time
        ) / 1e9
        assert 19.9 <= duration <= 20, duration
    staged.replace(OUTPUT)
    print(
        f"Validated {OUTPUT}: {OUTPUT.stat().st_size:,} bytes, {duration:.3f} seconds, {dict(counts)}"
    )


if __name__ == "__main__":
    main()

# /// script
# requires-python = ">=3.10"
# dependencies = ["mcap==1.3.0", "numpy==2.2.6", "pillow==11.3.0", "scipy==1.15.3", "jsonschema==4.25.1", "av==16.1.0", "pyproj==3.7.1", "foxglove-schemas-protobuf==0.4.0", "protobuf==7.36.2"]
# ///
# SPDX-License-Identifier: MPL-2.0
"""Build the Boreas showcase MCAP: uv run ci/create-boreas-showcase.py (after pnpm install).

A 60-second, fully annotated, full-resolution excerpt of Boreas-Objects-V1 (Keenan Burnett et
al., University of Toronto, CC BY 4.0, https://www.boreas.utias.utoronto.ca/) meant to exercise
every panel: native-rate LiDAR, full-resolution camera with calibration and projected boxes,
radar image and point cloud, tracked 3D objects, the driven route, GPS and vehicle dynamics.
Every topic is generated lazily and merged in time order, so memory stays flat.
The file is not committed; it is about 2 GB.
"""

import csv
import heapq
import io
import json
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

import av
import jsonschema
import numpy as np
from foxglove_schemas_protobuf.CompressedImage_pb2 import CompressedImage
from foxglove_schemas_protobuf.CompressedVideo_pb2 import CompressedVideo
from foxglove_schemas_protobuf.LocationFix_pb2 import LocationFix
from foxglove_schemas_protobuf.PackedElementField_pb2 import PackedElementField
from foxglove_schemas_protobuf.PointCloud_pb2 import PointCloud
from foxglove_schemas_protobuf.Pose_pb2 import Pose
from foxglove_schemas_protobuf.Quaternion_pb2 import Quaternion
from foxglove_schemas_protobuf.Vector3_pb2 import Vector3
from google.protobuf.descriptor import Descriptor, FileDescriptor
from google.protobuf.descriptor_pb2 import FileDescriptorSet
from google.protobuf.message import Message
from google.protobuf.timestamp_pb2 import Timestamp
from mcap.reader import make_reader
from mcap.writer import CompressionType, Writer
from PIL import Image
from pyproj import Transformer
from scipy.ndimage import uniform_filter1d
from scipy.optimize import linear_sum_assignment
from scipy.spatial.transform import Rotation, Slerp

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(tempfile.gettempdir()) / "lichtblick-boreas"
OUTPUT = CACHE / "boreas-showcase.mcap"
SEQUENCE = "boreas-objects-v1"
BASE = "https://boreas.s3.amazonaws.com/"
LICENSE = "https://creativecommons.org/licenses/by/4.0/"
# The longest stretch of Boreas-Objects-V1 with contiguous LiDAR and labels on every 5 Hz frame.
START = 1598988218835735
SECONDS = 60
END = START + SECONDS * 1_000_000
# Ground below the LiDAR origin, measured from near-range LiDAR returns and labelled car boxes.
GROUND_Z = -2.25
CAMERA_SIZE = (2448, 2048)
RADAR_RANGE_RESOLUTION = 0.0596  # metres per range bin (Navtech CIR304-H)
RADAR_ENCODER_SIZE = 5600
ATTRIBUTION = (
    "Boreas: A Multi-Season Autonomous Driving Dataset, Keenan Burnett et al., "
    "University of Toronto. https://www.boreas.utias.utoronto.ca/ — CC BY 4.0. "
    f"Adapted for Lichtblick from {SEQUENCE} (3D boxes annotated by the dataset authors): "
    f"{SECONDS}-second excerpt; LiDAR at its native 10 Hz with all points and fields; camera at "
    "its native rate and resolution, H.265 encoded; radar as a Cartesian image and as a point "
    "cloud of the strongest returns; boxes as published at 5 Hz, linearly interpolated per track "
    "on the LiDAR frames in between (marked interpolated) and projected into the camera; ego "
    "driven route coloured by speed; GPS converted from UTM, altitude left unknown (the dataset's is relative); accelerations derived from the "
    "postprocessed velocities; local pose origin shifted. Original sensor timestamps retained."
)

DRIVE_STATES = ("STOPPED", "ACCELERATING", "CRUISING", "BRAKING")
TURNS = ("STRAIGHT", "LEFT", "RIGHT")
CLASSES = ("Car", "Pedestrian", "Cyclist", "Misc")
# Publisher names for the Topic Graph, by topic prefix.
CALLERS = {
    "/boreas/lidar": "/lidar_driver",
    "/boreas/camera/image": "/camera_driver",
    "/boreas/camera/calibration": "/camera_driver",
    "/boreas/radar": "/radar_driver",
    "/boreas/tf": "/localization",
    "/boreas/gps": "/gnss_ins",
    "/boreas/motion": "/gnss_ins",
    "/boreas/route": "/localization",
    "/boreas/map": "/localization",
    "/boreas/vehicle": "/vehicle_monitor",
    "/boreas/objects": "/perception",
    "/boreas/camera/annotations": "/perception",
    "/diagnostics": "/system_monitor",
    "/rosout": "/rosout",
}
CLASS_COLORS = {
    "Car": (0.27, 0.62, 1.0),
    "Pedestrian": (1.0, 0.62, 0.18),
    "Cyclist": (0.3, 0.86, 0.45),
    "Misc": (0.78, 0.48, 1.0),
}

# Time (us), topic, schema, message: a JSON object, or a Protobuf message for the
# heavy sensor topics (binary payloads would otherwise be base64 in JSON) and for GPS (NaN).
Event = tuple[int, str, str, dict | Message]


def fetch(key: str) -> Path:
    cache = CACHE / key
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(3):
            try:
                with urllib.request.urlopen(BASE + key, timeout=120) as response:
                    data = response.read()
                break
            # urlopen wraps connection errors in URLError; other errors (e.g. 404) raise at once.
            except (TimeoutError, ConnectionResetError, urllib.error.URLError) as error:
                cause = (
                    error.reason if isinstance(error, urllib.error.URLError) else error
                )
                if (
                    not isinstance(cause, (TimeoutError, ConnectionResetError))
                    or attempt == 2
                ):
                    raise
                print(f"Retrying download ({error}): {key}", flush=True)
        # Write then rename, so an interrupted run never leaves a truncated cache entry.
        cache.with_suffix(".part").write_bytes(data)
        cache.with_suffix(".part").replace(cache)
    return cache


def download(key: str) -> bytes:
    return fetch(key).read_bytes()


def listing(sensor: str, margin: int = 0) -> list[tuple[int, str]]:
    """All files of a sensor folder inside the excerpt (widened by margin us), by timestamp."""
    keys: list[str] = []
    after = f"{SEQUENCE}/{sensor}/{START - margin - 1}"
    while True:
        query = urllib.parse.urlencode(
            {
                "list-type": "2",
                "prefix": f"{SEQUENCE}/{sensor}/",
                "max-keys": 1000,
                "start-after": after,
            }
        )
        with urllib.request.urlopen(BASE + "?" + query, timeout=90) as response:
            page = [
                x.text
                for x in ET.fromstring(response.read()).findall("{*}Contents/{*}Key")
                if x.text
            ]
        keys += page
        if not page or int(Path(page[-1]).stem) >= END + margin:
            break
        after = page[-1]
    return sorted(
        (int(Path(k).stem), k)
        for k in keys
        if START - margin <= int(Path(k).stem) < END + margin
    )


def stamp(microseconds: int) -> dict[str, int]:
    return {"sec": microseconds // 1_000_000, "nsec": microseconds % 1_000_000 * 1000}


def vec(v: np.ndarray) -> dict[str, float]:
    return dict(zip(("x", "y", "z"), map(float, v)))


def quat(r: Rotation) -> dict[str, float]:
    return dict(zip(("x", "y", "z", "w"), map(float, r.as_quat())))


def rgba(rgb: tuple[float, float, float], a: float = 1.0) -> dict[str, float]:
    return {"r": rgb[0], "g": rgb[1], "b": rgb[2], "a": a}


def pose_rotation(row: dict[str, str]) -> Rotation:
    # Boreas defines C_enu_sensor = Rx(-roll) Ry(-pitch) Rz(-heading).
    return Rotation.from_euler(
        "XYZ", [-float(row[k]) for k in ("roll", "pitch", "heading")]
    )


def pose_position(row: dict[str, str]) -> np.ndarray:
    return np.array([float(row[k]) for k in ("easting", "northing", "altitude")])


@dataclass
class Poses:
    """Sensor poses in the shifted map frame, interpolated by time."""

    times: np.ndarray
    positions: np.ndarray
    rotations: Rotation

    @classmethod
    def load(cls, name: str, origin: np.ndarray) -> "Poses":
        rows = list(
            csv.DictReader(
                io.StringIO(download(f"{SEQUENCE}/applanix/{name}.csv").decode())
            )
        )
        rows = [
            r for r in rows if START - 1_000_000 <= int(r["ROSTime"]) <= END + 1_000_000
        ]
        return cls(
            np.array([int(r["ROSTime"]) for r in rows]),
            np.array([pose_position(r) for r in rows]) - origin,
            Rotation.concatenate([pose_rotation(r) for r in rows]),
        )

    def at(self, t: int) -> tuple[np.ndarray, Rotation]:
        i = int(np.clip(np.searchsorted(self.times, t), 1, len(self.times) - 1))
        t0, t1 = self.times[i - 1], self.times[i]
        f = float(np.clip((t - t0) / (t1 - t0), 0, 1))
        position = self.positions[i - 1] * (1 - f) + self.positions[i] * f
        rotation = Slerp([0, 1], self.rotations[i - 1 : i + 1])([f])[0]
        return position, rotation


@dataclass
class Box:
    uuid: str
    cls: str
    size: np.ndarray  # length, width, height
    position: np.ndarray  # map frame, box centre
    rotation: Rotation  # map frame
    points: int
    interpolated: bool


def load_tracks(times: list[int], lidar: Poses) -> dict[int, list[Box]]:
    """Labelled boxes per LiDAR timestamp, converted from the LiDAR frame to the map frame."""
    labelled: dict[int, list[Box]] = {}
    for t in times:
        position, rotation = lidar.at(t)
        boxes = []
        for line in (
            download(f"{SEQUENCE}/labels_tracking/{t}.txt").decode().splitlines()
        ):
            uuid, cls, *values = line.split()
            # The readme lists height, width, length; the data is length, width, height.
            length, width, height, x, y, z, yaw, points = map(float, values)
            boxes.append(
                Box(
                    uuid,
                    cls,
                    np.array([length, width, height]),
                    position + rotation.apply([x, y, z]),
                    rotation * Rotation.from_euler("z", yaw),
                    int(points),
                    False,
                )
            )
        labelled[t] = boxes
    stitch_tracks(times, labelled)
    return labelled


def stitch_tracks(times: list[int], labelled: dict[int, list[Box]]) -> None:
    """Carry track ids across the dataset's 20-second tracking segments.

    Ids restart at each segment, so a frame sharing under half its ids with the previous
    one is matched to it: same class, nearest to the constant-velocity prediction, within
    1.5 m (Hungarian assignment). Matched boxes take the earlier id.
    """
    alias: dict[str, str] = {}
    for k in range(1, len(times)):
        before, after = labelled[times[k - 1]], labelled[times[k]]
        for box in after:
            box.uuid = alias.get(box.uuid, box.uuid)
        if (
            not after
            or len({b.uuid for b in after} & {b.uuid for b in before}) >= len(after) / 2
        ):
            continue
        dt = (times[k] - times[k - 1]) / 1e6
        earlier = {b.uuid: b for b in labelled[times[k - 2]]} if k >= 2 else {}
        predicted = []
        for b in before:
            e = earlier.get(b.uuid)
            step = (
                (b.position - e.position) * dt / ((times[k - 1] - times[k - 2]) / 1e6)
                if e
                else 0
            )
            predicted.append(b.position + step)
        cost = np.full((len(after), len(before)), 1e6)
        for i, a in enumerate(after):
            for j, b in enumerate(before):
                if a.cls == b.cls:
                    cost[i, j] = np.linalg.norm(a.position[:2] - predicted[j][:2])
        for i, j in zip(*linear_sum_assignment(cost)):
            if cost[i, j] < 1.5:
                alias[after[i].uuid] = before[j].uuid
                after[i].uuid = before[j].uuid


def boxes_at(
    t: int, labelled: dict[int, list[Box]], label_times: list[int]
) -> list[Box]:
    """Labelled boxes at a label time; otherwise per-track interpolation between neighbours."""
    if t in labelled:
        return labelled[t]
    i = int(np.searchsorted(label_times, t))
    if i == 0 or i == len(label_times):
        return []
    t0, t1 = label_times[i - 1], label_times[i]
    f = (t - t0) / (t1 - t0)
    after = {b.uuid: b for b in labelled[t1]}
    boxes = []
    for a in labelled[t0]:
        b = after.get(a.uuid)
        if b is None:
            continue
        rotation = Slerp([0, 1], Rotation.concatenate([a.rotation, b.rotation]))([f])[0]
        boxes.append(
            Box(
                a.uuid,
                a.cls,
                a.size * (1 - f) + b.size * f,
                a.position * (1 - f) + b.position * f,
                rotation,
                round(a.points * (1 - f) + b.points * f),
                True,
            )
        )
    return boxes


def log(t: int, level: int, node: str, message: str) -> Event:
    """A foxglove.Log record (1 debug, 2 info, 3 warning, 4 error, 5 fatal)."""
    return (
        t,
        "/rosout",
        "Log",
        {
            "timestamp": stamp(t),
            "level": level,
            "message": message,
            "name": node,
            "file": "",
            "line": 0,
        },
    )


def descriptor_set(descriptor: Descriptor) -> bytes:
    """The message's .proto file and its dependencies, as MCAP protobuf schema data."""
    files = FileDescriptorSet()
    seen: set[str] = set()

    def add(file: FileDescriptor) -> None:
        if file.name in seen:
            return
        seen.add(file.name)
        for dependency in file.dependencies:
            add(dependency)
        file.CopyToProto(files.file.add())

    add(descriptor.file)
    return files.SerializeToString()


def pb_time(microseconds: int) -> Timestamp:
    return Timestamp(
        seconds=microseconds // 1_000_000, nanos=microseconds % 1_000_000 * 1000
    )


def pb_point_cloud(
    t: int, frame: str, names: tuple[str, ...], data: bytes
) -> PointCloud:
    """float32 fields packed back to back, in the given frame at the identity pose."""
    return PointCloud(
        timestamp=pb_time(t),
        frame_id=frame,
        pose=Pose(position=Vector3(), orientation=Quaternion(w=1)),
        point_stride=4 * len(names),
        fields=[
            PackedElementField(name=n, offset=4 * i, type=PackedElementField.FLOAT32)
            for i, n in enumerate(names)
        ],
        data=data,
    )


def box_corners(box: Box) -> np.ndarray:
    signs = np.array([[x, y, z] for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)])
    return box.position + box.rotation.apply(signs * box.size / 2)


# Corner index pairs (see box_corners ordering) forming the 12 edges.
BOX_EDGES = [
    (0, 1), (2, 3), (4, 5), (6, 7),
    (0, 2), (1, 3), (4, 6), (5, 7),
    (0, 4), (1, 5), (2, 6), (3, 7),
]  # fmt: skip


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
    motion_fields = (
        "speed",
        "accel_long",
        "accel_lat",
        "yaw_rate",
        "heading",
        "roll",
        "pitch",
        "altitude",
    )
    schemas["Motion"] = {
        "type": "object",
        "properties": {k: {"type": "number"} for k in motion_fields},
        "required": list(motion_fields),
    }
    track_fields = {
        "id": {"type": "string"},
        "track": {"type": "integer"},
        "class": {"type": "string"},
        "distance_m": {"type": "number"},
        "bearing_deg": {"type": "number"},
        "speed_kmh": {"type": "number"},
        "lidar_points": {"type": "integer"},
        "interpolated": {"type": "boolean"},
    }
    schemas["ObjectTracks"] = {
        "type": "object",
        "properties": {
            **{
                k: {"type": "integer"}
                for k in ("cars", "pedestrians", "cyclists", "other", "total")
            },
            "nearest_distance": {"type": "number"},
            "nearest_class": {"type": "string"},
            "interpolated": {"type": "boolean"},
            "tracks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": track_fields,
                    "required": list(track_fields),
                },
            },
        },
        "required": [
            "cars",
            "pedestrians",
            "cyclists",
            "other",
            "total",
            "interpolated",
            "tracks",
        ],
    }

    def enum(*names: str) -> dict:
        # Named constants show as labels in State Transitions, Raw Messages and Plot legends.
        return {"oneOf": [{"const": i, "title": n} for i, n in enumerate(names)]}

    # Pie charts read a numeric array; order matches CLASSES.
    schemas["ClassCounts"] = {
        "type": "object",
        "properties": {"counts": {"type": "array", "items": {"type": "number"}}},
        "required": ["counts"],
    }
    schemas["VehicleState"] = {
        "type": "object",
        "properties": {
            "drive_state": enum(*DRIVE_STATES),
            "turn": enum(*TURNS),
            "standstill": {"type": "boolean"},
        },
        "required": ["drive_state", "turn", "standstill"],
    }
    schemas["DiagnosticArray"] = {
        "type": "object",
        "properties": {
            "header": {
                "type": "object",
                "properties": {
                    "stamp": schemas["FrameTransform"]["properties"]["timestamp"],
                    "frame_id": {"type": "string"},
                },
            },
            "status": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "level": {"type": "integer", "minimum": 0, "maximum": 3},
                        "name": {"type": "string"},
                        "message": {"type": "string"},
                        "hardware_id": {"type": "string"},
                        "values": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "key": {"type": "string"},
                                    "value": {"type": "string"},
                                },
                            },
                        },
                    },
                },
            },
        },
        "required": ["header", "status"],
    }

    lidar_frames = listing("lidar")
    camera_frames = listing("camera")
    radar_frames = listing("radar")
    # Labels a second beyond the excerpt let boxes interpolate and tracks stitch at its edges.
    label_times = [t for t, _ in listing("labels_tracking", margin=1_000_000)]
    keys = [k for _, k in lidar_frames + camera_frames + radar_frames]
    keys += [f"{SEQUENCE}/labels_tracking/{t}.txt" for t in label_times]
    keys += [
        f"{SEQUENCE}/applanix/{n}.csv"
        for n in ("lidar_poses", "camera_poses", "gps_post_process")
    ]
    keys += [
        f"{SEQUENCE}/calib/{n}.txt"
        for n in ("P_camera", "T_camera_lidar", "T_radar_lidar")
    ]
    print(
        f"Downloading {len(lidar_frames)} LiDAR, {len(camera_frames)} camera, "
        f"{len(radar_frames)} radar frames, {len(label_times)} label files and navigation",
        flush=True,
    )
    with ThreadPoolExecutor(max_workers=8) as pool:
        for i, _ in enumerate(pool.map(fetch, keys)):
            if i % 100 == 0:
                print(f"Downloaded {i + 1}/{len(keys)}", flush=True)

    first_pose = next(
        r
        for r in csv.DictReader(
            io.StringIO(download(f"{SEQUENCE}/applanix/lidar_poses.csv").decode())
        )
        if int(r["ROSTime"]) >= START
    )
    origin = pose_position(first_pose)
    lidar_poses = Poses.load("lidar_poses", origin)
    camera_poses = Poses.load("camera_poses", origin)
    labelled = load_tracks(label_times, lidar_poses)
    track_numbers: dict[str, int] = {}
    for t in label_times:
        for box in labelled[t]:
            track_numbers.setdefault(box.uuid, len(track_numbers) + 1)

    # Navigation at 100 Hz, with derived dynamics, vehicle state and notable events.
    to_wgs84 = Transformer.from_crs("EPSG:32617", "EPSG:4326", always_xy=True)
    nav_rows = [
        r
        for r in csv.DictReader(
            io.StringIO(download(f"{SEQUENCE}/applanix/gps_post_process.csv").decode())
        )
        if START <= round(float(r["ROSTime"]) * 1e6) < END
    ]
    nav_times = np.array([round(float(r["ROSTime"]) * 1e6) for r in nav_rows])
    nav_seconds = nav_times / 1e6
    velocity = np.array(
        [[float(r[k]) for k in ("vel_east", "vel_north")] for r in nav_rows]
    )
    speed = np.linalg.norm(velocity, axis=1)
    # 0.2 s moving averages keep differentiated signals readable.
    kernel = np.ones(20) / 20
    # Edge padding keeps the averages honest at the excerpt's ends (zero padding would fake
    # a ramp, and with it tens of m/s² of acceleration).
    smooth_speed = np.convolve(
        np.pad(speed, (10, 9), mode="edge"), kernel, mode="valid"
    )
    accel_long = np.gradient(smooth_speed, nav_seconds)
    # Yaw rate from the course over ground (counter-clockwise positive); undefined when stopped.
    course = np.unwrap(np.arctan2(velocity[:, 1], velocity[:, 0]))
    yaw_rate = np.convolve(
        np.pad(np.gradient(course, nav_seconds), (10, 9), mode="edge"),
        kernel,
        mode="valid",
    )
    yaw_rate[smooth_speed < 1] = 0
    heading = np.degrees(np.arctan2(velocity[:, 0], velocity[:, 1])) % 360
    longitude, latitude = to_wgs84.transform(
        [float(r["easting"]) for r in nav_rows],
        [float(r["northing"]) for r in nav_rows],
    )

    def raw_state(i: int) -> int:
        if smooth_speed[i] < 0.3:
            return DRIVE_STATES.index("STOPPED")
        if accel_long[i] > 0.5:
            return DRIVE_STATES.index("ACCELERATING")
        if accel_long[i] < -0.5:
            return DRIVE_STATES.index("BRAKING")
        return DRIVE_STATES.index("CRUISING")

    # A state must hold for half a second before it is reported.
    drive_state = np.zeros(len(nav_rows), int)
    current, candidate, since = raw_state(0), raw_state(0), 0
    for i in range(len(nav_rows)):
        state = raw_state(i)
        if state != candidate:
            candidate, since = state, i
        if candidate != current and i - since >= 50:
            current = candidate
        drive_state[i] = current
    turn = np.where(
        np.degrees(yaw_rate) > 4,
        TURNS.index("LEFT"),
        np.where(np.degrees(yaw_rate) < -4, TURNS.index("RIGHT"), 0),
    )
    hard_brakes = [
        i
        for i in range(1, len(nav_rows))
        if accel_long[i] < -2.0 and accel_long[i - 1] >= -2.0
    ]

    def matrix(name: str) -> np.ndarray:
        return np.loadtxt(io.BytesIO(download(f"{SEQUENCE}/calib/{name}.txt")))

    projection = matrix("P_camera")
    T_lidar = {
        "camera": np.linalg.inv(matrix("T_camera_lidar")),
        "radar": np.linalg.inv(matrix("T_radar_lidar")),
    }

    def static_transforms() -> Iterator[Event]:
        frames = {
            **T_lidar,
            # The vehicle frame sits on the ground under the LiDAR, x forward, z up.
            "base_link": np.block(
                [[np.eye(3), np.array([[0], [0], [GROUND_Z]])], [np.zeros((1, 3)), 1]]
            ),
        }
        for child, m in frames.items():
            yield (
                START,
                "/boreas/tf_static",
                "FrameTransform",
                {
                    "timestamp": stamp(START),
                    "parent_frame_id": "lidar",
                    "child_frame_id": child,
                    "translation": vec(m[:3, 3]),
                    "rotation": quat(Rotation.from_matrix(m[:3, :3])),
                },
            )

    def transforms() -> Iterator[Event]:
        for t, position, rotation in zip(
            lidar_poses.times, lidar_poses.positions, lidar_poses.rotations
        ):
            if START <= t < END:
                yield (
                    int(t),
                    "/boreas/tf",
                    "FrameTransform",
                    {
                        "timestamp": stamp(int(t)),
                        "parent_frame_id": "map",
                        "child_frame_id": "lidar",
                        "translation": vec(position),
                        "rotation": quat(rotation),
                    },
                )

    def lidar() -> Iterator[Event]:
        fields = ("x", "y", "z", "intensity", "laser", "time_offset")
        for i, (t, key) in enumerate(lidar_frames):
            if i > 0 and t - lidar_frames[i - 1][0] > 150_000:
                yield log(
                    t,
                    3,
                    "/lidar_driver",
                    f"LiDAR scan gap {(t - lidar_frames[i - 1][0]) / 1000:.0f} ms",
                )
            raw = download(key)
            assert len(raw) % 24 == 0 and len(raw) > 24_000
            # All six float32 fields as recorded: laser index and per-point time offset (s).
            yield (
                t,
                "/boreas/lidar",
                "PointCloud",
                pb_point_cloud(t, "lidar", fields, raw),
            )

    def object_entities(t: int, boxes: list[Box]) -> list[dict]:
        entities = []
        ego, _ = lidar_poses.at(t)
        for box in boxes:
            color = CLASS_COLORS[box.cls]
            number = track_numbers[box.uuid]
            corners = box_corners(box)
            velocity = track_velocity(box, t)
            speed = float(np.linalg.norm(velocity[:2]))
            label = f"{box.cls} {number}" + (
                f" · {speed * 3.6:.0f} km/h" if speed > 1 else ""
            )
            # Labels only where they stay readable: nearby objects, and moving vehicles.
            labelled_here = np.linalg.norm(box.position[:2] - ego[:2]) < 25 or (
                box.cls in ("Car", "Misc") and speed > 2
            )
            arrows = []
            if speed > 1:
                arrows.append(
                    {
                        "pose": {
                            "position": vec(box.position + [0, 0, box.size[2] / 2]),
                            "orientation": quat(
                                Rotation.from_euler(
                                    "z", np.arctan2(velocity[1], velocity[0])
                                )
                            ),
                        },
                        "shaft_length": min(speed * 0.5, 8.0),
                        "shaft_diameter": 0.12,
                        "head_length": 0.5,
                        "head_diameter": 0.35,
                        "color": rgba(color, 0.9),
                    }
                )
            entities.append(
                {
                    "timestamp": stamp(t),
                    "frame_id": "map",
                    # The track number, so a click in 3D ($selected_id) matches tracks[].id.
                    "id": str(number),
                    "lifetime": {"sec": 0, "nsec": 0},
                    "frame_locked": False,
                    "metadata": [
                        {"key": "class", "value": box.cls},
                        {"key": "track", "value": str(number)},
                        {"key": "lidar_points", "value": str(box.points)},
                        {"key": "speed_kmh", "value": f"{speed * 3.6:.1f}"},
                        {"key": "interpolated", "value": str(box.interpolated).lower()},
                    ],
                    "arrows": arrows,
                    "cubes": [
                        {
                            "pose": {
                                "position": vec(box.position),
                                "orientation": quat(box.rotation),
                            },
                            "size": vec(box.size),
                            "color": rgba(color, 0.18),
                        }
                    ],
                    "cylinders": [],
                    "lines": [
                        {
                            "type": 2,
                            "pose": {
                                "position": vec(np.zeros(3)),
                                "orientation": quat(Rotation.identity()),
                            },
                            "thickness": 0.06,
                            "scale_invariant": False,
                            "points": [
                                vec(corners[i]) for edge in BOX_EDGES for i in edge
                            ],
                            "color": rgba(color, 0.95),
                            "colors": [],
                            "indices": [],
                        }
                    ],
                    "spheres": [],
                    "texts": [
                        {
                            "pose": {
                                "position": vec(
                                    box.position + [0, 0, box.size[2] / 2 + 0.6]
                                ),
                                "orientation": quat(Rotation.identity()),
                            },
                            "billboard": True,
                            "font_size": 12,
                            "scale_invariant": True,
                            "color": rgba(color),
                            "text": label,
                        }
                    ]
                    if labelled_here
                    else [],
                    "triangles": [],
                    "models": [],
                }
            )
        return entities

    # Each track's labelled centres over time, for velocity estimates.
    history: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for uuid in {b.uuid for boxes in labelled.values() for b in boxes}:
        samples = [
            (t, b.position) for t in label_times for b in labelled[t] if b.uuid == uuid
        ]
        history[uuid] = (
            np.array([s[0] for s in samples]) / 1e6,
            np.array([s[1] for s in samples]),
        )

    def track_velocity(box: Box, t: int) -> np.ndarray:
        """Map-frame velocity: least-squares slope over labels within 0.6 s of t.

        Labelled centres jitter by decimetres; over a single 0.2 s step that alone reads
        as several km/h, so a longer window keeps parked cars and pedestrians honest.
        """
        times, positions = history[box.uuid]
        near = np.abs(times - t / 1e6) <= 0.6
        if near.sum() < 3:
            return np.zeros(3)
        dt = times[near] - times[near].mean()
        return (dt[:, None] * (positions[near] - positions[near].mean(axis=0))).sum(
            axis=0
        ) / (dt**2).sum()

    def objects() -> Iterator[Event]:
        history: dict[str, list[np.ndarray]] = {}
        seen: set[int] = set()
        near: set[int] = set()
        for t, _ in lidar_frames:
            boxes = boxes_at(t, labelled, label_times)
            yield (
                t,
                "/boreas/objects",
                "SceneUpdate",
                {
                    "deletions": [{"timestamp": stamp(t), "type": 1, "id": ""}],
                    "entities": object_entities(t, boxes),
                },
            )
            # Trails of the last 3 seconds of each moving track, drawn on the ground.
            present = {b.uuid for b in boxes}
            for box in boxes:
                trail = history.setdefault(box.uuid, [])
                trail.append(box.position - [0, 0, box.size[2] / 2 - 0.05])
                del trail[:-30]
            for uuid in list(history):
                if uuid not in present:
                    del history[uuid]
            cls = {b.uuid: b.cls for b in boxes}
            trails = [
                {
                    "timestamp": stamp(t),
                    "frame_id": "map",
                    "id": str(track_numbers[uuid]),
                    "lifetime": {"sec": 0, "nsec": 0},
                    "frame_locked": False,
                    "metadata": [{"key": "track", "value": str(track_numbers[uuid])}],
                    "arrows": [],
                    "cubes": [],
                    "cylinders": [],
                    "lines": [
                        {
                            "type": 0,
                            "pose": {
                                "position": vec(np.zeros(3)),
                                "orientation": quat(Rotation.identity()),
                            },
                            "thickness": 0.12,
                            "scale_invariant": False,
                            "points": [vec(p) for p in trail],
                            "color": rgba(CLASS_COLORS[cls[uuid]], 0.7),
                            "colors": [],
                            "indices": [],
                        }
                    ],
                    "spheres": [],
                    "texts": [],
                    "triangles": [],
                    "models": [],
                }
                for uuid, trail in history.items()
                if len(trail) > 1 and np.linalg.norm(trail[-1] - trail[0]) > 1.0
            ]
            yield (
                t,
                "/boreas/objects/trails",
                "SceneUpdate",
                {
                    "deletions": [{"timestamp": stamp(t), "type": 1, "id": ""}],
                    "entities": trails,
                },
            )
            counts = Counter(b.cls for b in boxes)
            ego, ego_rotation = lidar_poses.at(t)
            tracks = []
            for box in boxes:
                offset = ego_rotation.inv().apply(box.position - ego)
                velocity = track_velocity(box, t)
                tracks.append(
                    {
                        "id": str(track_numbers[box.uuid]),
                        "track": track_numbers[box.uuid],
                        "class": box.cls,
                        "distance_m": round(float(np.linalg.norm(offset[:2])), 2),
                        # 0 is straight ahead, positive to the left.
                        "bearing_deg": round(
                            float(np.degrees(np.arctan2(offset[1], offset[0]))), 1
                        ),
                        "speed_kmh": round(
                            float(np.linalg.norm(velocity[:2])) * 3.6, 1
                        ),
                        "lidar_points": box.points,
                        "interpolated": box.interpolated,
                    }
                )
            tracks.sort(key=lambda k: k["distance_m"])
            summary = {
                "cars": counts["Car"],
                "pedestrians": counts["Pedestrian"],
                "cyclists": counts["Cyclist"],
                "other": counts["Misc"],
                "total": len(boxes),
                "interpolated": bool(boxes) and boxes[0].interpolated,
                "tracks": tracks,
            }
            if tracks:
                summary["nearest_distance"] = tracks[0]["distance_m"]
                summary["nearest_class"] = tracks[0]["class"]
            yield (t, "/boreas/objects/tracks", "ObjectTracks", summary)
            yield (
                t,
                "/boreas/objects/class_counts",
                "ClassCounts",
                {"counts": [float(counts[c]) for c in CLASSES]},
            )
            initial = not seen
            for track in tracks:
                number = track["track"]
                if number not in seen:
                    seen.add(number)
                    # The first labelled frame's objects are the initial scene, not news.
                    if not initial:
                        yield log(
                            t,
                            1,
                            "/perception",
                            f"New track {number} ({track['class']}) at {track['distance_m']:.0f} m",
                        )
                # Vulnerable road users ahead: enter at 15 m, leave at 18 m (no flicker).
                ahead = (
                    track["class"] in ("Pedestrian", "Cyclist")
                    and abs(track["bearing_deg"]) < 45
                )
                limit = 18 if number in near else 15
                close = ahead and track["distance_m"] < limit
                if close and number not in near:
                    yield log(
                        t,
                        3,
                        "/perception",
                        f"{track['class']} {number} ahead within 15 m "
                        f"({track['distance_m']:.1f} m, bearing {track['bearing_deg']:.0f}°)",
                    )
                if close:
                    near.add(number)
                else:
                    near.discard(number)

    def route() -> Iterator[Event]:
        """The whole driven path on the ground, coloured by speed, republished every second."""
        inside = (lidar_poses.times >= START) & (lidar_poses.times < END)
        path = lidar_poses.positions[inside][::5]
        speeds = np.linalg.norm(
            np.diff(lidar_poses.positions[inside], axis=0), axis=1
        ) / np.diff(lidar_poses.times[inside] / 1e6)
        speeds = np.append(speeds, speeds[-1])[::5]
        top = max(float(speeds.max()), 1.0)
        path_entity = {
            "id": "route",
            "frame_id": "map",
            "lifetime": {"sec": 0, "nsec": 0},
            "frame_locked": False,
            "metadata": [{"key": "max_speed_kmh", "value": f"{top * 3.6:.1f}"}],
            "arrows": [],
            "cubes": [],
            "cylinders": [],
            "lines": [
                {
                    "type": 0,
                    "pose": {
                        "position": vec(np.zeros(3)),
                        "orientation": quat(Rotation.identity()),
                    },
                    "thickness": 0.25,
                    "scale_invariant": False,
                    "points": [vec(p + [0, 0, GROUND_Z + 0.03]) for p in path],
                    "color": rgba((1, 1, 1)),
                    # Slow is blue, fast is red.
                    "colors": [
                        rgba((s / top, 0.35, 1 - s / top), 0.85) for s in speeds
                    ],
                    "indices": [],
                }
            ],
            "spheres": [],
            "texts": [],
            "triangles": [],
            "models": [],
        }
        for t in range(START, END, 1_000_000):
            yield (
                t,
                "/boreas/route",
                "SceneUpdate",
                {"deletions": [], "entities": [{**path_entity, "timestamp": stamp(t)}]},
            )

    def camera() -> Iterator[Event]:
        width, height = CAMERA_SIZE
        K = projection[:3, :3]
        calibration = {
            "frame_id": "camera",
            "width": width,
            "height": height,
            # Boreas images are rectified, so the projection matrix is all there is.
            "distortion_model": "plumb_bob",
            "D": [0.0] * 5,
            "K": K.flatten().tolist(),
            "R": np.eye(3).flatten().tolist(),
            "P": projection[:3, :4].flatten().tolist(),
        }
        encoder = av.CodecContext.create("libx265", "w")
        encoder.width, encoder.height = width, height
        encoder.pix_fmt = "yuv420p"
        encoder.time_base = Fraction(1, 12)
        encoder.framerate = Fraction(12, 1)
        encoder.options = {
            "preset": "fast",
            "crf": "24",
            "x265-params": "bframes=0:keyint=12:min-keyint=12:scenecut=0:repeat-headers=1:log-level=error",
        }

        def annotations(t: int) -> dict:
            position, rotation = camera_poses.at(t)
            points: list[dict] = []
            texts: list[dict] = []
            for box in boxes_at_time(t):
                corners = rotation.inv().apply(box_corners(box) - position)
                if (corners[:, 2] < 1.0).any():
                    continue
                uv = corners @ K.T
                uv = uv[:, :2] / uv[:, 2:]
                if (
                    uv[:, 0].max() < 0
                    or uv[:, 0].min() > width
                    or uv[:, 1].max() < 0
                    or uv[:, 1].min() > height
                ):
                    continue
                color = CLASS_COLORS[box.cls]
                points.append(
                    {
                        "timestamp": stamp(t),
                        "type": 2,
                        "points": [
                            {"x": float(uv[i, 0]), "y": float(uv[i, 1])}
                            for edge in BOX_EDGES
                            for i in edge
                        ],
                        "outline_color": rgba(color),
                        "outline_colors": [],
                        "fill_color": rgba(color, 0),
                        "thickness": 3,
                    }
                )
                texts.append(
                    {
                        "timestamp": stamp(t),
                        "position": {
                            "x": float(uv[:, 0].min()),
                            "y": float(uv[:, 1].min() - 6),
                        },
                        "text": f"{box.cls} {track_numbers[box.uuid]}",
                        "font_size": 28,
                        "text_color": rgba((1, 1, 1)),
                        "background_color": rgba(color, 0.8),
                    }
                )
            return {"circles": [], "points": points, "texts": texts}

        decoder = av.CodecContext.create("hevc", "r")
        pending: list[int] = []

        def packets_out(packets: list[av.Packet]) -> Iterator[Event]:
            for packet in packets:
                t = pending.pop(0)
                data = bytes(packet)
                if packet.is_keyframe:
                    independent = av.CodecContext.create("hevc", "r")
                    assert (
                        len(
                            independent.decode(av.Packet(data))
                            + independent.decode(None)
                        )
                        == 1
                    )
                assert len(decoder.decode(av.Packet(data))) == 1, (
                    "B-frames/reordered video are unsupported"
                )
                yield (
                    t,
                    "/boreas/camera/image",
                    "CompressedVideo",
                    CompressedVideo(
                        timestamp=pb_time(t),
                        frame_id="camera",
                        format="h265",
                        data=data,
                    ),
                )
                yield (
                    t,
                    "/boreas/camera/calibration",
                    "CameraCalibration",
                    {**calibration, "timestamp": stamp(t)},
                )
                yield (
                    t,
                    "/boreas/camera/annotations",
                    "ImageAnnotations",
                    annotations(t),
                )
                # Gap logs wait for the frames before them; the encoder holds frames back.
                while held_logs and held_logs[0][0] <= t:
                    yield held_logs.pop(0)

        held_logs: list[Event] = []

        for i, (t, key) in enumerate(camera_frames):
            if i > 0 and t - camera_frames[i - 1][0] > 150_000:
                held_logs.append(
                    log(
                        t,
                        3,
                        "/camera_driver",
                        f"Camera frame gap {(t - camera_frames[i - 1][0]) / 1000:.0f} ms",
                    )
                )
            image = Image.open(io.BytesIO(download(key))).convert("RGB")
            assert image.size == CAMERA_SIZE, image.size
            frame = av.VideoFrame.from_image(image)
            frame.pts = i
            pending.append(t)
            yield from packets_out(encoder.encode(frame))
        yield from packets_out(encoder.encode(None))
        assert not pending and not held_logs

    def boxes_at_time(t: int) -> list[Box]:
        return boxes_at(t, labelled, label_times)

    def radar() -> Iterator[Event]:
        size, resolution = 1000, 0.12  # 120 m square, where street structure is visible
        centre = (size - 1) / 2
        rows, cols = np.mgrid[0:size, 0:size]
        forward = (centre - rows) * resolution
        right = (cols - centre) * resolution
        cell_range = np.hypot(forward, right)
        cell_azimuth = np.mod(np.arctan2(right, forward), 2 * np.pi)
        for t, key in radar_frames:
            raw = np.asarray(Image.open(io.BytesIO(download(key))))
            assert raw.ndim == 2 and raw.shape[1] > 1000
            azimuths = (
                (raw[:, 8:10].copy().view("<u2")[:, 0].astype(np.float64))
                * 2
                * np.pi
                / RADAR_ENCODER_SIZE
            )
            intensity = raw[:, 11:].astype(np.float32)
            intensity[raw[:, 10] != 255] = 0
            # Smooth along range and across neighbouring beams, then remove each beam's noise
            # floor, so walls and curbs stand out instead of speckle and radial streaks.
            intensity = uniform_filter1d(intensity, 7, axis=1)
            intensity = uniform_filter1d(intensity, 3, axis=0, mode="wrap")
            floor = np.percentile(intensity, 80, axis=1, keepdims=True)
            intensity = np.clip((intensity - floor) * 4, 0, 255)
            # Blend the two beams around each pixel's azimuth (wrapping at 360°), so far
            # ranges read as a surface instead of wedges.
            order = np.argsort(azimuths)
            sorted_az = azimuths[order]
            upper = np.searchsorted(sorted_az, cell_azimuth) % len(order)
            lower = (upper - 1) % len(order)
            span = np.mod(sorted_az[upper] - sorted_az[lower], 2 * np.pi)
            weight = np.mod(cell_azimuth - sorted_az[lower], 2 * np.pi) / np.where(
                span > 0, span, 1
            )
            bins = np.round(cell_range / RADAR_RANGE_RESOLUTION).astype(int)
            valid = bins < intensity.shape[1]
            b = np.where(valid, bins, 0)
            blended = (1 - weight) * intensity[order[lower], b] + weight * intensity[
                order[upper], b
            ]
            image = np.where(valid, blended, 0).astype(np.uint8)
            encoded = io.BytesIO()
            Image.fromarray(image).save(encoded, format="PNG", optimize=False)
            yield (
                t,
                "/boreas/radar/image",
                "CompressedImage",
                CompressedImage(
                    timestamp=pb_time(t),
                    frame_id="radar",
                    format="png",
                    data=encoded.getvalue(),
                ),
            )
            # The strongest returns per azimuth beyond 2 m, as a point cloud in the radar frame.
            top = 12
            strongest = np.argpartition(-intensity, top, axis=1)[:, :top]
            values = np.take_along_axis(intensity, strongest, axis=1)
            keep = (values > 70) & (strongest * RADAR_RANGE_RESOLUTION > 2)
            r = strongest[keep] * RADAR_RANGE_RESOLUTION
            a = np.repeat(azimuths[:, None], top, axis=1)[keep]
            points = np.zeros(len(r), dtype=[("xyz", "<f4", 3), ("intensity", "<f4")])
            points["xyz"] = np.stack(
                [r * np.cos(a), r * np.sin(a), np.zeros_like(r)], axis=1
            )
            points["intensity"] = values[keep]
            yield (
                t,
                "/boreas/radar/points",
                "PointCloud",
                pb_point_cloud(
                    t, "radar", ("x", "y", "z", "intensity"), points.tobytes()
                ),
            )

    def navigation() -> Iterator[Event]:
        next_gps = START
        brakes = set(hard_brakes)
        for i, r in enumerate(nav_rows):
            t = int(nav_times[i])
            yield (
                t,
                "/boreas/motion",
                "Motion",
                {
                    "speed": float(speed[i]),
                    "accel_long": float(accel_long[i]),
                    "accel_lat": float(smooth_speed[i] * yaw_rate[i]),
                    "yaw_rate": float(np.degrees(yaw_rate[i])),
                    "heading": float(heading[i]),
                    "roll": float(np.degrees(float(r["roll"]))),
                    "pitch": float(np.degrees(float(r["pitch"]))),
                    "altitude": float(r["altitude"]),
                },
            )
            if i > 0 and drive_state[i] != drive_state[i - 1]:
                yield log(
                    t,
                    2,
                    "/vehicle_monitor",
                    f"Drive state {DRIVE_STATES[drive_state[i - 1]]} -> "
                    f"{DRIVE_STATES[drive_state[i]]} at {speed[i] * 3.6:.0f} km/h",
                )
            if i in brakes:
                yield log(
                    t,
                    3,
                    "/vehicle_monitor",
                    f"Hard braking {accel_long[i]:.1f} m/s² at {speed[i] * 3.6:.0f} km/h",
                )
            if t >= next_gps:
                next_gps = t + 99_000
                yield (
                    t,
                    "/boreas/gps",
                    "LocationFix",
                    # Protobuf because JSON cannot carry NaN. The dataset's altitude is relative,
                    # not above the ellipsoid, so it is unknown (NaN, the ROS convention); the
                    # fix is on the ground under the vehicle, where map layers belong.
                    LocationFix(
                        timestamp=pb_time(t),
                        frame_id="base_link",
                        latitude=float(latitude[i]),
                        longitude=float(longitude[i]),
                        altitude=float("nan"),
                        # The postprocessed solution is centimetre-level; 5 cm is conservative.
                        position_covariance=[0.0025, 0, 0, 0, 0.0025, 0, 0, 0, 0.01],
                        position_covariance_type=LocationFix.DIAGONAL_KNOWN,
                    ),
                )
                yield (
                    t,
                    "/boreas/vehicle/state",
                    "VehicleState",
                    {
                        "drive_state": int(drive_state[i]),
                        "turn": int(turn[i]),
                        "standstill": bool(smooth_speed[i] < 0.3),
                    },
                )

    def map_overlay() -> Iterator[Event]:
        """Route and notable events as GeoJSON for the Map panel, republished every second."""
        step = 20
        features = [
            {
                "type": "Feature",
                "properties": {"name": "Route"},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [float(longitude[i]), float(latitude[i])]
                        for i in range(0, len(nav_rows), step)
                    ],
                },
            }
        ]
        fastest = int(np.argmax(smooth_speed))
        events = [(fastest, f"Top speed {smooth_speed[fastest] * 3.6:.0f} km/h")]
        events += [(i, f"Hard braking {accel_long[i]:.1f} m/s²") for i in hard_brakes]
        events += [
            (i, "Stop")
            for i in range(1, len(nav_rows))
            if drive_state[i] == 0 and drive_state[i - 1] != 0
        ]
        features += [
            {
                "type": "Feature",
                "properties": {"name": name},
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(longitude[i]), float(latitude[i])],
                },
            }
            for i, name in events
        ]
        geojson = json.dumps({"type": "FeatureCollection", "features": features})
        for t in range(START, END, 1_000_000):
            yield (t, "/boreas/map/route", "GeoJSON", {"geojson": geojson})

    def diagnostics() -> Iterator[Event]:
        """Per-sensor health each second, from the real timing of the recording."""
        lidar_times = np.array([t for t, _ in lidar_frames])
        lidar_points = np.array(
            [fetch(k).stat().st_size // 24 for _, k in lidar_frames]
        )
        sensors = {
            "lidar": ("Velodyne Alpha Prime LiDAR", lidar_times, 10, 0.15),
            "camera": (
                "FLIR Blackfly S camera",
                np.array([t for t, _ in camera_frames]),
                12.5,
                0.15,
            ),
            "radar": (
                "Navtech CIR304-H radar",
                np.array([t for t, _ in radar_frames]),
                4,
                0.35,
            ),
            "gnss_ins": ("Applanix POS LV GNSS/INS", nav_times, 100, 0.05),
        }
        for t in range(START + 1_000_000, END, 1_000_000):
            status = []
            for hardware_id, (name, times, rate, max_gap) in sensors.items():
                window = times[(times >= t - 1_000_000) & (times < t)]
                gaps = (
                    np.diff(np.append(times[times < t - 1_000_000][-1:], window)) / 1e6
                )
                gap = float(gaps.max()) if len(gaps) else 1.0
                ok = len(window) >= rate * 0.9 and gap <= max_gap
                values = [
                    {"key": "Rate (Hz)", "value": str(len(window))},
                    {"key": "Expected rate (Hz)", "value": f"{rate:g}"},
                    {"key": "Largest gap (ms)", "value": f"{gap * 1000:.0f}"},
                ]
                if hardware_id == "lidar":
                    recent = lidar_points[
                        (lidar_times >= t - 1_000_000) & (lidar_times < t)
                    ]
                    values.append(
                        {
                            "key": "Points per scan",
                            "value": f"{int(recent.mean()) if len(recent) else 0:,}",
                        }
                    )
                status.append(
                    {
                        "level": 0 if ok else 1,
                        "name": f"{hardware_id}: {name}",
                        "message": "OK" if ok else f"Frame gap {gap * 1000:.0f} ms",
                        "hardware_id": hardware_id,
                        "values": values,
                    }
                )
            boxes = boxes_at_time(int(lidar_times[lidar_times < t][-1]))
            status.append(
                {
                    "level": 0,
                    "name": "perception: object tracker",
                    "message": f"{len(boxes)} tracks",
                    "hardware_id": "perception",
                    "values": [
                        {"key": c, "value": str(sum(b.cls == c for b in boxes))}
                        for c in CLASSES
                    ],
                }
            )
            yield (
                t,
                "/diagnostics",
                "DiagnosticArray",
                {"header": {"stamp": stamp(t), "frame_id": ""}, "status": status},
            )

    sources = [
        static_transforms(),
        transforms(),
        lidar(),
        objects(),
        route(),
        camera(),
        radar(),
        navigation(),
        map_overlay(),
        diagnostics(),
    ]
    with urllib.request.urlopen(
        "https://raw.githubusercontent.com/foxglove/foxglove-sdk/main/LICENSE",
        timeout=30,
    ) as response:
        schema_license = response.read().decode()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    intermediate = OUTPUT.with_suffix(".unrechunked.mcap")
    custom = {
        "Motion": "lichtblick.BoreasMotion",
        "ObjectTracks": "lichtblick.BoreasObjectTracks",
        "VehicleState": "lichtblick.BoreasVehicleState",
        "ClassCounts": "lichtblick.BoreasClassCounts",
        # Diagnostics panels recognise the ROS schema name, whatever the encoding.
        "DiagnosticArray": "diagnostic_msgs/msg/DiagnosticArray",
    }
    validators = {
        name: jsonschema.Draft7Validator(schema) for name, schema in schemas.items()
    }
    counts: Counter[str] = Counter()
    with intermediate.open("wb") as output:
        writer = Writer(output, compression=CompressionType.ZSTD)
        writer.start(profile="", library="Lichtblick Boreas showcase converter")
        writer.add_metadata(
            "attribution",
            {
                "credit": ATTRIBUTION,
                "license": LICENSE,
                "source": BASE + SEQUENCE + "/",
                "schema_license": schema_license,
            },
        )
        writer.add_metadata(
            "vehicle",
            {
                "platform": "Boreas data-collection vehicle (University of Toronto)",
                "lidar": "Velodyne Alpha Prime, 128 beams, 10 Hz",
                "camera": "FLIR Blackfly S, 2448x2048, rectified",
                "radar": "Navtech CIR304-H, 4 Hz, 0.0596 m range bins",
                "gnss_ins": "Applanix POS LV, postprocessed, 100 Hz",
            },
        )
        writer.add_metadata(
            "excerpt",
            {
                "sequence": SEQUENCE,
                "start_us": str(START),
                "duration_s": str(SECONDS),
                "annotations": "3D boxes with track ids, 5 Hz, Car/Pedestrian/Cyclist/Misc",
                "location": "Toronto, Canada",
            },
        )
        schema_ids: dict[str, int] = {}
        channels: dict[str, int] = {}
        for i, (t, topic, name, message) in enumerate(
            heapq.merge(*sources, key=lambda e: e[0])
        ):
            caller = next(v for k, v in CALLERS.items() if topic.startswith(k))
            if isinstance(message, Message):
                full_name = message.DESCRIPTOR.full_name
                if full_name not in schema_ids:
                    schema_ids[full_name] = writer.register_schema(
                        full_name, "protobuf", descriptor_set(message.DESCRIPTOR)
                    )
                name = full_name
                encoding, data = "protobuf", message.SerializeToString()
            else:
                # Validate a sample of every topic; full validation of every point cloud is slow.
                if counts[topic] < 20 or i % 50 == 0:
                    validators[name].validate(message)
                if name not in schema_ids:
                    schema_ids[name] = writer.register_schema(
                        custom.get(name, f"foxglove.{name}"),
                        "jsonschema",
                        json.dumps(schemas[name]).encode(),
                    )
                encoding = "json"
                data = json.dumps(
                    message, separators=(",", ":"), allow_nan=False
                ).encode()
            if topic not in channels:
                channels[topic] = writer.register_channel(
                    topic, encoding, schema_ids[name], metadata={"callerid": caller}
                )
            writer.add_message(channels[topic], t * 1000, data, publish_time=t * 1000)
            counts[topic] += 1
            if i % 5000 == 0:
                print(
                    f"Wrote {i} messages, {(t - START) / 1e6:.1f}/{SECONDS} s",
                    flush=True,
                )
        writer.finish()
    for topic, rate in {
        "/boreas/lidar": 9.5,
        "/boreas/camera/image": 12,
        "/boreas/vehicle/state": 9.5,
        "/diagnostics": 0.8,
        "/boreas/radar/image": 3.8,
        "/boreas/objects": 9.5,
        "/boreas/motion": 95,
        "/boreas/gps": 9.5,
    }.items():
        assert counts[topic] >= rate * SECONDS, counts
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
        assert summary and summary.statistics
        assert summary.statistics.message_count == sum(counts.values())
        assert next(reader.iter_metadata()).metadata["credit"] == ATTRIBUTION
        duration = (
            summary.statistics.message_end_time - summary.statistics.message_start_time
        ) / 1e9
        assert SECONDS - 0.2 <= duration <= SECONDS, duration
        # Read every chunk, so their CRCs are checked too, not just the summary.
        assert summary.chunk_indexes
        streamed = sum(1 for _ in reader.iter_messages(log_time_order=False))
        assert streamed == sum(counts.values()), (streamed, sum(counts.values()))
    staged.replace(OUTPUT)
    intermediate.unlink()
    print(
        f"Validated {OUTPUT}: {OUTPUT.stat().st_size:,} bytes, {duration:.3f} seconds, {dict(counts)}"
    )


if __name__ == "__main__":
    main()

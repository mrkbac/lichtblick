# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "av==19.0.2", "foxglove-schemas-protobuf==0.4.0", "mcap==1.6.0",
#   "numpy==2.5.5", "opencv-python-headless==5.1.0.95", "pillow==13.0.0", "rosbags==0.11.9", "tfrecord==1.14.7",
#   "zarr==3.4.2", "zstandard==0.25.0",
# ]
# ///
# SPDX-License-Identifier: MPL-2.0
"""Generate the additional Lichtblick example recordings from local publisher files."""

import argparse
import io
import json
import tarfile
import tempfile
from collections import defaultdict
from pathlib import Path
from subprocess import run
from typing import NamedTuple

import av
import numpy as np
import zarr
from foxglove_schemas_protobuf.CameraCalibration_pb2 import CameraCalibration
from foxglove_schemas_protobuf.CompressedImage_pb2 import CompressedImage
from foxglove_schemas_protobuf.CompressedVideo_pb2 import CompressedVideo
from foxglove_schemas_protobuf.FrameTransform_pb2 import FrameTransform
from foxglove_schemas_protobuf.FrameTransforms_pb2 import FrameTransforms
from foxglove_schemas_protobuf.LocationFix_pb2 import LocationFix
from foxglove_schemas_protobuf.SceneUpdate_pb2 import SceneUpdate
from google.protobuf.descriptor import FileDescriptor
from google.protobuf.descriptor_pb2 import FileDescriptorSet
from google.protobuf.message import Message
from google.protobuf.timestamp_pb2 import Timestamp
from mcap.reader import make_reader
from mcap.writer import CompressionType, Writer
from PIL import Image, ImageOps
from rosbags.rosbag1 import Reader
from rosbags.rosbag1.reader import Header, RecordType, decompressors, read_uint32
from rosbags.typesys import Stores, get_typestore
from tfrecord.example_pb2 import Example
from tfrecord.reader import tfrecord_iterator

SAMPLES = (
    Path(__file__).resolve().parents[1] / "packages/suite-base/src/dataSources/samples"
)
NSEC = 10**9
ROS = get_typestore(Stores.ROS2_HUMBLE)
ROS1 = get_typestore(Stores.ROS1_NOETIC)
TYPES = ROS.types
CLOUD = "sensor_msgs/msg/PointCloud2"
JOINT = "sensor_msgs/msg/JointState"
IMU = "sensor_msgs/msg/Imu"
CLIP = 60 * NSEC
GT_START = 1727775013 * NSEC
GT_END = GT_START + CLIP
CF_START = 1689715612 * NSEC
CF_END = CF_START + CLIP

CREDITS = {
    "droid": (
        "DROID, Alexander Khazatsky et al.",
        "https://droid-dataset.github.io/",
        "by",
    ),
    "grandtour": (
        "GrandTour, Robotic Systems Lab, ETH Zurich",
        "https://grand-tour.leggedrobotics.com/",
        "by-sa",
    ),
    "citrusfarm": (
        "CitrusFarm, Hanzhe Teng et al., UC Riverside",
        "https://registry.opendata.aws/citrus-farm/",
        "by-sa",
    ),
}


class Schema(NamedTuple):
    name: str
    encoding: str
    definition: bytes
    message_encoding: str


def descriptor_set(file: FileDescriptor) -> bytes:
    result = FileDescriptorSet()
    seen = set()

    def add(item: FileDescriptor) -> None:
        if item.name not in seen:
            seen.add(item.name)
            for dependency in item.dependencies:
                add(dependency)
            item.CopyToProto(result.file.add())

    add(file)
    return result.SerializeToString()


class Recording:
    def __init__(self) -> None:
        self.events: list[tuple[int, str, bytes]] = []
        self.channels: dict[str, Schema] = {}

    def raw(self, t: int, topic: str, schema: Schema, data: bytes) -> None:
        assert self.channels.setdefault(topic, schema) == schema
        self.events.append((t, topic, data))

    def ros(self, t: int, topic: str, kind: str, msg) -> None:
        if topic not in self.channels:
            self.channels[topic] = Schema(
                kind, "ros2msg", ROS.generate_msgdef(kind, 2)[0].encode(), "cdr"
            )
        self.events.append((t, topic, bytes(ROS.serialize_cdr(msg, kind))))

    def proto(self, t: int, topic: str, msg: Message) -> None:
        if topic not in self.channels:
            desc = msg.DESCRIPTOR
            self.channels[topic] = Schema(
                desc.full_name, "protobuf", descriptor_set(desc.file), "protobuf"
            )
        self.events.append((t, topic, msg.SerializeToString()))

    def json(self, t: int, topic: str, data: dict) -> None:
        self.raw(
            t,
            topic,
            Schema("", "", b"", "json"),
            json.dumps(data, allow_nan=False).encode(),
        )

    def video(
        self,
        topic: str,
        frame: str,
        frames: list[tuple[int, Image.Image]],
        fps: int,
        width: int,
        preview: Path | None = None,
    ) -> tuple[int, int]:
        if len(frames) < fps:
            raise ValueError(f"{topic}: only {len(frames)} frames")
        example = frames[len(frames) // 2][1]
        size = (width, round(width * example.height / example.width / 2) * 2)
        if preview:
            ImageOps.fit(example.convert("RGB"), (320, 180)).save(preview, quality=86)

        encoder = av.CodecContext.create("libx265", "w")
        encoder.width, encoder.height = size
        encoder.pix_fmt = "yuv420p"
        encoder.framerate = fps
        encoder.options = {
            "preset": "fast",
            "crf": "25",
            "x265-params": f"keyint={fps}:min-keyint={fps}:bframes=0:repeat-headers=1:pools=2:log-level=error",
        }
        timestamps = [t for t, _ in frames]

        def write(packets: list[av.Packet]) -> None:
            for packet in packets:
                t = timestamps[packet.pts]
                self.proto(
                    t,
                    topic,
                    CompressedVideo(
                        timestamp=stamp(t),
                        frame_id=frame,
                        data=bytes(packet),
                        format="h265",
                    ),
                )

        for index, (_, image) in enumerate(frames):
            av_frame = av.VideoFrame.from_image(
                image.convert("RGB").resize(size, Image.Resampling.LANCZOS)
            )
            av_frame.pts = index
            write(encoder.encode(av_frame))
        write(encoder.encode(None))
        assert sum(name == topic for _, name, _ in self.events) == len(frames)
        return size

    def write(self, path: Path, credit: str = "") -> None:
        schemas = {}
        with path.open("wb") as stream:
            w = Writer(
                stream,
                chunk_size=2**20,
                compression=CompressionType.ZSTD,
                enable_crcs=True,
            )
            w.start(library="Lichtblick dataset samples")
            if credit:
                w.add_metadata("Attribution", {"license": credit})
                w.add_attachment(0, 0, "Attribution.txt", "text/plain", credit.encode())
                license_name = "foxglove-schema-LICENSE"
                w.add_attachment(
                    0,
                    0,
                    license_name,
                    "text/plain",
                    (SAMPLES / license_name).read_bytes(),
                )
            channels = {}
            for topic, schema in self.channels.items():
                if schema not in schemas:
                    schemas[schema] = (
                        w.register_schema(*schema[:3]) if schema.name else 0
                    )
                channels[topic] = w.register_channel(
                    topic, schema.message_encoding, schemas[schema]
                )
            for t, topic, data in sorted(self.events, key=lambda event: event[0]):
                w.add_message(channels[topic], t, data, t)
            w.finish()


def stamp(t: int) -> Timestamp:
    return Timestamp(seconds=t // NSEC, nanos=t % NSEC)


def header(t: int, frame: str):
    return TYPES["std_msgs/msg/Header"](
        TYPES["builtin_interfaces/msg/Time"](t // NSEC, t % NSEC), frame
    )


def cloud(t: int, frame: str, points: np.ndarray):
    names = ("x", "y", "z", "intensity")
    packed = np.ascontiguousarray(points, dtype="<f4")
    fields = [
        TYPES["sensor_msgs/msg/PointField"](name, i * 4, 7, 1)
        for i, name in enumerate(names)
    ]
    return TYPES[CLOUD](
        header(t, frame),
        1,
        len(packed),
        fields,
        False,
        16,
        16 * len(packed),
        packed.view(np.uint8).ravel(),
        True,
    )


def transform(rec: Recording, t: int, parent: str, child: str, xyz, xyzw) -> None:
    rec.proto(t, "/tf", frame_transform(t, parent, child, xyz, xyzw))


def frame_transform(t: int, parent: str, child: str, xyz, xyzw) -> FrameTransform:
    return FrameTransform(
        timestamp=stamp(t),
        parent_frame_id=parent,
        child_frame_id=child,
        translation=dict(zip("xyz", xyz, strict=True)),
        rotation=dict(zip("xyzw", xyzw, strict=True)),
    )


def path_scene(
    rec: Recording, t: int, frame: str, name: str, points: np.ndarray, color: dict
) -> None:
    if len(points) < 2:
        return
    scene = SceneUpdate()
    entity = scene.entities.add(timestamp=stamp(t), frame_id=frame, id=name)
    line = entity.lines.add(type=0, thickness=3, scale_invariant=True, color=color)
    line.pose.orientation.w = 1
    for x, y, z in points:
        line.points.add(x=x, y=y, z=z)
    rec.proto(t, "/trajectory", scene)


def quaternion(rpy: np.ndarray) -> tuple[float, float, float, float]:
    sr, sp, sy = np.sin(rpy / 2)
    cr, cp, cy = np.cos(rpy / 2)
    return (
        sr * cp * cy - cr * sp * sy,
        cr * sp * cy + sr * cp * sy,
        cr * cp * sy - sr * sp * cy,
        cr * cp * cy + sr * sp * sy,
    )


def droid(source: Path, rec: Recording, preview: Path) -> str:
    example = Example.FromString(
        next(tfrecord_iterator(str(source / "droid.tfrecord")))
    )
    features = example.features.feature
    obs = "steps/observation/"
    cameras = {
        "exterior_1": "exterior_image_1_left",
        "exterior_2": "exterior_image_2_left",
        "wrist": "wrist_image_left",
    }
    n = len(features[obs + cameras["wrist"]].bytes_list.value)
    timestamps = [NSEC + round(index * NSEC / 15) for index in range(n)]
    episode = "RAIL+80edfcb1+2023-04-17-14h-48m-05s"

    def annotation(name: str) -> dict:
        return json.loads((source / f"droid-{name}.json").read_bytes())[episode]

    serials = annotation("camera_serials")
    intrinsics = annotation("intrinsics")
    calibration = annotation("cam2cam_extrinsics")
    rec.json(
        timestamps[0],
        "/camera/exterior_calibration",
        {
            "left_camera": calibration["left_cam"],
            "right_camera": calibration["right_cam"],
            "num_matches": calibration["quality_metric"],
        },
    )
    for name, key in cameras.items():
        images = features[obs + key].bytes_list.value
        topic = f"/camera/{name}"
        size = rec.video(
            topic,
            name,
            [
                (t, Image.open(io.BytesIO(jpeg)))
                for t, jpeg in zip(timestamps, images, strict=True)
            ],
            15,
            320,
            preview if name == "exterior_1" else None,
        )
        serial_key = {
            "exterior_1": "ext1_cam_serial",
            "exterior_2": "ext2_cam_serial",
            "wrist": "wrist_cam_serial",
        }[name]
        info = intrinsics[serials[serial_key]]
        fx, cx, fy, cy = info["cameraMatrix"]
        add_calibration(
            rec,
            timestamps[0],
            topic + "/camera_info",
            name,
            {
                "width": info["width"],
                "height": info["height"],
                "distortion_model": "plumb_bob",
                "D": info["distCoeffs"][:5],
                "K": [fx, 0, cx, 0, fy, cy, 0, 0, 1],
                "R": [1, 0, 0, 0, 1, 0, 0, 0, 1],
                "P": [fx, 0, cx, 0, 0, fy, cy, 0, 0, 0, 1, 0],
            },
            size,
        )

    def values(key: str) -> np.ndarray:
        return np.array(features[key].float_list.value, dtype=np.float64).reshape(n, -1)

    joints = values(obs + "joint_position")
    pose = values(obs + "cartesian_position")
    gripper = values(obs + "gripper_position")[:, 0]
    commands = {
        key: values("steps/action_dict/" + key)
        for key in (
            "cartesian_position",
            "cartesian_velocity",
            "joint_position",
            "joint_velocity",
            "gripper_position",
            "gripper_velocity",
        )
    }
    annotations = list(annotation("droid_language_annotations").values())
    for i, t in enumerate(timestamps):
        rec.ros(
            t,
            "/arm/joint_states",
            JOINT,
            TYPES[JOINT](
                header(t, "base"),
                [f"panda_joint{axis + 1}" for axis in range(joints.shape[1])],
                joints[i],
                np.empty(0),
                np.empty(0),
            ),
        )
        transform(rec, t, "base", "end_effector", pose[i, :3], quaternion(pose[i, 3:]))
        rec.json(
            t,
            "/arm/state",
            {"gripper_position": gripper[i], "cartesian_position": pose[i].tolist()},
        )
        rec.json(
            t,
            "/arm/command",
            {key: value[i].tolist() for key, value in commands.items()},
        )
        rec.json(
            t,
            "/task",
            {
                "instructions": [
                    instruction for instruction in annotations if instruction
                ],
                "step": i,
                "complete": bool(features["steps/is_last"].int64_list.value[i]),
                "reward": features["steps/reward"].float_list.value[i],
            },
        )
    path_scene(
        rec,
        timestamps[0],
        "base",
        "end_effector_path",
        pose[:, :3],
        {"r": 0.25, "g": 0.8, "b": 1, "a": 1},
    )
    return (
        "First episode of droid_100/1.0.0 (face-blurred RLDS): Put the marker in the pot. "
        "All three recorded camera views were encoded as H.265. Matching language annotations, "
        "camera intrinsics and exterior-camera calibration are from https://huggingface.co/KarlP/droid. "
        "Time reconstructed at the "
        "published 15 Hz. End-effector path derived from measured Cartesian position."
    )


def sensor_file(path: Path, group: str, suffix: str, indices: set[int]):
    with tarfile.open(path, "r|") as archive:
        for member in archive:
            if member.isfile() and member.name.endswith(suffix):
                name = Path(member.name)
                if name.parent.name == group and int(name.stem) in indices:
                    yield int(name.stem), archive.extractfile(member).read()
                    indices.remove(int(name.stem))
                    if not indices:
                        return
    raise ValueError(f"{path}: missing {len(indices)} frames")


def timed(group, start=GT_START, end=GT_END, stride=1):
    times = np.rint(group["timestamp"][:] * NSEC).astype("int64")
    lo, hi = np.searchsorted(times, [start, end])
    return [(int(i), int(times[i])) for i in range(lo, hi, stride)]


def add_calibration(
    rec: Recording, t: int, topic: str, frame: str, info: dict, size
) -> None:
    sx, sy = size[0] / info["width"], size[1] / info["height"]

    def scaled(data: list[float], columns: int) -> list[float]:
        return [
            value * (sx if i < columns else sy if i < 2 * columns else 1)
            for i, value in enumerate(data)
        ]

    calibration = CameraCalibration(
        frame_id=frame,
        width=size[0],
        height=size[1],
        distortion_model={"radtan": "plumb_bob"}.get(
            info["distortion_model"], info["distortion_model"]
        ),
        D=info["D"],
        K=scaled(info["K"], 3),
        R=info["R"],
        P=scaled(info["P"], 4),
    )
    image_topic = topic.removesuffix("/camera_info")
    # Publish camera info with each frame so a panel can subscribe at any playhead position.
    times = (
        [time for time, name, _ in rec.events if name == image_topic]
        if image_topic != topic
        else [t]
    )
    if not times:
        raise ValueError(f"No images for calibration topic {topic}")
    for time in times:
        calibration.timestamp.CopyFrom(stamp(time))
        rec.proto(time, topic, calibration)


def png_depth(rec: Recording, t: int, topic: str, frame: str, mm: np.ndarray) -> None:
    png = io.BytesIO()
    Image.fromarray(np.ascontiguousarray(mm, dtype=np.uint16)).save(png, format="PNG")
    kind = "sensor_msgs/msg/CompressedImage"
    rec.ros(
        t,
        topic,
        kind,
        TYPES[kind](
            header(t, frame),
            "16UC1; compressedDepth png",
            np.frombuffer(b"\x00" * 12 + png.getvalue(), np.uint8),
        ),
    )


def grandtour(source: Path, rec: Recording, lidar: Recording, preview: Path) -> str:
    def group(name: str):
        return zarr.open_group(source / name, mode="r")

    for name, file, topic, fps in [
        ("hdr_front", "hdr-images.tar", "/camera/hdr", 10),
        ("zed2i_left_images", "zed-images.tar", "/camera/zed", 15),
        ("zed2i_depth_image", "images-zed2i_depth_image.tar", "/camera/depth", 5),
    ]:
        g = group(name)
        is_depth = topic.endswith("depth")
        image_times = dict(timed(g, stride=3 if is_depth else 1))
        frame = g.attrs["frame_id"]
        info = dict(g.attrs["camera_info"])
        images = sensor_file(
            source / file, name, ".png" if is_depth else ".jpeg", set(image_times)
        )
        if is_depth:
            size = (480, 270)
            for i, data in images:
                image = Image.open(io.BytesIO(data))
                mm = np.asarray(image.resize(size, Image.Resampling.NEAREST))
                assert mm.ndim == 2 and mm.dtype.itemsize >= 2
                png_depth(rec, image_times[i], topic, frame, mm)
        else:
            frames = sorted(
                (image_times[i], Image.open(io.BytesIO(data))) for i, data in images
            )
            if name == "hdr_front":
                import cv2

                # Rectify the publisher's equidistant fisheye using its calibrated camera model.
                source_size = (info["width"], info["height"])
                add_calibration(
                    rec,
                    GT_START,
                    topic + "/source_calibration",
                    frame,
                    info,
                    source_size,
                )
                k = np.array(info["K"]).reshape(3, 3)
                d = np.array(info["D"])
                r = np.eye(3)
                p = cv2.fisheye.estimateNewCameraMatrixForUndistortRectify(
                    k, d, source_size, r
                )
                xy = cv2.fisheye.initUndistortRectifyMap(
                    k, d, r, p, source_size, cv2.CV_16SC2
                )
                frames = [
                    (
                        t,
                        Image.fromarray(
                            cv2.remap(
                                np.asarray(image.convert("RGB")), *xy, cv2.INTER_LINEAR
                            )
                        ),
                    )
                    for t, image in frames
                ]
                info.update(
                    distortion_model="plumb_bob",
                    D=[0.0] * 5,
                    K=p.ravel().tolist(),
                    R=r.ravel().tolist(),
                    P=np.column_stack((p, np.zeros(3))).ravel().tolist(),
                )
            size = rec.video(
                topic,
                frame,
                frames,
                fps,
                960 if fps == 10 else 640,
                preview if fps == 10 else None,
            )
        add_calibration(
            rec,
            GT_START,
            topic + "/camera_info",
            frame,
            info,
            size,
        )

    static = [
        frame_transform(
            GT_START,
            tf["base_frame_id"],
            tf["child_frame_id"],
            [tf["translation"][axis] for axis in "xyz"],
            [tf["rotation"][axis] for axis in "xyzw"],
        )
        for name, tf in group("tf").attrs["tf"].items()
        if name
        in {
            "hdr_front",
            "zed2i_left",
            "zed2i_right",
            "anymal_imu",
            "livox_lidar",
            "box_base",
        }
    ]
    rec.proto(GT_START, "/tf_static", FrameTransforms(transforms=static))
    g = group("livox_points")
    samples = timed(g)
    lo, hi = samples[0][0], samples[-1][0] + 1
    xyz, intensity, counts = [g[key][lo:hi] for key in ("points", "intensity", "valid")]
    for k, (_, t) in enumerate(samples):
        count = int(counts[k, 0])
        points = np.column_stack((xyz[k, :count], intensity[k, :count]))
        points = points[np.isfinite(points).all(axis=1)]
        lidar.ros(t, "/lidar/points", CLOUD, cloud(t, "livox_lidar", points))

    colors = [
        {"r": 0.3, "g": 0.9, "b": 1, "a": 1},
        {"r": 1, "g": 0.65, "b": 0.2, "a": 1},
    ]
    for n, name, frame in [
        (0, "anymal_state_odometry", "odom"),
        (1, "dlio_map_odometry", "dlio_map"),
    ]:
        g = group(name)
        samples = timed(g)
        lo, hi = samples[0][0], samples[-1][0] + 1
        positions, angles = g["pose_pos"][lo:hi], g["pose_orien"][lo:hi]
        linear, angular = g["twist_lin"][lo:hi], g["twist_ang"][lo:hi]
        origin = positions[0].copy()
        positions -= origin
        for k, (_, t) in enumerate(samples):
            if n == 0:
                transform(rec, t, frame, "base", positions[k], angles[k])
            rec.json(
                t,
                "/odometry/" + frame,
                {
                    "position": positions[k].tolist(),
                    "orientation": angles[k].tolist(),
                    "linear_velocity": linear[k].tolist(),
                    "angular_velocity": angular[k].tolist(),
                    "speed": float(np.linalg.norm(linear[k])),
                },
            )
        if n == 0:
            path_scene(rec, GT_START, frame, name, positions, colors[n])

    g = group("prism_position")
    tm = timed(g)
    prism = g["point"][tm[0][0] : tm[-1][0] + 1]
    for (_, t), point in zip(tm, prism, strict=True):
        rec.json(
            t,
            "/ground_truth/leica_prism",
            dict(zip("xyz", point.tolist(), strict=True)),
        )

    g = group("navsatfix_cpt7_ie_tc")
    tm = timed(g, stride=10)
    sl = slice(tm[0][0], tm[-1][0] + 1, 10)
    fixes = zip(*(g[field][sl] for field in ("lat", "long", "alt")), strict=True)
    for (_, t), (lat, lon, alt) in zip(tm, fixes, strict=True):
        if np.isfinite((lat, lon, alt)).all():
            rec.proto(
                t,
                "/gnss/rtk",
                LocationFix(
                    timestamp=stamp(t),
                    frame_id="enu_origin",
                    latitude=lat,
                    longitude=lon,
                    altitude=alt,
                ),
            )

    g = group("anymal_imu")
    tm = timed(g, stride=4)
    sl = slice(tm[0][0], tm[-1][0] + 1, 4)

    def vec(vals):
        return TYPES["geometry_msgs/msg/Vector3"](*vals)

    fields = [
        g[name][sl]
        for name in (
            "orien",
            "orien_cov",
            "ang_vel",
            "ang_vel_cov",
            "lin_acc",
            "lin_acc_cov",
        )
    ]
    for (_, t), (q, qc, w, wc, a, ac) in zip(
        tm, zip(*fields, strict=True), strict=True
    ):
        rec.ros(
            t,
            "/imu",
            IMU,
            TYPES[IMU](
                header(t, "anymal_imu"),
                TYPES["geometry_msgs/msg/Quaternion"](*q),
                qc.ravel(),
                vec(w),
                wc.ravel(),
                vec(a),
                ac.ravel(),
            ),
        )

    g = group("anymal_state_actuator")
    tm = timed(g, stride=4)
    sl = slice(tm[0][0], tm[-1][0] + 1, 4)
    names = [
        f"{leg}_{joint}"
        for leg in ("LF", "RF", "LH", "RH")
        for joint in ("HAA", "HFE", "KFE")
    ]
    for topic, fields in {
        "/joints/measured": (
            "state_joint_position",
            "state_joint_velocity",
            "state_joint_torque",
        ),
        "/joints/commanded": (
            "command_position",
            "command_velocity",
            "command_joint_torque",
        ),
    }.items():
        series = [
            np.column_stack([g[f"{i:02d}_{field}"][sl] for i in range(12)])
            for field in fields
        ]
        for (_, t), (p, v, e) in zip(tm, zip(*series, strict=True), strict=True):
            rec.ros(t, topic, JOINT, TYPES[JOINT](header(t, "base"), names, p, v, e))
    return (
        "ETH-1 (Polyterrasse), 2024-10-01-11-29-55. 60-second excerpt. The HDR camera was rectified using the published equidistant calibration. Cameras resized and "
        "re-encoded as H.265; published ZED SDK depth resized and saved as 16-bit PNG. "
        "Livox XYZ and intensity encoded with Cloudini. Static calibration retained for "
        "selected sensors. ANYmal and DLIO positions shifted to their own local origins. "
        "Leica prism and post-processed tightly coupled GNSS included. IMU, joint and GNSS "
        "streams downsampled to 100, 100 and 20 Hz."
    )


def bag_messages(path: Path):
    # The local input can also be a range extract containing only complete ROS bag chunks.
    reader = Reader(path)
    connections = {}
    metadata = path.with_suffix(".connections")
    if metadata.exists():
        with metadata.open("rb") as reader.bio:
            while reader.bio.tell() < metadata.stat().st_size:
                connection = reader.read_connection()
                connections[connection.id] = connection
    end = path.stat().st_size
    with path.open("rb") as stream:
        assert stream.readline() == b"#ROSBAG V2.0\n"
        Header.read(stream, RecordType.BAGHEADER)
        stream.seek(read_uint32(stream), 1)
        while stream.tell() < end:
            if end - stream.tell() < 4:
                break
            tags = Header.read(stream)
            size = read_uint32(stream)
            if stream.tell() + size > end:
                break
            if tags.get_uint8("op") != RecordType.CHUNK:
                stream.seek(size, 1)
                continue
            data = decompressors[tags.get_string("compression")](stream.read(size))
            reader.bio = chunk = io.BytesIO(data)
            while chunk.tell() < len(data):
                start = chunk.tell()
                record = Header.read(chunk)
                if record.get_uint8("op") == RecordType.CONNECTION:
                    chunk.seek(start)
                    connection = reader.read_connection()
                    connections[connection.id] = connection
                else:
                    assert record.get_uint8("op") == RecordType.MSGDATA
                    connection = connections[record.get_uint32("conn")]
                    yield (
                        connection,
                        record.get_time("time"),
                        chunk.read(read_uint32(chunk)),
                    )


def image_pixels(msg, dtype: str, channels: int = 1) -> np.ndarray:
    kind = np.dtype(dtype).newbyteorder(">" if msg.is_bigendian else "<")
    rows = np.ndarray(
        (msg.height, msg.width, channels),
        kind,
        msg.data,
        strides=(msg.step, kind.itemsize * channels, kind.itemsize),
    )
    return rows[:, :, 0] if channels == 1 else rows


def rgb_image(msg) -> Image.Image:
    if msg.encoding in {"bgr8", "rgb8", "bgra8", "rgba8"}:
        data = image_pixels(msg, "u1", len(msg.encoding) - 1)[:, :, :3]
        return Image.fromarray(
            data[:, :, ::-1] if msg.encoding.startswith("bgr") else data
        )
    if msg.encoding == "mono8":
        return Image.fromarray(image_pixels(msg, "u1"))
    if msg.encoding in {"mono16", "16UC1"}:
        return Image.fromarray(image_pixels(msg, "u2"))
    raise ValueError(f"Unsupported camera encoding {msg.encoding}")


def citrusfarm(source: Path, rec: Recording, lidar: Recording, preview: Path) -> str:
    videos = {
        "/zed2i/zed_node/left/image_rect_color": "/camera/left",
        "/zed2i/zed_node/right/image_rect_color": "/camera/right",
        "/flir/blackfly/cam0/image_raw": "/camera/monochrome",
        "/mapir_cam/image_raw": "/camera/red_green_nir",
    }
    buffers = defaultdict(list)
    frames = {}
    camera_info = {}
    first_pose = None
    route = []
    lidar_frame = None
    last_depth = last_thermal = CF_START - NSEC
    for path in [
        source / name
        for name in (
            "base.part",
            "adk.part",
            "zed_2023-07-18-14-26-49_0.clip",
            "zed_2023-07-18-14-27-17_1.clip",
            "zed_2023-07-18-14-27-46_2.clip",
            "odom.bag",
            "gt.bag",
            "blackfly_2023-07-18-14-26-48_0.clip",
            "mapir_2023-07-18-14-26-48_0.clip",
        )
    ]:
        for c, t, data in bag_messages(path):
            if t >= CF_END:
                break
            if t < CF_START:
                continue
            name, kind = c.topic, c.msgtype
            if name in videos:
                msg = ROS1.deserialize_ros1(data, kind)
                buffers[name].append((t, rgb_image(msg).copy()))
                frames[name] = msg.header.frame_id
            elif name.endswith("/camera_info"):
                if name not in camera_info:
                    camera_info[name] = ROS1.deserialize_ros1(data, kind)
            elif name == "/velodyne_points":
                msg = ROS1.deserialize_ros1(data, kind)
                lidar_frame = msg.header.frame_id
                fields = {field.name: field.offset for field in msg.fields}
                assert all(
                    next(f.datatype for f in msg.fields if f.name == axis) == 7
                    for axis in ("x", "y", "z", "intensity")
                )
                endian = ">" if msg.is_bigendian else "<"
                raw = np.column_stack(
                    [
                        np.ndarray(
                            msg.width * msg.height,
                            endian + "f4",
                            msg.data,
                            fields[axis],
                            (msg.point_step,),
                        )
                        for axis in ("x", "y", "z", "intensity")
                    ]
                )
                raw = raw[np.isfinite(raw).all(axis=1)]
                lidar.ros(t, "/lidar/points", CLOUD, cloud(t, msg.header.frame_id, raw))
            elif name.endswith("/depth_registered") and t - last_depth >= 175_000_000:
                last_depth = t
                msg = ROS1.deserialize_ros1(data, kind)
                assert msg.encoding == "32FC1"
                depth = image_pixels(msg, "f4")[::3, ::3]
                mm = np.where(np.isfinite(depth), np.maximum(0, depth), 0) * 1000
                png_depth(
                    rec, t, "/camera/depth", msg.header.frame_id, np.clip(mm, 0, 65535)
                )
            elif name == "/flir/adk/image_thermal" and t - last_thermal >= 175_000_000:
                last_thermal = t
                msg = ROS1.deserialize_ros1(data, kind)
                image = rgb_image(msg)
                assert image.mode == "L"
                payload = io.BytesIO()
                image.resize((320, 256), Image.Resampling.NEAREST).save(
                    payload, format="PNG"
                )
                rec.proto(
                    t,
                    "/camera/thermal",
                    CompressedImage(
                        timestamp=stamp(t),
                        frame_id=msg.header.frame_id,
                        format="png",
                        data=payload.getvalue(),
                    ),
                )
            elif name in {
                "/microstrain/imu/data",
                "/microstrain/mag",
                "/piksi/navsatfix_best_fix",
                "/piksi/debug/receiver_state",
                "/jackal_velocity_controller/odom",
                "/zed2i/zed_node/pose",
                "/gps/fix/odometry",
            }:
                rec.raw(
                    t,
                    name,
                    Schema(
                        kind.replace("/msg/", "/"),
                        "ros1msg",
                        c.msgdef.data.encode(),
                        "ros1",
                    ),
                    data,
                )
                if name == "/jackal_velocity_controller/odom":
                    msg = ROS1.deserialize_ros1(data, kind)
                    p = msg.pose.pose.position
                    q = msg.pose.pose.orientation
                    p = np.array([p.x, p.y, p.z])
                    if first_pose is None:
                        first_pose = p
                    local = p - first_pose
                    route.append(local)
                    transform(
                        rec,
                        t,
                        msg.header.frame_id,
                        msg.child_frame_id,
                        local,
                        (q.x, q.y, q.z, q.w),
                    )

    assert lidar_frame and route
    # CitrusFarm Calibration/results/05-baselink-lidar-result.txt.
    rec.proto(
        CF_START,
        "/tf_static",
        frame_transform(
            CF_START,
            "base_link",
            lidar_frame,
            (0.0400, 0, 0.3787),
            (0, 0, 0, 1),
        ),
    )
    path_scene(
        rec,
        CF_START,
        "odom",
        "wheel_odometry",
        np.array(route),
        {"r": 1, "g": 0.7, "b": 0.25, "a": 1},
    )
    for name, topic in videos.items():
        size = rec.video(
            topic,
            frames[name],
            sorted(buffers[name]),
            10,
            {"/camera/left": 720, "/camera/right": 640}.get(topic, 480),
            preview if topic == "/camera/left" else None,
        )
        info = camera_info.get(name.rsplit("/", 1)[0] + "/camera_info")
        if info:
            add_calibration(
                rec,
                CF_START,
                topic + "/camera_info",
                frames[name],
                {
                    "width": info.width,
                    "height": info.height,
                    "distortion_model": info.distortion_model,
                    "D": info.D.tolist(),
                    "K": info.K.tolist(),
                    "R": info.R.tolist(),
                    "P": info.P.tolist(),
                },
                size,
            )
    depth_info = camera_info["/zed2i/zed_node/depth/camera_info"]
    add_calibration(
        rec,
        CF_START,
        "/camera/depth/camera_info",
        depth_info.header.frame_id,
        {
            "width": depth_info.width,
            "height": depth_info.height,
            "distortion_model": depth_info.distortion_model,
            "D": depth_info.D.tolist(),
            "K": depth_info.K.tolist(),
            "R": depth_info.R.tolist(),
            "P": depth_info.P.tolist(),
        },
        ((depth_info.width + 2) // 3, (depth_info.height + 2) // 3),
    )
    return (
        "01_13B_Jackal, 2023-07-18-14-26-48, 12–72 seconds from 2023-07-18 21:26:40 UTC. "
        "Stereo RGB, monochrome and R-G-NIR resized and encoded as H.265. Thermal is 320×256 PNG. "
        "Thermal and depth sampled at 5 Hz. Metric ZED depth was reduced to one sample per "
        "3×3 block and rounded to millimetres. "
        "Velodyne XYZ and intensity encoded with Cloudini. IMU, magnetometer, GNSS/RTK fix "
        "and receiver diagnostics, wheel odometry, ZED pose, published LiDAR mounting "
        "calibration and the published RTK ground-truth odometry retained."
    )


def add_cloudini(rec: Recording, lidar: Recording, converter: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        plain, encoded = [Path(tmp) / file for file in ("plain.mcap", "cloudini.mcap")]
        lidar.write(plain)
        run(
            [
                str(converter.resolve()),
                "-f",
                str(plain),
                "-o",
                str(encoded),
                "-c",
                "-y",
                "--profile",
                "xyz:0.005; intensity:0.01",
            ],
            check=True,
        )
        with encoded.open("rb") as stream:
            for schema, channel, msg in make_reader(stream).iter_messages():
                assert "CompressedPointCloud2" in schema.name
                rec.raw(
                    msg.log_time,
                    channel.topic,
                    Schema(
                        schema.name,
                        schema.encoding,
                        schema.data,
                        channel.message_encoding,
                    ),
                    msg.data,
                )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", choices=CREDITS)
    parser.add_argument("source", type=Path)
    parser.add_argument("--cloudini-converter", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=SAMPLES,
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    preview = args.output / (args.dataset + ".jpg")
    rec = Recording()
    if args.dataset == "droid":
        changes = droid(args.source, rec, preview)
    else:
        if not args.cloudini_converter:
            parser.error(
                "--cloudini-converter is required for GrandTour and CitrusFarm"
            )
        lidar = Recording()
        convert = grandtour if args.dataset == "grandtour" else citrusfarm
        changes = convert(args.source, rec, lidar, preview)
        add_cloudini(rec, lidar, args.cloudini_converter)
    name, url, license_slug = CREDITS[args.dataset]
    license_url = f"https://creativecommons.org/licenses/{license_slug}/4.0/"
    out = args.output / (args.dataset + ".mcap")
    rec.write(out, f"{name}\n{url}\n{license_url}\n\nAdapted for Lichtblick. {changes}")
    with out.open("rb") as stream:
        summary = make_reader(stream, validate_crcs=True).get_summary()
        assert summary.statistics.channel_count == len(rec.channels)
        assert summary.statistics.message_count == len(rec.events)
    print(out, out.stat().st_size, "bytes")


if __name__ == "__main__":
    main()

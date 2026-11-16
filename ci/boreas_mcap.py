# SPDX-License-Identifier: MPL-2.0
"""Message codecs and an MCAP record writer for the Boreas showcase (ci/create-boreas-showcase.py).

Every schema and message encoding Lichtblick reads gets a codec here. The writer gives each topic
group its own chunk stream, so the file also covers container features a stock writer never
produces: mixed chunk compression, overlapping chunks, out-of-order and empty chunks, chunks
without message indexes or CRCs, and messages outside chunks.
"""

import hashlib
import io
import itertools
import json
import math
import os
import struct
import tempfile
import zlib
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO

import capnp
import cbor2
import flatbuffers
import lz4.frame
import msgpack
import zstandard
from foxglove_schemas_flatbuffer import LocationFix as fb_location_fix_table
from foxglove_schemas_flatbuffer import Time as fb_time
from foxglove_schemas_flatbuffer import get_schema as flatbuffer_schema
from mcap.data_stream import RecordBuilder
from mcap.opcode import Opcode
from mcap.records import (
    Attachment,
    AttachmentIndex,
    Channel,
    Chunk,
    ChunkIndex,
    DataEnd,
    Header,
    Message,
    MessageIndex,
    Metadata,
    MetadataIndex,
    Schema,
    Statistics,
    SummaryOffset,
)
from mcap.well_known import SchemaEncoding
from mcap_ros1._vendor import genpy
from mcap_ros1._vendor.genpy.dynamic import generate_dynamic
from mcap_ros2._dynamic import serialize_dynamic

MAGIC = b"\x89MCAP0\r\n"
SEPARATOR = "=" * 80


@dataclass(frozen=True)
class Codec:
    schema_name: str
    schema_encoding: str
    schema_data: bytes
    message_encoding: str
    encode: Callable[..., bytes]


# --- ROS 2 (.msg, CDR) ------------------------------------------------------------------------

ROS2_HEADER = f"""
{SEPARATOR}
MSG: std_msgs/Header
builtin_interfaces/Time stamp
string frame_id
{SEPARATOR}
MSG: builtin_interfaces/Time
int32 sec
uint32 nanosec"""

CAMERA_INFO = (
    """std_msgs/Header header
uint32 height
uint32 width
string distortion_model
float64[] d
float64[9] k
float64[9] r
float64[12] p
uint32 binning_x
uint32 binning_y
RegionOfInterest roi"""
    + ROS2_HEADER
    + f"""
{SEPARATOR}
MSG: sensor_msgs/RegionOfInterest
uint32 x_offset
uint32 y_offset
uint32 height
uint32 width
bool do_rectify"""
)

POINT_CLOUD2 = (
    """std_msgs/Header header
uint32 height
uint32 width
PointField[] fields
bool is_bigendian
uint32 point_step
uint32 row_step
uint8[] data
bool is_dense"""
    + ROS2_HEADER
    + f"""
{SEPARATOR}
MSG: sensor_msgs/PointField
uint8 INT8 = 1
uint8 UINT8 = 2
uint8 INT16 = 3
uint8 UINT16 = 4
uint8 INT32 = 5
uint8 UINT32 = 6
uint8 FLOAT32 = 7
uint8 FLOAT64 = 8
string name
uint32 offset
uint8 datatype
uint32 count"""
)

LOG = f"""byte DEBUG=10
byte INFO=20
byte WARN=30
byte ERROR=40
byte FATAL=50
builtin_interfaces/Time stamp
uint8 level
string name
string msg
string file
string function
uint32 line
{SEPARATOR}
MSG: builtin_interfaces/Time
int32 sec
uint32 nanosec"""

# TFMessage in .msg form: the ROS 2 IDL channel is encoded with it (same CDR layout).
TF_MESSAGE = (
    """geometry_msgs/TransformStamped[] transforms"""
    + f"""
{SEPARATOR}
MSG: geometry_msgs/TransformStamped
std_msgs/Header header
string child_frame_id
Transform transform
{SEPARATOR}
MSG: geometry_msgs/Transform
Vector3 translation
Quaternion rotation
{SEPARATOR}
MSG: geometry_msgs/Vector3
float64 x
float64 y
float64 z
{SEPARATOR}
MSG: geometry_msgs/Quaternion
float64 x
float64 y
float64 z
float64 w"""
    + ROS2_HEADER
)

TF_MESSAGE_IDL = f"""module tf2_msgs {{ module msg {{
  struct TFMessage {{
    sequence<geometry_msgs::msg::TransformStamped> transforms;
  }};
}}; }};
{SEPARATOR}
IDL: geometry_msgs/msg/TransformStamped
module geometry_msgs {{ module msg {{
  struct TransformStamped {{
    std_msgs::msg::Header header;
    string child_frame_id;
    geometry_msgs::msg::Transform transform;
  }};
}}; }};
{SEPARATOR}
IDL: geometry_msgs/msg/Transform
module geometry_msgs {{ module msg {{
  struct Transform {{
    geometry_msgs::msg::Vector3 translation;
    geometry_msgs::msg::Quaternion rotation;
  }};
}}; }};
{SEPARATOR}
IDL: geometry_msgs/msg/Vector3
module geometry_msgs {{ module msg {{
  struct Vector3 {{ double x; double y; double z; }};
}}; }};
{SEPARATOR}
IDL: geometry_msgs/msg/Quaternion
module geometry_msgs {{ module msg {{
  struct Quaternion {{ double x; double y; double z; double w; }};
}}; }};
{SEPARATOR}
IDL: std_msgs/msg/Header
module std_msgs {{ module msg {{
  struct Header {{ builtin_interfaces::msg::Time stamp; string frame_id; }};
}}; }};
{SEPARATOR}
IDL: builtin_interfaces/msg/Time
module builtin_interfaces {{ module msg {{
  struct Time {{ int32 sec; uint32 nanosec; }};
}}; }};
"""


def ros2(name: str, definition: str) -> Codec:
    return Codec(
        name,
        SchemaEncoding.ROS2,
        definition.encode(),
        "cdr",
        serialize_dynamic(name, definition)[name],
    )


def ros2idl(name: str, idl: str, msg_definition: str) -> Codec:
    return Codec(
        name,
        "ros2idl",
        idl.encode(),
        "cdr",
        serialize_dynamic(name, msg_definition)[name],
    )


def ros2_time(microseconds: int) -> dict[str, int]:
    return {
        "sec": microseconds // 1_000_000,
        "nanosec": microseconds % 1_000_000 * 1000,
    }


# --- ROS 1 ------------------------------------------------------------------------------------

ROS1_HEADER = f"""
{SEPARATOR}
MSG: std_msgs/Header
uint32 seq
time stamp
string frame_id"""

COMPRESSED_IMAGE_ROS1 = "Header header\nstring format\nuint8[] data" + ROS1_HEADER

DIAGNOSTIC_ARRAY_ROS1 = (
    "Header header\nDiagnosticStatus[] status"
    + ROS1_HEADER
    + f"""
{SEPARATOR}
MSG: diagnostic_msgs/DiagnosticStatus
byte OK=0
byte WARN=1
byte ERROR=2
byte STALE=3
byte level
string name
string message
string hardware_id
KeyValue[] values
{SEPARATOR}
MSG: diagnostic_msgs/KeyValue
string key
string value"""
)


def ros1(name: str, definition: str) -> Codec:
    classes = generate_dynamic(name, definition)

    def build(type_name: str, value: dict) -> genpy.Message:
        cls = classes[type_name]
        args = {}
        for slot, slot_type in zip(cls.__slots__, cls._slot_types):
            base = slot_type.split("[")[0]
            v = value[slot]
            if base == "time":
                v = genpy.Time(v["sec"], v["nsec"])
            elif base in classes:
                v = (
                    [build(base, item) for item in v]
                    if "[" in slot_type
                    else build(base, v)
                )
            args[slot] = v
        return cls(**args)

    def encode(message: dict) -> bytes:
        buffer = io.BytesIO()
        build(name, message).serialize(buffer)
        return buffer.getvalue()

    return Codec(name, SchemaEncoding.ROS1, definition.encode(), "ros1", encode)


def ros1_time(microseconds: int) -> dict[str, int]:
    return {"sec": microseconds // 1_000_000, "nsec": microseconds % 1_000_000 * 1000}


# --- OMG IDL ----------------------------------------------------------------------------------


def omgidl_doubles(module: str, struct_name: str, fields: tuple[str, ...]) -> Codec:
    """A flat struct of doubles: XCDR1 little-endian header, then the doubles (8-byte aligned)."""
    idl = (
        f"module {module} {{\n  struct {struct_name} {{\n"
        + "".join(f"    double {f};\n" for f in fields)
        + "  };\n};\n"
    )
    layout = struct.Struct(f"<4s{len(fields)}d")
    return Codec(
        f"{module}::{struct_name}",
        "omgidl",
        idl.encode(),
        "cdr",
        lambda m: layout.pack(b"\x00\x01\x00\x00", *(m[f] for f in fields)),
    )


# --- FlatBuffers ------------------------------------------------------------------------------


def flatbuffer_location_fix() -> Codec:
    table = fb_location_fix_table

    def encode(m: dict) -> bytes:
        builder = flatbuffers.Builder(256)
        frame_id = builder.CreateString(m["frame_id"])
        table.StartPositionCovarianceVector(builder, len(m["position_covariance"]))
        for value in reversed(m["position_covariance"]):
            builder.PrependFloat64(value)
        covariance = builder.EndVector()
        table.Start(builder)
        table.AddTimestamp(
            builder,
            fb_time.CreateTime(builder, m["timestamp"]["sec"], m["timestamp"]["nsec"]),
        )
        table.AddFrameId(builder, frame_id)
        table.AddLatitude(builder, m["latitude"])
        table.AddLongitude(builder, m["longitude"])
        table.AddAltitude(builder, m["altitude"])
        table.AddPositionCovariance(builder, covariance)
        table.AddPositionCovarianceType(builder, m["position_covariance_type"])
        builder.Finish(table.End(builder))
        return bytes(builder.Output())

    return Codec(
        "foxglove.LocationFix",
        "flatbuffer",
        flatbuffer_schema("LocationFix"),
        "flatbuffer",
        encode,
    )


# --- Cap'n Proto ------------------------------------------------------------------------------

IMU_CAPNP = """@0xd1c4f5a3b2e19f07;

# One GNSS/INS sample: body rates, attitude and velocity.
struct Imu {
  timestamp @0 :Time;
  angularVelocity @1 :Vector3;  # rad/s, vehicle frame
  roll @2 :Float64;             # degrees
  pitch @3 :Float64;            # degrees
  heading @4 :Float64;          # degrees, clockwise from north
  velocityEnu @5 :Vector3;      # m/s, east, north, up

  struct Time {
    sec @0 :UInt32;
    nsec @1 :UInt32;
  }

  struct Vector3 {
    x @0 :Float64;
    y @1 :Float64;
    z @2 :Float64;
  }
}
"""


def capnproto_imu() -> Codec:
    """The schema record is a CodeGeneratorRequest holding the root struct and its dependencies."""
    directory = Path(tempfile.mkdtemp())
    (directory / "boreas_imu.capnp").write_text(IMU_CAPNP)
    module = capnp.load(str(directory / "boreas_imu.capnp"))
    package = os.path.dirname(capnp.__file__)
    schema_capnp = capnp.load(
        os.path.join(package, "schema.capnp"), imports=[os.path.dirname(package)]
    )
    nodes = {}

    def add_struct(schema) -> None:
        node = schema.node
        if node.id in nodes:
            return
        nodes[node.id] = node
        for f in node.struct.fields:
            if f.slot.type.which() == "struct":
                add_struct(schema.fields[f.name].schema)

    add_struct(module.Imu.schema)
    request = schema_capnp.CodeGeneratorRequest.new_message()
    entries = request.init("nodes", len(nodes))
    for i, node in enumerate(nodes.values()):
        with schema_capnp.Node.from_bytes(node.as_builder().to_bytes()) as reader:
            entries[i] = reader
    return Codec(
        module.Imu.schema.node.displayName,
        "capnproto",
        request.to_bytes(),
        "capnproto",
        lambda m: module.Imu.new_message(**m).to_bytes(),
    )


# --- Self-describing --------------------------------------------------------------------------


def json_codec(name: str, schema: dict | None) -> Codec:
    return Codec(
        name if schema is not None else "",
        SchemaEncoding.JSONSchema if schema is not None else "",
        json.dumps(schema).encode() if schema is not None else b"",
        "json",
        lambda m: json.dumps(m, separators=(",", ":"), allow_nan=False).encode(),
    )


def cbor_codec(name: str, schema: dict) -> Codec:
    return Codec(
        name,
        SchemaEncoding.JSONSchema,
        json.dumps(schema).encode(),
        "cbor",
        cbor2.dumps,
    )


def msgpack_codec() -> Codec:
    return Codec("", "", b"", "msgpack", msgpack.packb)


def raw_codec(schema: Schema, message_encoding: str) -> Codec:
    """Messages already encoded elsewhere (e.g. by the Cloudini converter), passed through."""
    return Codec(schema.name, schema.encoding, schema.data, message_encoding, bytes)


# --- Expectations -----------------------------------------------------------------------------


def sample_fields(value: dict, prefix: str = "") -> dict[str, str | int | float | bool]:
    """A few scalar leaves of a message, as message paths, for checking what a reader decodes.

    Timestamps are left out: their layout differs between encodings (sec/nsec, sec/nanosec).
    """
    out: dict[str, str | int | float | bool] = {}
    for key, v in value.items():
        path = prefix + key
        if key in ("stamp", "timestamp") or len(out) >= 6:
            continue
        if (
            isinstance(v, (bool, int))
            or (isinstance(v, str) and len(v) <= 64)
            or isinstance(v, float)
            and math.isfinite(v)
        ):
            out[path] = v
        elif isinstance(v, dict):
            out.update(sample_fields(v, path + "."))
        elif isinstance(v, list) and v and isinstance(v[0], dict):
            out.update(sample_fields(v[0], f"{path}[0]."))
        elif isinstance(v, list) and v and isinstance(v[0], (int, float)):
            out[f"{path}[0]"] = v[0]
    return out


@dataclass
class ChannelFacts:
    count: int = 0
    unchunked: int = 0
    first_log_time: int = 0
    last_log_time: int = 0
    first_sha256: str = ""
    fields: dict[str, str | int | float | bool] = field(default_factory=dict)


# --- Container --------------------------------------------------------------------------------


@dataclass
class Group:
    """One chunk stream: topics in a group share chunks, groups never do."""

    compression: str  # "", "lz4" or "zstd"
    max_bytes: int  # 0 flushes after every message
    message_index: bool = True
    crc: bool = True
    reverse_first_chunk: bool = False  # store the first chunk's messages newest first
    messages: list[Message] = field(default_factory=list)
    size: int = 0


def record_bytes(record) -> bytes:
    builder = RecordBuilder()
    record.write(builder)
    return builder.end()


class ContainerWriter:
    def __init__(self, stream: BinaryIO, library: str, groups: dict[str, Group]):
        self.stream = stream
        self.groups = groups
        self.data_crc = 0
        self.schemas: dict[int, Schema] = {}
        self.channels: dict[int, Channel] = {}
        self.chunk_indexes: list[ChunkIndex] = []
        self.attachment_indexes: list[AttachmentIndex] = []
        self.metadata_indexes: list[MetadataIndex] = []
        self.counts: dict[int, int] = defaultdict(int)
        self.facts: dict[int, ChannelFacts] = defaultdict(ChannelFacts)
        self.compressions: set[str] = set()
        self.without_crc = 0
        self.without_message_index = 0
        self.out_of_order = 0
        self.start_time: int | None = None
        self.end_time = 0
        self.unchunked = 0
        self.empty_chunks = 0
        self._write(MAGIC)
        self._record(Header(profile="", library=library))

    def _write(self, data: bytes) -> None:
        self.stream.write(data)
        self.data_crc = zlib.crc32(data, self.data_crc)

    def _record(self, record) -> tuple[int, int]:
        data = record_bytes(record)
        offset = self.stream.tell()
        self._write(data)
        return offset, len(data)

    def add_schema(self, name: str, encoding: str, data: bytes) -> int:
        if not encoding:
            return 0
        schema = Schema(
            id=len(self.schemas) + 1, name=name, encoding=encoding, data=data
        )
        self.schemas[schema.id] = schema
        # Outside chunks, so a streaming reader has it before any chunk that needs it.
        self._record(schema)
        return schema.id

    def add_channel(
        self,
        topic: str,
        message_encoding: str,
        schema_id: int,
        metadata: dict[str, str],
    ) -> int:
        channel = Channel(
            id=len(self.channels) + 1,
            topic=topic,
            message_encoding=message_encoding,
            schema_id=schema_id,
            metadata=metadata,
        )
        self.channels[channel.id] = channel
        self._record(channel)
        return channel.id

    def _count(self, message: Message, source: dict | None) -> None:
        self.counts[message.channel_id] += 1
        facts = self.facts[message.channel_id]
        if facts.count == 0:
            facts.first_log_time = message.log_time
            facts.first_sha256 = hashlib.sha256(message.data).hexdigest()
            facts.fields = sample_fields(source) if source else {}
        facts.count += 1
        facts.last_log_time = max(facts.last_log_time, message.log_time)
        self.start_time = (
            message.log_time
            if self.start_time is None
            else min(self.start_time, message.log_time)
        )
        self.end_time = max(self.end_time, message.log_time)

    def add_message(
        self, group: str, message: Message, source: dict | None = None
    ) -> None:
        """`source` is the message as a dict, sampled into the expectations."""
        self._count(message, source)
        g = self.groups[group]
        g.messages.append(message)
        g.size += len(message.data) + 31
        if g.size >= g.max_bytes:
            self.flush(group)

    def add_unchunked_message(
        self, message: Message, source: dict | None = None
    ) -> None:
        self._count(message, source)
        self.facts[message.channel_id].unchunked += 1
        self._record(message)
        self.unchunked += 1

    def add_empty_chunk(self) -> None:
        # Zero times, as stock writers give empty chunks (readers reject anything else).
        self._write_chunk(Group("", 0), [], 0)
        self.empty_chunks += 1

    def flush(self, group: str) -> None:
        g = self.groups[group]
        if not g.messages:
            return
        messages = g.messages
        if g.reverse_first_chunk:
            messages = messages[::-1]
            g.reverse_first_chunk = False
            self.out_of_order += len(messages) > 1
        self._write_chunk(g, messages, messages[0].log_time)
        g.messages, g.size = [], 0

    def _write_chunk(self, g: Group, messages: list[Message], time: int) -> None:
        records = RecordBuilder()
        indexes: dict[int, MessageIndex] = {}
        for message in messages:
            indexes.setdefault(
                message.channel_id,
                MessageIndex(channel_id=message.channel_id, records=[]),
            ).records.append((message.log_time, records.count))
            message.write(records)
        data = records.end()
        compressed = {
            "": lambda d: d,
            "lz4": lz4.frame.compress,
            "zstd": zstandard.compress,
        }[g.compression](data)
        times = [m.log_time for m in messages] or [time]
        chunk = Chunk(
            message_start_time=min(times),
            message_end_time=max(times),
            uncompressed_size=len(data),
            uncompressed_crc=zlib.crc32(data) if g.crc else 0,
            compression=g.compression,
            data=compressed,
        )
        offset, length = self._record(chunk)
        self.compressions.add(g.compression)
        self.without_crc += not g.crc
        self.without_message_index += bool(messages) and not g.message_index
        index_start = self.stream.tell()
        offsets: dict[int, int] = {}
        if g.message_index:
            for channel_id, index in sorted(indexes.items()):
                # Readers binary-search message indexes, so they are sorted by time.
                index.records.sort()
                offsets[channel_id] = self._record(index)[0]
        self.chunk_indexes.append(
            ChunkIndex(
                message_start_time=chunk.message_start_time,
                message_end_time=chunk.message_end_time,
                chunk_start_offset=offset,
                chunk_length=length,
                message_index_offsets=offsets,
                message_index_length=self.stream.tell() - index_start,
                compression=g.compression,
                compressed_size=len(compressed),
                uncompressed_size=len(data),
            )
        )

    def add_attachment(
        self, time: int, name: str, media_type: str, data: bytes
    ) -> None:
        offset, length = self._record(
            Attachment(
                log_time=time,
                create_time=time,
                name=name,
                media_type=media_type,
                data=data,
            )
        )
        self.attachment_indexes.append(
            AttachmentIndex(
                offset=offset,
                length=length,
                log_time=time,
                create_time=time,
                data_size=len(data),
                name=name,
                media_type=media_type,
            )
        )

    def add_metadata(self, name: str, metadata: dict[str, str]) -> None:
        offset, length = self._record(Metadata(name=name, metadata=metadata))
        self.metadata_indexes.append(
            MetadataIndex(offset=offset, length=length, name=name)
        )

    def finish(self) -> None:
        for group in self.groups:
            self.flush(group)
        # The data section CRC covers everything before the DataEnd record.
        self.stream.write(record_bytes(DataEnd(data_section_crc=self.data_crc)))
        summary_start = self.stream.tell()
        summary = RecordBuilder()
        offsets: list[SummaryOffset] = []
        statistics = Statistics(
            message_count=sum(self.counts.values()),
            schema_count=len(self.schemas),
            channel_count=len(self.channels),
            attachment_count=len(self.attachment_indexes),
            metadata_count=len(self.metadata_indexes),
            chunk_count=len(self.chunk_indexes),
            message_start_time=self.start_time or 0,
            message_end_time=self.end_time,
            channel_message_counts=dict(self.counts),
        )
        for opcode, records in (
            (Opcode.SCHEMA, list(self.schemas.values())),
            (Opcode.CHANNEL, list(self.channels.values())),
            (Opcode.STATISTICS, [statistics]),
            (Opcode.CHUNK_INDEX, self.chunk_indexes),
            (Opcode.ATTACHMENT_INDEX, self.attachment_indexes),
            (Opcode.METADATA_INDEX, self.metadata_indexes),
        ):
            start = summary.count
            for record in records:
                record.write(summary)
            offsets.append(
                SummaryOffset(
                    group_opcode=opcode,
                    group_start=summary_start + start,
                    group_length=summary.count - start,
                )
            )
        summary_offset_start = summary_start + summary.count
        for offset in offsets:
            offset.write(summary)
        data = summary.end()
        # The footer is written by hand: its CRC covers the summary and its own prefix.
        footer_prefix = struct.pack(
            "<BQQQ", Opcode.FOOTER, 20, summary_start, summary_offset_start
        )
        self.stream.write(data)
        self.stream.write(footer_prefix)
        self.stream.write(
            struct.pack("<I", zlib.crc32(footer_prefix, zlib.crc32(data)))
        )
        self.stream.write(MAGIC)

    def expectations(self) -> dict:
        """What a reader must find in the file, per channel and for the container."""
        chunks = sorted(
            (
                c for c in self.chunk_indexes if c.message_end_time
            ),  # not the empty chunk
            key=lambda c: c.chunk_start_offset,
        )
        return {
            "container": {
                "chunk_count": len(self.chunk_indexes),
                "chunk_compressions": sorted(self.compressions),
                "chunks_without_crc": self.without_crc,
                "chunks_without_message_index": self.without_message_index,
                "empty_chunks": self.empty_chunks,
                "out_of_order_chunks": self.out_of_order,
                "overlapping_chunks": any(
                    b.message_start_time < a.message_end_time
                    for a, b in itertools.pairwise(chunks)
                ),
                "unchunked_messages": self.unchunked,
                "attachments": [a.name for a in self.attachment_indexes],
                "metadata": [m.name for m in self.metadata_indexes],
                "message_count": sum(self.counts.values()),
            },
            "channels": [
                {
                    "topic": channel.topic,
                    "schema_name": self.schemas[channel.schema_id].name
                    if channel.schema_id
                    else "",
                    "schema_encoding": self.schemas[channel.schema_id].encoding
                    if channel.schema_id
                    else "",
                    "message_encoding": channel.message_encoding,
                    "count": facts.count,
                    # Indexed readers only see messages inside chunks.
                    "indexed_count": facts.count - facts.unchunked,
                    "first_log_time": str(facts.first_log_time),
                    "last_log_time": str(facts.last_log_time),
                    "first_sha256": facts.first_sha256,
                    "fields": facts.fields,
                }
                for channel in self.channels.values()
                for facts in [self.facts[channel.id]]
            ],
        }

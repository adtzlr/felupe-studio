"""The frames of the messages of the app and its Python side (#240, ADR 0014), like
``app/src/worker/frames.ts``: a message without bytes is JSON text, a message with
bytes a binary frame. :func:`split` and :func:`restore` are the parts of a frame
without the binary layout: the JSON text of a message with ``{"$bytes": i}`` in
place of its i-th buffer, and the buffers. The local runtime sends frames over its
WebSocket, the Pyodide worker gets the parts
(:func:`felupe_studio.requests.handle_frame`).
"""

import json
import struct

ALIGN = 8
"""The alignment of the header and the buffers of a binary frame, so that the app
views the arrays of 8-byte floats without a copy."""


def _pad(size):
    return -size % ALIGN


def _numbers(value):
    """A NumPy scalar as a plain number, for JSON."""
    if hasattr(value, "item"):
        return value.item()
    raise TypeError(f"{type(value).__name__} is not JSON serializable.")


def _replace(message):
    """The message with ``{"$bytes": i}`` in place of its i-th buffer, and the
    buffers."""
    buffers = []

    def replace(value):
        if isinstance(value, (bytes, bytearray, memoryview)):
            buffers.append(bytes(value))
            return {"$bytes": len(buffers) - 1}
        if isinstance(value, dict):
            return {key: replace(v) for key, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [replace(v) for v in value]
        return value

    return replace(message), buffers


def split(message):
    """Return the JSON text of a message with ``{"$bytes": i}`` in place of its i-th
    buffer, and the buffers: a frame without its binary layout.

    Examples
    --------
    >>> split({"type": "bytes", "id": 2, "data": b"abc"})
    ('{"type": "bytes", "id": 2, "data": {"$bytes": 0}}', [b'abc'])
    """
    message, buffers = _replace(message)
    return json.dumps(message, default=_numbers), buffers


def encode(message):
    """Encode a message as the text of a frame (JSON), or as the bytes of a binary
    frame if it has bytes.

    A binary frame is the length of its header (4 bytes, little-endian), the header
    (JSON, padded with spaces) and the buffers, each padded to 8 bytes. The header
    is ``{"message": ..., "buffers": [[offset, length], ...]}``: the message with
    ``{"$bytes": i}`` in place of the i-th buffer, the offsets from the start of the
    frame.

    Examples
    --------
    >>> encode({"type": "done", "id": 1})
    '{"type": "done", "id": 1}'
    >>> frame = encode({"type": "bytes", "id": 2, "data": b"abc"})
    >>> decode(frame)
    {'type': 'bytes', 'id': 2, 'data': b'abc'}
    """
    message, buffers = _replace(message)
    if not buffers:
        return json.dumps(message, default=_numbers)

    def header(offsets):
        text = json.dumps(
            {"message": message, "buffers": offsets}, default=_numbers
        ).encode()
        return text + b" " * _pad(4 + len(text))

    # the offsets depend on the length of the header, which depends on the offsets:
    # place the buffers after a header of the final length
    offsets = [[0, len(b)] for b in buffers]
    while True:
        start = 4 + len(header(offsets))
        new, position = [], start
        for buffer in buffers:
            new.append([position, len(buffer)])
            position += len(buffer) + _pad(len(buffer))
        if new == offsets:
            break
        offsets = new
    text = header(offsets)
    parts = [struct.pack("<I", len(text)), text]
    for buffer in buffers:
        parts += [buffer, b"\0" * _pad(len(buffer))]
    return b"".join(parts)


def decode(data):
    """Decode the text or the bytes of a frame into a message, see :func:`encode`."""
    if isinstance(data, str):
        return json.loads(data)
    data = bytes(data)
    (length,) = struct.unpack_from("<I", data)
    header = json.loads(data[4 : 4 + length])
    buffers = [data[offset : offset + size] for offset, size in header["buffers"]]
    return restore(header["message"], buffers)


def restore(message, buffers):
    """Put the buffers in place of their ``{"$bytes": i}`` in a message."""
    if isinstance(message, dict):
        if set(message) == {"$bytes"}:
            return buffers[message["$bytes"]]
        return {key: restore(value, buffers) for key, value in message.items()}
    if isinstance(message, list):
        return [restore(value, buffers) for value in message]
    return message

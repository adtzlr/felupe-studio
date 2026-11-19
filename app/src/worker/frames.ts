// The frames of the WebSocket of the local Python runtime (#240, ADR 0014), like
// `encode()` and `decode()` of felupe_studio.frames: a message without bytes is
// JSON text; with bytes a binary frame: the length of the header (4 bytes,
// little-endian), the header `{"message": …, "buffers": [[offset, length], …]}`
// with `{"$bytes": i}` in place of the i-th buffer (padded with spaces), then the
// buffers, each padded to 8 bytes, so that their arrays are views without a copy.

const ALIGN = 8;
const pad = (size: number) => (ALIGN - (size % ALIGN)) % ALIGN;

type Offsets = [number, number][];

/** A message as the text or the bytes of a frame. */
export function encodeFrame(message: unknown): string | ArrayBuffer {
  const buffers: Uint8Array[] = [];
  const replace = (value: unknown): unknown => {
    if (value instanceof ArrayBuffer) value = new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      buffers.push(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      );
      return { $bytes: buffers.length - 1 };
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [key, replace(v)]),
      );
    return value;
  };
  const replaced = replace(message);
  if (!buffers.length) return JSON.stringify(replaced);

  const encoder = new TextEncoder();
  const header = (offsets: Offsets) => {
    const text = encoder.encode(
      JSON.stringify({ message: replaced, buffers: offsets }),
    );
    const padded = new Uint8Array(text.length + pad(4 + text.length)).fill(32);
    padded.set(text);
    return padded;
  };
  // the offsets depend on the length of the header, which depends on the offsets
  let offsets: Offsets = buffers.map((b) => [0, b.length]);
  for (;;) {
    let position = 4 + header(offsets).length;
    const next: Offsets = buffers.map((b) => {
      const offset: [number, number] = [position, b.length];
      position += b.length + pad(b.length);
      return offset;
    });
    if (JSON.stringify(next) === JSON.stringify(offsets)) break;
    offsets = next;
  }
  const text = header(offsets);
  const last = offsets[offsets.length - 1];
  const frame = new Uint8Array(last[0] + last[1] + pad(last[1]));
  new DataView(frame.buffer).setUint32(0, text.length, true);
  frame.set(text, 4);
  buffers.forEach((b, i) => frame.set(b, offsets[i][0]));
  return frame.buffer;
}

/** The message of the text or the bytes of a frame, its bytes as Uint8Array views. */
export function decodeFrame(data: string | ArrayBuffer): unknown {
  if (typeof data === "string") return JSON.parse(data);
  const length = new DataView(data).getUint32(0, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(data, 4, length)),
  ) as { message: unknown; buffers: Offsets };
  const buffers = header.buffers.map(
    ([offset, size]) => new Uint8Array(data, offset, size),
  );
  return restore(header.message, buffers);
}

/**
 * Put the buffers in place of their `{"$bytes": i}` in a message, like `restore()`
 * of felupe_studio.frames: a frame of its JSON text and its buffers.
 */
export function restore(
  message: unknown,
  buffers: readonly Uint8Array[],
): unknown {
  const replace = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") {
      const keys = Object.keys(value);
      if (keys.length === 1 && keys[0] === "$bytes")
        return buffers[(value as { $bytes: number }).$bytes];
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [key, replace(v)]),
      );
    }
    return value;
  };
  return replace(message);
}

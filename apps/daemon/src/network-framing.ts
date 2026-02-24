export interface FrameReadResult {
  frame: Buffer | null;
  rest: Buffer;
  needsMore: boolean;
  invalidLength?: number;
}

export function encodeLengthPrefixedFrame(payload: Buffer, maxFrameBytes: number): Buffer {
  if (payload.length > maxFrameBytes) {
    throw new Error(`Encoded payload too large (${payload.length} > ${maxFrameBytes})`);
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export function readLengthPrefixedFrame(buffer: Buffer, maxFrameBytes: number): FrameReadResult {
  if (buffer.length < 4) {
    return { frame: null, rest: buffer, needsMore: true };
  }

  const frameLen = buffer.readUInt32BE(0);
  if (frameLen <= 0 || frameLen > maxFrameBytes) {
    return { frame: null, rest: Buffer.alloc(0), needsMore: false, invalidLength: frameLen };
  }

  const totalLen = 4 + frameLen;
  if (buffer.length < totalLen) {
    return { frame: null, rest: buffer, needsMore: true };
  }

  return {
    frame: buffer.subarray(4, totalLen),
    rest: buffer.subarray(totalLen),
    needsMore: false,
  };
}

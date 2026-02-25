// nokk binary frame encoder/decoder
// Frame format:
//   u16  magic       = 0x4E4B ("NK")
//   u8   version     = 1
//   u8   type        (message type)
//   u32  sessionIdLen
//   u8[] sessionId   (UTF-8)
//   u32  payloadLen
//   u8[] payload
//
// All multi-byte integers are LITTLE-ENDIAN.

import {
  NokkMessageType,
  NokkFrame,
  OutputPayload,
  SnapshotPayload,
  ResumePayload,
  ResumeSession,
} from './types';

const MAGIC = 0x4e4b; // "NK"
const VERSION = 1;
const HEADER_SIZE = 2 + 1 + 1 + 4; // magic(2) + version(1) + type(1) + sessionIdLen(4)

export function encodeFrame(frame: NokkFrame): Buffer {
  const sessionIdBuf = Buffer.from(frame.sessionId, 'utf-8');
  const totalLen =
    HEADER_SIZE + sessionIdBuf.length + 4 + frame.payload.length;
  const buf = Buffer.alloc(totalLen);
  let offset = 0;

  buf.writeUInt16LE(MAGIC, offset);
  offset += 2;
  buf.writeUInt8(VERSION, offset);
  offset += 1;
  buf.writeUInt8(frame.type, offset);
  offset += 1;
  buf.writeUInt32LE(sessionIdBuf.length, offset);
  offset += 4;
  sessionIdBuf.copy(buf, offset);
  offset += sessionIdBuf.length;
  buf.writeUInt32LE(frame.payload.length, offset);
  offset += 4;
  frame.payload.copy(buf, offset);

  return buf;
}

export function decodeFrame(data: Buffer): NokkFrame {
  if (data.length < HEADER_SIZE) {
    throw new Error(`Frame too short: ${data.length} bytes`);
  }

  let offset = 0;

  const magic = data.readUInt16LE(offset);
  offset += 2;
  if (magic !== MAGIC) {
    throw new Error(
      `Invalid magic: 0x${magic.toString(16)}, expected 0x${MAGIC.toString(16)}`
    );
  }

  const version = data.readUInt8(offset);
  offset += 1;
  if (version !== VERSION) {
    throw new Error(`Unsupported version: ${version}`);
  }

  const type = data.readUInt8(offset) as NokkMessageType;
  offset += 1;

  const sessionIdLen = data.readUInt32LE(offset);
  offset += 4;

  if (data.length < offset + sessionIdLen + 4) {
    throw new Error('Frame truncated at sessionId');
  }

  const sessionId = data.subarray(offset, offset + sessionIdLen).toString('utf-8');
  offset += sessionIdLen;

  const payloadLen = data.readUInt32LE(offset);
  offset += 4;

  if (data.length < offset + payloadLen) {
    throw new Error('Frame truncated at payload');
  }

  const payload = Buffer.from(data.subarray(offset, offset + payloadLen));

  return { type, sessionId, payload };
}

// --- Payload encode/decode helpers ---

export function encodeOutputPayload(seq: bigint, data: Buffer): Buffer {
  const buf = Buffer.alloc(8 + data.length);
  buf.writeBigUInt64LE(seq, 0);
  data.copy(buf, 8);
  return buf;
}

export function decodeOutputPayload(payload: Buffer): OutputPayload {
  if (payload.length < 8) {
    throw new Error('OUTPUT payload too short');
  }
  const seq = payload.readBigUInt64LE(0);
  const data = Buffer.from(payload.subarray(8));
  return { seq, data };
}

export function encodeSnapshotPayload(
  seq: bigint,
  cols: number,
  rows: number,
  text: Buffer
): Buffer {
  const buf = Buffer.alloc(8 + 4 + 4 + text.length);
  buf.writeBigUInt64LE(seq, 0);
  buf.writeUInt32LE(cols, 8);
  buf.writeUInt32LE(rows, 12);
  text.copy(buf, 16);
  return buf;
}

export function decodeSnapshotPayload(payload: Buffer): SnapshotPayload {
  if (payload.length < 16) {
    throw new Error('SNAPSHOT payload too short');
  }
  const seq = payload.readBigUInt64LE(0);
  const cols = payload.readUInt32LE(8);
  const rows = payload.readUInt32LE(12);
  const text = Buffer.from(payload.subarray(16));
  return { seq, cols, rows, text };
}

export function encodeSubscribePayload(flags: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(flags, 0);
  return buf;
}

export function decodeSubscribePayload(payload: Buffer): { flags: number } {
  if (payload.length < 4) {
    throw new Error('SUBSCRIBE payload too short');
  }
  const flags = payload.readUInt32LE(0);
  return { flags };
}

export function encodeResumePayload(sessions: ResumeSession[]): Buffer {
  let totalLen = 4; // numSessions u32
  for (const s of sessions) {
    const idBuf = Buffer.from(s.sessionId, 'utf-8');
    totalLen += 4 + idBuf.length + 8 + 4; // idLen + id + lastSeq + flags
  }

  const buf = Buffer.alloc(totalLen);
  let offset = 0;

  buf.writeUInt32LE(sessions.length, offset);
  offset += 4;

  for (const s of sessions) {
    const idBuf = Buffer.from(s.sessionId, 'utf-8');
    buf.writeUInt32LE(idBuf.length, offset);
    offset += 4;
    idBuf.copy(buf, offset);
    offset += idBuf.length;
    buf.writeBigUInt64LE(s.lastSeq, offset);
    offset += 8;
    buf.writeUInt32LE(s.flags, offset);
    offset += 4;
  }

  return buf;
}

export function decodeResumePayload(payload: Buffer): ResumePayload {
  if (payload.length < 4) {
    throw new Error('RESUME payload too short');
  }

  let offset = 0;
  const numSessions = payload.readUInt32LE(offset);
  offset += 4;

  const sessions: ResumeSession[] = [];
  for (let i = 0; i < numSessions; i++) {
    if (payload.length < offset + 4) {
      throw new Error('RESUME payload truncated at session id length');
    }
    const idLen = payload.readUInt32LE(offset);
    offset += 4;

    if (payload.length < offset + idLen + 8 + 4) {
      throw new Error('RESUME payload truncated at session entry');
    }
    const sessionId = payload.subarray(offset, offset + idLen).toString('utf-8');
    offset += idLen;

    const lastSeq = payload.readBigUInt64LE(offset);
    offset += 8;

    const flags = payload.readUInt32LE(offset);
    offset += 4;

    sessions.push({ sessionId, lastSeq, flags });
  }

  return { sessions };
}

import { describe, it, expect } from 'vitest';
import {
  encodeFrame,
  decodeFrame,
  encodeOutputPayload,
  decodeOutputPayload,
  encodeSnapshotPayload,
  decodeSnapshotPayload,
  encodeSubscribePayload,
  decodeSubscribePayload,
  encodeResumePayload,
  decodeResumePayload,
} from '../src/protocol/frames';
import { NokkMessageType, NokkFrame } from '../src/protocol/types';

describe('Frame encode/decode', () => {
  it('should roundtrip a simple frame', () => {
    const frame: NokkFrame = {
      type: NokkMessageType.PING,
      sessionId: '',
      payload: Buffer.alloc(0),
    };
    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);
    expect(decoded.type).toBe(NokkMessageType.PING);
    expect(decoded.sessionId).toBe('');
    expect(decoded.payload.length).toBe(0);
  });

  it('should roundtrip a frame with sessionId and payload', () => {
    const payload = Buffer.from('hello world');
    const frame: NokkFrame = {
      type: NokkMessageType.OUTPUT,
      sessionId: 'test-session-123',
      payload,
    };
    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);
    expect(decoded.type).toBe(NokkMessageType.OUTPUT);
    expect(decoded.sessionId).toBe('test-session-123');
    expect(decoded.payload.toString()).toBe('hello world');
  });

  it('should roundtrip a frame with UTF-8 sessionId', () => {
    const frame: NokkFrame = {
      type: NokkMessageType.SUBSCRIBE,
      sessionId: 'session-ñ-日本語',
      payload: Buffer.from([1, 2, 3, 4]),
    };
    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);
    expect(decoded.sessionId).toBe('session-ñ-日本語');
  });

  it('should encode correct magic bytes in LE', () => {
    const frame: NokkFrame = {
      type: NokkMessageType.PING,
      sessionId: '',
      payload: Buffer.alloc(0),
    };
    const encoded = encodeFrame(frame);
    expect(encoded.readUInt16LE(0)).toBe(0x4e4b); // "NK" in LE
    expect(encoded.readUInt8(2)).toBe(1); // version
  });

  it('should roundtrip a frame with large sessionId', () => {
    const longId = 'a'.repeat(1024);
    const frame: NokkFrame = {
      type: NokkMessageType.INPUT,
      sessionId: longId,
      payload: Buffer.from('data'),
    };
    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);
    expect(decoded.sessionId).toBe(longId);
    expect(decoded.payload.toString()).toBe('data');
  });

  it('should roundtrip a frame with binary payload', () => {
    const binaryData = Buffer.from([0x00, 0xff, 0x80, 0x7f, 0x01, 0xfe]);
    const frame: NokkFrame = {
      type: NokkMessageType.OUTPUT,
      sessionId: 'bin-test',
      payload: binaryData,
    };
    const encoded = encodeFrame(frame);
    const decoded = decodeFrame(encoded);
    expect(Buffer.compare(decoded.payload, binaryData)).toBe(0);
  });

  it('should reject invalid magic', () => {
    const buf = Buffer.alloc(12);
    buf.writeUInt16LE(0xdead, 0);
    expect(() => decodeFrame(buf)).toThrow('Invalid magic');
  });

  it('should reject unsupported version', () => {
    const buf = Buffer.alloc(12);
    buf.writeUInt16LE(0x4e4b, 0);
    buf.writeUInt8(99, 2);
    expect(() => decodeFrame(buf)).toThrow('Unsupported version');
  });

  it('should reject truncated frame', () => {
    const buf = Buffer.alloc(4);
    expect(() => decodeFrame(buf)).toThrow('Frame too short');
  });
});

describe('OUTPUT payload encode/decode', () => {
  it('should roundtrip seq + data', () => {
    const seq = 42n;
    const data = Buffer.from('output data');
    const payload = encodeOutputPayload(seq, data);
    const decoded = decodeOutputPayload(payload);
    expect(decoded.seq).toBe(42n);
    expect(decoded.data.toString()).toBe('output data');
  });

  it('should handle large seq numbers', () => {
    const seq = 0xffffffffffffffffn;
    const data = Buffer.from('x');
    const payload = encodeOutputPayload(seq, data);
    const decoded = decodeOutputPayload(payload);
    expect(decoded.seq).toBe(seq);
  });

  it('should handle empty data', () => {
    const payload = encodeOutputPayload(1n, Buffer.alloc(0));
    const decoded = decodeOutputPayload(payload);
    expect(decoded.seq).toBe(1n);
    expect(decoded.data.length).toBe(0);
  });
});

describe('SNAPSHOT payload encode/decode', () => {
  it('should roundtrip seq + cols + rows + text', () => {
    const text = Buffer.from('$ ls\nfile1\nfile2\n');
    const payload = encodeSnapshotPayload(100n, 80, 24, text);
    const decoded = decodeSnapshotPayload(payload);
    expect(decoded.seq).toBe(100n);
    expect(decoded.cols).toBe(80);
    expect(decoded.rows).toBe(24);
    expect(decoded.text.toString()).toBe('$ ls\nfile1\nfile2\n');
  });

  it('should handle empty text', () => {
    const payload = encodeSnapshotPayload(0n, 120, 40, Buffer.alloc(0));
    const decoded = decodeSnapshotPayload(payload);
    expect(decoded.cols).toBe(120);
    expect(decoded.rows).toBe(40);
    expect(decoded.text.length).toBe(0);
  });

});

describe('SUBSCRIBE payload encode/decode', () => {
  it('should roundtrip flags', () => {
    const payload = encodeSubscribePayload(0);
    const decoded = decodeSubscribePayload(payload);
    expect(decoded.flags).toBe(0);
  });

  it('should handle non-zero flags', () => {
    const payload = encodeSubscribePayload(0x0f);
    const decoded = decodeSubscribePayload(payload);
    expect(decoded.flags).toBe(0x0f);
  });
});

describe('RESUME payload encode/decode', () => {
  it('should roundtrip multiple sessions', () => {
    const sessions = [
      { sessionId: 'pane-0', lastSeq: 500n, flags: 0 },
      { sessionId: 'pane-1', lastSeq: 1200n, flags: 1 },
    ];
    const payload = encodeResumePayload(sessions);
    const decoded = decodeResumePayload(payload);
    expect(decoded.sessions).toHaveLength(2);
    expect(decoded.sessions[0].sessionId).toBe('pane-0');
    expect(decoded.sessions[0].lastSeq).toBe(500n);
    expect(decoded.sessions[0].flags).toBe(0);
    expect(decoded.sessions[1].sessionId).toBe('pane-1');
    expect(decoded.sessions[1].lastSeq).toBe(1200n);
    expect(decoded.sessions[1].flags).toBe(1);
  });

  it('should roundtrip empty session list', () => {
    const payload = encodeResumePayload([]);
    const decoded = decodeResumePayload(payload);
    expect(decoded.sessions).toHaveLength(0);
  });

  it('should roundtrip single session', () => {
    const sessions = [{ sessionId: 'main', lastSeq: 0n, flags: 0 }];
    const payload = encodeResumePayload(sessions);
    const decoded = decodeResumePayload(payload);
    expect(decoded.sessions).toHaveLength(1);
    expect(decoded.sessions[0].sessionId).toBe('main');
  });
});

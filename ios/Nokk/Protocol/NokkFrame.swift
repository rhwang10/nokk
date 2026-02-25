// nokk binary frame encoder/decoder (Swift)
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

import Foundation

enum NokkFrameError: Error, Equatable {
    case frameTooShort
    case invalidMagic
    case unsupportedVersion
    case truncated
    case payloadTooShort
}

struct NokkFrameCoder {
    static let magic: UInt16 = 0x4E4B  // "NK"
    static let version: UInt8 = 1

    // MARK: - Frame encode/decode

    static func encode(_ frame: NokkFrame) -> Data {
        let sessionIdData = frame.sessionId.data(using: .utf8) ?? Data()
        var data = Data()

        // magic (little-endian u16)
        appendUInt16LE(&data, magic)
        // version
        data.append(version)
        // type
        data.append(frame.type.rawValue)
        // sessionIdLen (little-endian u32)
        appendUInt32LE(&data, UInt32(sessionIdData.count))
        // sessionId
        data.append(sessionIdData)
        // payloadLen (little-endian u32)
        appendUInt32LE(&data, UInt32(frame.payload.count))
        // payload
        data.append(frame.payload)

        return data
    }

    static func decode(_ data: Data) throws -> NokkFrame {
        guard data.count >= 8 else { throw NokkFrameError.frameTooShort }

        var offset = 0

        let magicValue = readUInt16LE(data, offset: &offset)
        guard magicValue == magic else { throw NokkFrameError.invalidMagic }

        let ver = data[offset]; offset += 1
        guard ver == version else { throw NokkFrameError.unsupportedVersion }

        guard let msgType = NokkMessageType(rawValue: data[offset]) else {
            throw NokkFrameError.invalidMagic
        }
        offset += 1

        let sessionIdLen = Int(readUInt32LE(data, offset: &offset))
        guard data.count >= offset + sessionIdLen + 4 else {
            throw NokkFrameError.truncated
        }

        let sessionIdData = data[offset..<(offset + sessionIdLen)]
        let sessionId = String(data: sessionIdData, encoding: .utf8) ?? ""
        offset += sessionIdLen

        let payloadLen = Int(readUInt32LE(data, offset: &offset))
        guard data.count >= offset + payloadLen else {
            throw NokkFrameError.truncated
        }

        let payload = Data(data[offset..<(offset + payloadLen)])
        return NokkFrame(type: msgType, sessionId: sessionId, payload: payload)
    }

    // MARK: - OUTPUT payload

    static func encodeOutputPayload(seq: UInt64, data: Data) -> Data {
        var buf = Data()
        appendUInt64LE(&buf, seq)
        buf.append(data)
        return buf
    }

    static func decodeOutputPayload(_ payload: Data) throws -> OutputPayload {
        guard payload.count >= 8 else { throw NokkFrameError.payloadTooShort }
        var offset = 0
        let seq = readUInt64LE(payload, offset: &offset)
        let data = Data(payload[offset...])
        return OutputPayload(seq: seq, data: data)
    }

    // MARK: - SNAPSHOT payload

    static func encodeSnapshotPayload(seq: UInt64, cols: UInt32, rows: UInt32, text: Data) -> Data {
        var buf = Data()
        appendUInt64LE(&buf, seq)
        appendUInt32LE(&buf, cols)
        appendUInt32LE(&buf, rows)
        buf.append(text)
        return buf
    }

    static func decodeSnapshotPayload(_ payload: Data) throws -> SnapshotPayload {
        guard payload.count >= 16 else { throw NokkFrameError.payloadTooShort }
        var offset = 0
        let seq = readUInt64LE(payload, offset: &offset)
        let cols = readUInt32LE(payload, offset: &offset)
        let rows = readUInt32LE(payload, offset: &offset)
        let text = Data(payload[offset...])
        return SnapshotPayload(seq: seq, cols: cols, rows: rows, text: text)
    }

    // MARK: - SUBSCRIBE payload

    static func encodeSubscribePayload(flags: UInt32) -> Data {
        var buf = Data()
        appendUInt32LE(&buf, flags)
        return buf
    }

    static func decodeSubscribePayload(_ payload: Data) throws -> UInt32 {
        guard payload.count >= 4 else { throw NokkFrameError.payloadTooShort }
        var offset = 0
        return readUInt32LE(payload, offset: &offset)
    }

    // MARK: - RESUME payload

    static func encodeResumePayload(_ sessions: [ResumeSession]) -> Data {
        var buf = Data()
        appendUInt32LE(&buf, UInt32(sessions.count))
        for s in sessions {
            let idData = s.sessionId.data(using: .utf8) ?? Data()
            appendUInt32LE(&buf, UInt32(idData.count))
            buf.append(idData)
            appendUInt64LE(&buf, s.lastSeq)
            appendUInt32LE(&buf, s.flags)
        }
        return buf
    }

    static func decodeResumePayload(_ payload: Data) throws -> ResumePayload {
        guard payload.count >= 4 else { throw NokkFrameError.payloadTooShort }
        var offset = 0
        let numSessions = Int(readUInt32LE(payload, offset: &offset))
        var sessions: [ResumeSession] = []
        for _ in 0..<numSessions {
            guard payload.count >= offset + 4 else { throw NokkFrameError.truncated }
            let idLen = Int(readUInt32LE(payload, offset: &offset))
            guard payload.count >= offset + idLen + 12 else { throw NokkFrameError.truncated }
            let idData = payload[offset..<(offset + idLen)]
            let sessionId = String(data: idData, encoding: .utf8) ?? ""
            offset += idLen
            let lastSeq = readUInt64LE(payload, offset: &offset)
            let flags = readUInt32LE(payload, offset: &offset)
            sessions.append(ResumeSession(sessionId: sessionId, lastSeq: lastSeq, flags: flags))
        }
        return ResumePayload(sessions: sessions)
    }

    // MARK: - Little-endian binary helpers

    private static func appendUInt16LE(_ data: inout Data, _ value: UInt16) {
        data.append(UInt8(value & 0xFF))
        data.append(UInt8(value >> 8))
    }

    private static func appendUInt32LE(_ data: inout Data, _ value: UInt32) {
        data.append(UInt8(value & 0xFF))
        data.append(UInt8((value >> 8) & 0xFF))
        data.append(UInt8((value >> 16) & 0xFF))
        data.append(UInt8((value >> 24) & 0xFF))
    }

    private static func appendUInt64LE(_ data: inout Data, _ value: UInt64) {
        data.append(UInt8(value & 0xFF))
        data.append(UInt8((value >> 8) & 0xFF))
        data.append(UInt8((value >> 16) & 0xFF))
        data.append(UInt8((value >> 24) & 0xFF))
        data.append(UInt8((value >> 32) & 0xFF))
        data.append(UInt8((value >> 40) & 0xFF))
        data.append(UInt8((value >> 48) & 0xFF))
        data.append(UInt8((value >> 56) & 0xFF))
    }

    private static func readUInt16LE(_ data: Data, offset: inout Int) -> UInt16 {
        let value = UInt16(data[offset]) | UInt16(data[offset + 1]) << 8
        offset += 2
        return value
    }

    private static func readUInt32LE(_ data: Data, offset: inout Int) -> UInt32 {
        let value = UInt32(data[offset])
            | UInt32(data[offset + 1]) << 8
            | UInt32(data[offset + 2]) << 16
            | UInt32(data[offset + 3]) << 24
        offset += 4
        return value
    }

    private static func readUInt64LE(_ data: Data, offset: inout Int) -> UInt64 {
        let value = UInt64(data[offset])
            | UInt64(data[offset + 1]) << 8
            | UInt64(data[offset + 2]) << 16
            | UInt64(data[offset + 3]) << 24
            | UInt64(data[offset + 4]) << 32
            | UInt64(data[offset + 5]) << 40
            | UInt64(data[offset + 6]) << 48
            | UInt64(data[offset + 7]) << 56
        offset += 8
        return value
    }
}

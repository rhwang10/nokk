// Tests for NokkFrameCoder encode/decode

import XCTest
@testable import Nokk

final class NokkFrameTests: XCTestCase {

    func testRoundtripSimpleFrame() throws {
        let frame = NokkFrame(type: .ping, sessionId: "", payload: Data())
        let encoded = NokkFrameCoder.encode(frame)
        let decoded = try NokkFrameCoder.decode(encoded)
        XCTAssertEqual(decoded.type, .ping)
        XCTAssertEqual(decoded.sessionId, "")
        XCTAssertEqual(decoded.payload.count, 0)
    }

    func testRoundtripFrameWithPayload() throws {
        let payload = "hello world".data(using: .utf8)!
        let frame = NokkFrame(type: .output, sessionId: "test-session", payload: payload)
        let encoded = NokkFrameCoder.encode(frame)
        let decoded = try NokkFrameCoder.decode(encoded)
        XCTAssertEqual(decoded.type, .output)
        XCTAssertEqual(decoded.sessionId, "test-session")
        XCTAssertEqual(String(data: decoded.payload, encoding: .utf8), "hello world")
    }

    func testMagicBytes() throws {
        let frame = NokkFrame(type: .ping, sessionId: "", payload: Data())
        let encoded = NokkFrameCoder.encode(frame)
        // Check "NK" magic
        XCTAssertEqual(encoded[0], 0x4E)
        XCTAssertEqual(encoded[1], 0x4B)
        // Check version
        XCTAssertEqual(encoded[2], 1)
    }

    func testInvalidMagicThrows() {
        var data = Data(repeating: 0, count: 12)
        data[0] = 0xDE
        data[1] = 0xAD
        XCTAssertThrowsError(try NokkFrameCoder.decode(data)) { error in
            XCTAssertEqual(error as? NokkFrameError, .invalidMagic)
        }
    }

    func testTruncatedFrameThrows() {
        let data = Data(count: 4)
        XCTAssertThrowsError(try NokkFrameCoder.decode(data)) { error in
            XCTAssertEqual(error as? NokkFrameError, .frameTooShort)
        }
    }

    func testOutputPayloadRoundtrip() throws {
        let payload = NokkFrameCoder.encodeOutputPayload(seq: 42, data: "test".data(using: .utf8)!)
        let decoded = try NokkFrameCoder.decodeOutputPayload(payload)
        XCTAssertEqual(decoded.seq, 42)
        XCTAssertEqual(String(data: decoded.data, encoding: .utf8), "test")
    }

    func testSnapshotPayloadRoundtrip() throws {
        let text = "$ ls\nfile1\n".data(using: .utf8)!
        let payload = NokkFrameCoder.encodeSnapshotPayload(seq: 100, cols: 80, rows: 24, text: text)
        let decoded = try NokkFrameCoder.decodeSnapshotPayload(payload)
        XCTAssertEqual(decoded.seq, 100)
        XCTAssertEqual(decoded.cols, 80)
        XCTAssertEqual(decoded.rows, 24)
        XCTAssertEqual(String(data: decoded.text, encoding: .utf8), "$ ls\nfile1\n")
    }

    func testResumePayloadRoundtrip() throws {
        let sessions = [
            ResumeSession(sessionId: "pane-0", lastSeq: 500, flags: 0),
            ResumeSession(sessionId: "pane-1", lastSeq: 1200, flags: 1),
        ]
        let payload = NokkFrameCoder.encodeResumePayload(sessions)
        let decoded = try NokkFrameCoder.decodeResumePayload(payload)
        XCTAssertEqual(decoded.sessions.count, 2)
        XCTAssertEqual(decoded.sessions[0].sessionId, "pane-0")
        XCTAssertEqual(decoded.sessions[0].lastSeq, 500)
        XCTAssertEqual(decoded.sessions[1].sessionId, "pane-1")
        XCTAssertEqual(decoded.sessions[1].lastSeq, 1200)
    }

    func testResumePayloadEmpty() throws {
        let payload = NokkFrameCoder.encodeResumePayload([])
        let decoded = try NokkFrameCoder.decodeResumePayload(payload)
        XCTAssertEqual(decoded.sessions.count, 0)
    }
}

// Tests for InputBuffer

import XCTest
@testable import Nokk

final class InputBufferTests: XCTestCase {

    func testAddAndFlush() {
        let buffer = InputBuffer()
        buffer.add("hello".data(using: .utf8)!)
        buffer.add("world".data(using: .utf8)!)

        XCTAssertEqual(buffer.count, 2)
        XCTAssertFalse(buffer.isEmpty)

        let flushed = buffer.flush()
        XCTAssertEqual(flushed.count, 2)
        XCTAssertEqual(String(data: flushed[0], encoding: .utf8), "hello")
        XCTAssertEqual(String(data: flushed[1], encoding: .utf8), "world")

        // Buffer should be empty after flush
        XCTAssertTrue(buffer.isEmpty)
        XCTAssertEqual(buffer.count, 0)
    }

    func testEmptyFlush() {
        let buffer = InputBuffer()
        let flushed = buffer.flush()
        XCTAssertTrue(flushed.isEmpty)
    }

    func testClear() {
        let buffer = InputBuffer()
        buffer.add("test".data(using: .utf8)!)
        buffer.clear()
        XCTAssertTrue(buffer.isEmpty)
    }
}

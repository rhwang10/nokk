// Tests for ReconnectionManager three-tier behavior

import XCTest
@testable import Nokk

final class ReconnectionManagerTests: XCTestCase {

    @MainActor
    func testInitialState() {
        let monitor = NetworkMonitor()
        let manager = ReconnectionManager(networkMonitor: monitor)
        XCTAssertFalse(manager.state.isReconnecting)
        XCTAssertEqual(manager.state.tier, .instant)
        XCTAssertEqual(manager.state.attempt, 0)
    }

    @MainActor
    func testStartReconnectingSetsState() {
        let monitor = NetworkMonitor()
        let manager = ReconnectionManager(networkMonitor: monitor)

        // Connect immediately succeeds
        manager.startReconnecting { return true }

        // Give a moment for the task to run
        let expectation = XCTestExpectation(description: "reconnection completes")
        Task {
            try await Task.sleep(nanoseconds: 100_000_000) // 100ms
            XCTAssertFalse(manager.state.isReconnecting)
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1.0)
    }

    @MainActor
    func testStopCancelsReconnection() {
        let monitor = NetworkMonitor()
        let manager = ReconnectionManager(networkMonitor: monitor)

        manager.startReconnecting { return false }
        XCTAssertTrue(manager.state.isReconnecting)

        manager.stop()
        XCTAssertFalse(manager.state.isReconnecting)
    }

    @MainActor
    func testResetClearsState() {
        let monitor = NetworkMonitor()
        let manager = ReconnectionManager(networkMonitor: monitor)

        manager.startReconnecting { return false }
        manager.reset()

        XCTAssertFalse(manager.state.isReconnecting)
        XCTAssertEqual(manager.state.tier, .instant)
        XCTAssertEqual(manager.state.attempt, 0)
    }
}

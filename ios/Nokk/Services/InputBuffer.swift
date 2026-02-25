// Input buffer: queues keystrokes during disconnection, flushes on reconnect

import Foundation

struct BufferedInput {
    let data: Data
    let timestamp: Date
}

class InputBuffer {
    private var entries: [BufferedInput] = []
    private let maxAge: TimeInterval = 30.0  // Discard entries older than 30s

    /// Add input to the buffer.
    func add(_ data: Data) {
        entries.append(BufferedInput(data: data, timestamp: Date()))
    }

    /// Flush the buffer: discard stale entries, return the rest.
    func flush() -> [Data] {
        let now = Date()
        let valid = entries.filter { now.timeIntervalSince($0.timestamp) <= maxAge }
        entries.removeAll()
        return valid.map(\.data)
    }

    /// Clear all buffered input.
    func clear() {
        entries.removeAll()
    }

    /// Number of buffered entries.
    var count: Int {
        entries.count
    }

    /// Whether the buffer is empty.
    var isEmpty: Bool {
        entries.isEmpty
    }
}

// Three-tier reconnection manager that never gives up while in foreground
//
// Tier 1 — Instant: 3 attempts, 500ms apart
// Tier 2 — Backoff: exponential 2s → 60s
// Tier 3 — Network Wait: async wait for NWPathMonitor, then reset to Tier 1

import Foundation
import Combine

enum ReconnectionTier: Equatable {
    case instant     // Quick retries
    case backoff     // Exponential backoff
    case networkWait // Waiting for network
}

struct ReconnectionState: Equatable {
    var tier: ReconnectionTier
    var attempt: Int
    var isReconnecting: Bool
}

@MainActor
class ReconnectionManager: ObservableObject {
    @Published var state = ReconnectionState(tier: .instant, attempt: 0, isReconnecting: false)

    // Tier 1 config
    private let instantMaxAttempts = 3
    private let instantDelay: TimeInterval = 0.5

    // Tier 2 config
    private let backoffInitial: TimeInterval = 2.0
    private let backoffMax: TimeInterval = 60.0
    private let backoffMultiplier: Double = 2.0

    private var reconnectTask: Task<Void, Never>?
    private let networkMonitor: NetworkMonitor

    init(networkMonitor: NetworkMonitor) {
        self.networkMonitor = networkMonitor
    }

    /// Start the reconnection cycle. Calls `connect` repeatedly according to the tier schedule.
    /// Returns when a connection attempt succeeds (connect returns true).
    func startReconnecting(connect: @escaping () async -> Bool) {
        guard !state.isReconnecting else { return }
        state = ReconnectionState(tier: .instant, attempt: 0, isReconnecting: true)

        reconnectTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled && self.state.isReconnecting {
                let success = await connect()
                if success {
                    await MainActor.run { self.state.isReconnecting = false }
                    return
                }

                await self.waitForNextAttempt()
            }
        }
    }

    /// Stop reconnecting.
    func stop() {
        state.isReconnecting = false
        reconnectTask?.cancel()
        reconnectTask = nil
    }

    /// Reset to initial state (e.g., after a successful connection).
    func reset() {
        stop()
        state = ReconnectionState(tier: .instant, attempt: 0, isReconnecting: false)
    }

    private func waitForNextAttempt() async {
        state.attempt += 1

        switch state.tier {
        case .instant:
            if state.attempt >= instantMaxAttempts {
                // Move to backoff tier
                state.tier = .backoff
                state.attempt = 0
            } else {
                try? await Task.sleep(nanoseconds: UInt64(instantDelay * 1_000_000_000))
            }

        case .backoff:
            let delay = min(
                backoffInitial * pow(backoffMultiplier, Double(state.attempt)),
                backoffMax
            )
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))

            // If we've been backing off and network is down, move to network wait
            if !networkMonitor.isConnected {
                state.tier = .networkWait
                state.attempt = 0
            }

        case .networkWait:
            // Wait for network to come back, then reset to instant tier
            await networkMonitor.waitForConnectivity()
            state.tier = .instant
            state.attempt = 0
        }
    }
}

// Network connectivity monitor with async waitForConnectivity support

import Foundation
import Network

@MainActor
class NetworkMonitor: ObservableObject {
    @Published var isConnected = true
    @Published var connectionType: NWInterface.InterfaceType?

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "nokk.network-monitor")
    private var waitContinuations: [CheckedContinuation<Void, Never>] = []

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let wasConnected = self.isConnected
                self.isConnected = path.status == .satisfied

                if path.usesInterfaceType(.wifi) {
                    self.connectionType = .wifi
                } else if path.usesInterfaceType(.cellular) {
                    self.connectionType = .cellular
                } else {
                    self.connectionType = nil
                }

                // Wake up anyone waiting for connectivity
                if !wasConnected && self.isConnected {
                    let continuations = self.waitContinuations
                    self.waitContinuations.removeAll()
                    for continuation in continuations {
                        continuation.resume()
                    }
                }
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }

    /// Waits until network connectivity is available.
    /// Returns immediately if already connected.
    func waitForConnectivity() async {
        if isConnected { return }
        await withCheckedContinuation { continuation in
            if isConnected {
                continuation.resume()
            } else {
                waitContinuations.append(continuation)
            }
        }
    }
}

// nokk iOS app entry point

import SwiftUI

@main
struct NokkApp: App {
    @StateObject private var networkMonitor = NetworkMonitor()
    @StateObject private var reconnectionManager: ReconnectionManager

    private let webSocketClient: WebSocketClient

    init() {
        let monitor = NetworkMonitor()
        let reconnManager = ReconnectionManager(networkMonitor: monitor)
        let serverURL = URL(string: ProcessInfo.processInfo.environment["NOKK_SERVER_URL"] ?? "http://localhost:7777")!
        let wsClient = WebSocketClient(
            serverURL: serverURL,
            networkMonitor: monitor,
            reconnectionManager: reconnManager
        )

        _networkMonitor = StateObject(wrappedValue: monitor)
        _reconnectionManager = StateObject(wrappedValue: reconnManager)
        self.webSocketClient = wsClient
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(networkMonitor)
                .environmentObject(reconnectionManager)
                .environmentObject(webSocketClient)
        }
    }
}

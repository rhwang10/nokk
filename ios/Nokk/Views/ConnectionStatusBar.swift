// Connection status indicator shown in the navigation toolbar

import SwiftUI

struct ConnectionStatusBar: View {
    @EnvironmentObject var webSocketClient: WebSocketClient
    @EnvironmentObject var reconnectionManager: ReconnectionManager

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
            Text(statusText)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
    }

    private var statusColor: Color {
        switch webSocketClient.connectionState {
        case .connected:
            return .green
        case .connecting, .reconnecting:
            return .orange
        case .disconnected:
            return .red
        }
    }

    private var statusText: String {
        switch webSocketClient.connectionState {
        case .connected:
            return "Connected"
        case .connecting:
            return "Connecting..."
        case .reconnecting:
            let state = reconnectionManager.state
            switch state.tier {
            case .instant:
                return "Reconnecting (\(state.attempt + 1)/3)"
            case .backoff:
                return "Retrying..."
            case .networkWait:
                return "Waiting for network"
            }
        case .disconnected:
            return "Disconnected"
        }
    }
}

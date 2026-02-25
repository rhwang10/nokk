// Session list: fetches available tmux sessions from the server

import SwiftUI

struct SessionListView: View {
    @EnvironmentObject var webSocketClient: WebSocketClient
    @State private var sessions: [TmuxSession] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading sessions...")
            } else if let error = errorMessage {
                VStack(spacing: 16) {
                    Text("Failed to load sessions")
                        .font(.headline)
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Button("Retry") { Task { await loadSessions() } }
                }
            } else if sessions.isEmpty {
                VStack(spacing: 16) {
                    Text("No sessions")
                        .font(.headline)
                        .foregroundColor(.secondary)
                    Button("Refresh") { Task { await loadSessions() } }
                }
            } else {
                List(sessions) { session in
                    NavigationLink(destination: TerminalView(sessionId: session.sessionId)) {
                        VStack(alignment: .leading) {
                            Text(session.sessionId)
                                .font(.headline.monospaced())
                            Text("seq: \(session.currentSeq)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                .refreshable { await loadSessions() }
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ConnectionStatusBar()
            }
        }
        .task { await loadSessions() }
    }

    private func loadSessions() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        let serverURL = URL(string: ProcessInfo.processInfo.environment["NOKK_SERVER_URL"] ?? "http://localhost:7777")!
        let url = serverURL.appendingPathComponent("api/sessions")

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let response = try JSONDecoder().decode(SessionListResponse.self, from: data)
            sessions = response.sessions
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

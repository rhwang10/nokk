// Root content view: navigation between session list and terminal

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var webSocketClient: WebSocketClient

    var body: some View {
        NavigationStack {
            SessionListView()
                .navigationTitle("nokk")
        }
    }
}

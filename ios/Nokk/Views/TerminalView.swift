// Terminal view: displays raw tmux output in a monospaced scroll view

import SwiftUI

struct TerminalView: View {
    let sessionId: String
    @EnvironmentObject var webSocketClient: WebSocketClient
    @State private var outputText = ""
    @State private var inputText = ""

    var body: some View {
        VStack(spacing: 0) {
            // Terminal output area
            ScrollViewReader { proxy in
                ScrollView {
                    Text(outputText)
                        .font(.system(.body, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                        .id("terminal-output")
                }
                .background(Color.black)
                .foregroundColor(.green)
                .onChange(of: outputText) { _ in
                    withAnimation {
                        proxy.scrollTo("terminal-output", anchor: .bottom)
                    }
                }
            }

            // Input bar
            HStack {
                TextField("Command...", text: $inputText)
                    .font(.system(.body, design: .monospaced))
                    .textFieldStyle(.roundedBorder)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .onSubmit { sendInput() }

                Button("Send") { sendInput() }
                    .buttonStyle(.bordered)
            }
            .padding(8)
            .background(Color(.systemBackground))
        }
        .navigationTitle(sessionId)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ConnectionStatusBar()
            }
        }
        .onAppear { startListening() }
    }

    private func startListening() {
        webSocketClient.connect()
        webSocketClient.subscribe(sessionId: sessionId)

        webSocketClient.onOutput = { sid, _, data in
            guard sid == sessionId else { return }
            if let text = String(data: data, encoding: .utf8) {
                outputText += text
            }
        }

        webSocketClient.onSnapshot = { sid, _, _, _, data in
            guard sid == sessionId else { return }
            if let text = String(data: data, encoding: .utf8) {
                outputText = text
            }
        }
    }

    private func sendInput() {
        guard !inputText.isEmpty else { return }
        let text = inputText + "\n"
        if let data = text.data(using: .utf8) {
            webSocketClient.sendInput(sessionId: sessionId, data: data)
        }
        inputText = ""
    }
}

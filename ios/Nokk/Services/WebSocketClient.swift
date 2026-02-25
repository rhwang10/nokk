// WebSocket client with RESUME support and reconnection management

import Foundation
import Combine

@MainActor
class WebSocketClient: ObservableObject {
    @Published var connectionState: ConnectionState = .disconnected

    private var webSocketTask: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    private var serverURL: URL
    private var lastSeqPerSession: [String: UInt64] = [:]
    private var subscribedSessions: Set<String> = []
    private let inputBuffer = InputBuffer()
    private let reconnectionManager: ReconnectionManager
    private let networkMonitor: NetworkMonitor

    // Callbacks
    var onOutput: ((String, UInt64, Data) -> Void)?    // sessionId, seq, data
    var onSnapshot: ((String, UInt64, UInt32, UInt32, Data) -> Void)?  // sessionId, seq, cols, rows, text

    init(serverURL: URL, networkMonitor: NetworkMonitor, reconnectionManager: ReconnectionManager) {
        self.serverURL = serverURL
        self.networkMonitor = networkMonitor
        self.reconnectionManager = reconnectionManager
    }

    /// Connect to the server.
    func connect() {
        let wsURL = serverURL.appendingPathComponent("ws")
        webSocketTask = session.webSocketTask(with: wsURL)
        webSocketTask?.resume()
        connectionState = .connected
        startReceiving()
    }

    /// Disconnect from the server.
    func disconnect() {
        reconnectionManager.stop()
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        connectionState = .disconnected
    }

    /// Subscribe to a tmux session.
    func subscribe(sessionId: String) {
        subscribedSessions.insert(sessionId)
        let subscribePayload = NokkFrameCoder.encodeSubscribePayload(flags: 0)
        let frame = NokkFrameCoder.encode(NokkFrame(
            type: .subscribe,
            sessionId: sessionId,
            payload: subscribePayload
        ))
        send(frame)
    }

    /// Send input to a tmux session.
    func sendInput(sessionId: String, data: Data) {
        if connectionState != .connected {
            inputBuffer.add(data)
            return
        }
        let frame = NokkFrameCoder.encode(NokkFrame(
            type: .input,
            sessionId: sessionId,
            payload: data
        ))
        send(frame)
    }

    /// Send resize to a tmux session.
    func sendResize(sessionId: String, cols: UInt32, rows: UInt32) {
        var payload = Data()
        payload.append(contentsOf: withUnsafeBytes(of: cols.littleEndian) { Array($0) })
        payload.append(contentsOf: withUnsafeBytes(of: rows.littleEndian) { Array($0) })
        let frame = NokkFrameCoder.encode(NokkFrame(
            type: .resize,
            sessionId: sessionId,
            payload: payload
        ))
        send(frame)
    }

    // MARK: - Private

    private func send(_ data: Data) {
        webSocketTask?.send(.data(data)) { error in
            if let error {
                Task { @MainActor in
                    print("WebSocket send error: \(error)")
                    self.handleDisconnect()
                }
            }
        }
    }

    private func startReceiving() {
        webSocketTask?.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .success(let message):
                    switch message {
                    case .data(let data):
                        self.handleIncomingFrame(data)
                    case .string(let text):
                        if let data = text.data(using: .utf8) {
                            self.handleIncomingFrame(data)
                        }
                    @unknown default:
                        break
                    }
                    self.startReceiving()

                case .failure:
                    self.handleDisconnect()
                }
            }
        }
    }

    private func handleIncomingFrame(_ data: Data) {
        guard let frame = try? NokkFrameCoder.decode(data) else { return }

        switch frame.type {
        case .output:
            if let payload = try? NokkFrameCoder.decodeOutputPayload(frame.payload) {
                lastSeqPerSession[frame.sessionId] = payload.seq
                onOutput?(frame.sessionId, payload.seq, payload.data)
            }
        case .snapshot:
            if let payload = try? NokkFrameCoder.decodeSnapshotPayload(frame.payload) {
                lastSeqPerSession[frame.sessionId] = payload.seq
                onSnapshot?(frame.sessionId, payload.seq, payload.cols, payload.rows, payload.text)
            }
        case .pong:
            break
        default:
            break
        }
    }

    private func handleDisconnect() {
        guard connectionState == .connected else { return }
        connectionState = .reconnecting
        webSocketTask = nil

        reconnectionManager.startReconnecting { [weak self] in
            guard let self else { return false }
            return await self.attemptReconnect()
        }
    }

    private func attemptReconnect() async -> Bool {
        let wsURL = serverURL.appendingPathComponent("ws")
        let task = session.webSocketTask(with: wsURL)
        task.resume()

        // Simple connectivity check: try to send RESUME
        do {
            let resumeSessions = subscribedSessions.map { sessionId in
                ResumeSession(
                    sessionId: sessionId,
                    lastSeq: lastSeqPerSession[sessionId] ?? 0,
                    flags: 0
                )
            }
            let resumePayload = NokkFrameCoder.encodeResumePayload(resumeSessions)
            let frame = NokkFrameCoder.encode(NokkFrame(
                type: .resume,
                sessionId: "",
                payload: resumePayload
            ))
            try await task.send(.data(frame))

            // Success — adopt the new task
            self.webSocketTask = task
            self.connectionState = .connected
            self.startReceiving()

            // Flush buffered input
            let buffered = inputBuffer.flush()
            for data in buffered {
                if let firstSession = subscribedSessions.first {
                    sendInput(sessionId: firstSession, data: data)
                }
            }

            return true
        } catch {
            task.cancel()
            return false
        }
    }
}

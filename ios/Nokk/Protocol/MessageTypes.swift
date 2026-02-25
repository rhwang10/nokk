// nokk protocol message types

import Foundation

enum NokkMessageType: UInt8 {
    // Handshake
    case hello = 0x01
    case welcome = 0x02

    // Subscription
    case subscribe = 0x10
    case unsubscribe = 0x11
    case resume = 0x12

    // Server → Client
    case output = 0x20
    case snapshot = 0x21
    case event = 0x22
    case error = 0x23

    // Client → Server
    case input = 0x30
    case resize = 0x32

    // Keepalive
    case ping = 0x40
    case pong = 0x41
}

struct NokkFrame {
    let type: NokkMessageType
    let sessionId: String
    let payload: Data
}

struct OutputPayload {
    let seq: UInt64
    let data: Data
}

struct SnapshotPayload {
    let seq: UInt64
    let cols: UInt32
    let rows: UInt32
    let text: Data
}

struct ResumeSession {
    let sessionId: String
    let lastSeq: UInt64
    let flags: UInt32
}

struct ResumePayload {
    let sessions: [ResumeSession]
}

// tmux session model

import Foundation

struct TmuxSession: Identifiable, Codable {
    let sessionId: String
    let currentSeq: String

    var id: String { sessionId }
}

struct SessionListResponse: Codable {
    let sessions: [TmuxSession]
}

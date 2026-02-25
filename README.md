# nokk

A tmux-focused mobile terminal client that handles connection drops gracefully.

## The Problem

Mobile SSH/terminal clients suffer from unreliable connections. When a mobile client disconnects and reconnects, it typically gets an all-or-nothing viewport snapshot — losing all output that flew by while disconnected. Most clients give up after a handful of retries.

## How nokk Fixes This

1. **Output Journal with Sequence Numbers** — Every output chunk from tmux carries a monotonically increasing sequence number. The server maintains a per-session ring buffer so clients can catch up incrementally on reconnect.

2. **RESUME Protocol Message** — Reconnects are a single round-trip. The client sends all its subscriptions with last-seen sequence numbers; the server responds with either incremental output or a snapshot fallback.

3. **Three-Tier Reconnection** — The client never gives up while the app is in the foreground:
   - **Instant**: 3 attempts, 500ms apart
   - **Backoff**: Exponential from 2s to 60s
   - **Network Wait**: Async wait for connectivity via NWPathMonitor, then reset to instant

4. **tmux Control Mode** — Uses `tmux -C` instead of PTY wrapping. tmux manages its own buffers, so `capture-pane` gives snapshots for free. `%output` events provide a structured output stream that feeds directly into the journal.

## Architecture

```
nokk/
├── server/              # TypeScript/Node.js
│   ├── src/
│   │   ├── main.ts                  # Express + WebSocket server
│   │   ├── protocol/
│   │   │   ├── types.ts             # Message types & payload interfaces
│   │   │   └── frames.ts            # Binary frame encode/decode
│   │   ├── tmux/
│   │   │   ├── control-mode.ts      # Spawns tmux -C, parses control events
│   │   │   └── session-manager.ts   # Maps tmux panes to output journals
│   │   ├── journal/
│   │   │   └── output-journal.ts    # Per-session ring buffer with seq numbers
│   │   ├── ws/
│   │   │   └── client-hub.ts        # WebSocket hub: SUBSCRIBE/RESUME/INPUT
│   │   └── utils/
│   │       └── logger.ts
│   └── test/
│       ├── frames.test.ts
│       ├── output-journal.test.ts
│       └── control-mode.test.ts
├── ios/
│   ├── Nokk/
│   │   ├── App/                     # SwiftUI app entry point
│   │   ├── Protocol/                # Binary frame encode/decode (Swift)
│   │   ├── Services/                # WebSocket, reconnection, network monitor
│   │   ├── Models/                  # Data models
│   │   └── Views/                   # Session list, terminal, status bar
│   └── NokkTests/
└── docs/
    └── protocol.md                  # Full protocol specification
```

## Getting Started

### Server

```bash
cd server
npm install
npm run dev
```

The server starts on port 7777 by default. Set `PORT` and `TMUX_SESSION` environment variables to customize.

**Endpoints:**
- `GET /api/health` — Health check
- `GET /api/sessions` — List tmux sessions
- `ws://localhost:7777/ws` — WebSocket endpoint

### iOS

Open the `ios/` directory in Xcode. Set the `NOKK_SERVER_URL` environment variable to point to your server (defaults to `http://localhost:7777`).

### Running Tests

```bash
cd server
npm test
```

## Design Decisions

- **tmux -C over PTY wrapping**: tmux manages its own buffers. `capture-pane` gives snapshots for free. `%output` events provide structured output that feeds directly into the journal. No WASM terminal emulator needed on the server.

- **Sequence numbers on OUTPUT, not snapshots**: Snapshots are complete state. The seq on a snapshot tells the client "set your cursor here" for future incremental catch-up.

- **Ring buffer, not unlimited log**: 5MB / 10K-entry cap per session. Short disconnects get incremental catch-up. Long disconnects get snapshot fallback. No unbounded memory growth.

- **Raw text for bootstrap terminal view**: Full terminal emulation is a follow-up. Raw `tmux capture-pane` output proves the architecture works.

- **No auth for bootstrap**: Simplifies initial development. Auth is a follow-up.

## Protocol

See [docs/protocol.md](docs/protocol.md) for the full binary protocol specification.

## License

MIT

# nokk Protocol Specification

## Frame Format

All communication uses a binary frame format over WebSocket. All multi-byte integers are **little-endian**.

```
u16  magic       = 0x4E4B ("NK")   [LE]
u8   version     = 1
u8   type        (message type enum)
u32  sessionIdLen                   [LE]
u8[] sessionId   (UTF-8 encoded)
u32  payloadLen                     [LE]
u8[] payload     (type-specific)
```

## Message Types

| Name        | Value  | Direction        | Description                          |
|-------------|--------|------------------|--------------------------------------|
| HELLO       | 0x01   | client → server  | Initial handshake                    |
| WELCOME     | 0x02   | server → client  | Handshake response                   |
| SUBSCRIBE   | 0x10   | client → server  | Subscribe to a tmux session          |
| UNSUBSCRIBE | 0x11   | client → server  | Unsubscribe from a session           |
| RESUME      | 0x12   | client → server  | Reconnect with last-seen sequences   |
| OUTPUT      | 0x20   | server → client  | Incremental output with seq number   |
| SNAPSHOT    | 0x21   | server → client  | Full pane capture (fallback)         |
| EVENT       | 0x22   | server → client  | tmux lifecycle event                 |
| ERROR       | 0x23   | server → client  | Error response                       |
| INPUT       | 0x30   | client → server  | Keyboard input                       |
| RESIZE      | 0x32   | client → server  | Terminal resize                      |
| PING        | 0x40   | client → server  | Keepalive ping                       |
| PONG        | 0x41   | server → client  | Keepalive pong                       |

## Key Payloads

### OUTPUT (server → client)

```
u64  seq    — monotonically increasing sequence number
u8[] data   — output chunk (UTF-8)
```

Every output chunk carries a sequence number. Clients track the last-seen seq per session to enable incremental catch-up on reconnect.

### RESUME (client → server)

```
u32  numSessions
[repeated]:
  u32  idLen
  u8[] sessionId  (UTF-8)
  u64  lastSeq    — last sequence number seen by client
  u32  flags      — reserved (0)
```

Sent on reconnect. The client includes all its subscriptions with the last-seen sequence number for each. The server responds per-session with either incremental OUTPUT frames or a SNAPSHOT fallback.

### SNAPSHOT (server → client)

```
u64  seq    — current sequence number
u32  cols   — terminal columns
u32  rows   — terminal rows
u8[] text   — raw `tmux capture-pane -p -e` output
```

Sent when subscribing to a new session or when the journal has evicted the entries needed for incremental catch-up.

### SUBSCRIBE (client → server)

```
u32  flags   — reserved (0)
```

Subscribes to live output from a tmux session. The server responds with a SNAPSHOT of the current pane, then sends live OUTPUT frames.

### RESIZE (client → server)

```
u32  cols
u32  rows
```

## Reconnect Flow

nokk uses a three-tier reconnection strategy:

1. **Tier 1 — Instant**: 3 attempts, 500ms apart
2. **Tier 2 — Backoff**: Exponential backoff from 2s to 60s
3. **Tier 3 — Network Wait**: Async wait for network connectivity via NWPathMonitor, then reset to Tier 1

The reconnection manager never gives up while the app is in the foreground.

### Data Recovery

```
Short disconnect:  RESUME(lastSeq=N) → server sends OUTPUT frames N+1..M
Long disconnect:   RESUME(lastSeq=N) → seq N evicted → server sends SNAPSHOT(seq=M)
```

The server maintains a per-session output journal (ring buffer: 10K entries / 5MB). If the client's last-seen seq is still in the journal, the server sends all missed OUTPUT frames for seamless incremental catch-up. If the seq has been evicted, the server falls back to a full SNAPSHOT from `tmux capture-pane`.

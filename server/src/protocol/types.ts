// nokk protocol message types and payload interfaces

export enum NokkMessageType {
  // Handshake
  HELLO = 0x01,
  WELCOME = 0x02,

  // Subscription
  SUBSCRIBE = 0x10,
  UNSUBSCRIBE = 0x11,
  RESUME = 0x12,

  // Server → Client
  OUTPUT = 0x20,
  SNAPSHOT = 0x21,
  EVENT = 0x22,
  ERROR = 0x23,

  // Client → Server
  INPUT = 0x30,
  RESIZE = 0x32,

  // Keepalive
  PING = 0x40,
  PONG = 0x41,
}

export interface HelloPayload {
  clientVersion: string;
  clientId?: string;
}

export interface WelcomePayload {
  serverVersion: string;
  sessionIds: string[];
}

export interface SubscribePayload {
  flags: number;
}

export interface UnsubscribePayload {
  // payload is empty — sessionId is in frame header
}

export interface ResumeSession {
  sessionId: string;
  lastSeq: bigint;
  flags: number;
}

export interface ResumePayload {
  sessions: ResumeSession[];
}

export interface OutputPayload {
  seq: bigint;
  data: Buffer;
}

export interface SnapshotPayload {
  seq: bigint;
  cols: number;
  rows: number;
  text: Buffer;
}

export interface EventPayload {
  eventType: string;
  data: string;
}

export interface ErrorPayload {
  code: number;
  message: string;
}

export interface InputPayload {
  data: Buffer;
}

export interface ResizePayload {
  cols: number;
  rows: number;
}

export interface NokkFrame {
  type: NokkMessageType;
  sessionId: string;
  payload: Buffer;
}

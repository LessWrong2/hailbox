/**
 * Wire protocol between the Hailbox widget and the Hailbox inbox server.
 *
 * REST endpoints (all relative to the inbox's base URL, authenticated with
 * `Authorization: Bearer <visitor token>` except where noted):
 *
 *   POST  /api/v1/visitors   CreateVisitorRequest -> CreateVisitorResponse   (no auth)
 *   GET   /api/v1/visitor    ?after=<messageId>   -> VisitorStateResponse
 *   PATCH /api/v1/visitor    UpdateVisitorRequest -> UpdateVisitorResponse
 *   POST  /api/v1/messages   SendMessageRequest   -> SendMessageResponse
 *   POST  /api/v1/read       MarkReadRequest      -> { ok: true }
 *
 * WebSocket: GET /api/v1/ws. The client's first frame must be a VisitorAuthFrame;
 * after that the server pushes VisitorServerFrames. Clients should send a ping
 * every ~25s and reconnect (then re-fetch state) whenever the socket closes, since
 * the server closes connections when its function reaches its maximum duration.
 */

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_NAME_LENGTH = 100;

export type MessageAuthor = 'visitor' | 'operator';

export interface WireMessage {
  /** Monotonically increasing; usable as a cursor. */
  id: number;
  conversationId: string;
  author: MessageAuthor;
  /** Display name of the operator who wrote it; null for visitor messages. */
  authorName: string | null;
  body: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** Echoed back from SendMessageRequest so the sender can reconcile optimistic messages. */
  clientId?: string;
}

export interface WireVisitor {
  id: string;
  name: string | null;
  email: string | null;
  notifyByEmail: boolean;
}

export interface WireConversation {
  id: string;
  status: 'open' | 'closed';
  /** Highest operator message id the visitor has read. */
  visitorLastReadMessageId: number | null;
}

export interface ApiError {
  error: string;
}

export interface CreateVisitorRequest {
  name?: string;
  email?: string;
  pageUrl?: string;
}

export interface CreateVisitorResponse {
  visitor: WireVisitor;
  /** Secret bearer token. Store it; it is the only way to act as this visitor. */
  token: string;
}

export interface VisitorStateResponse {
  visitor: WireVisitor;
  conversation: WireConversation | null;
  /** All messages, or only those after `?after=` when given. Ascending by id. */
  messages: WireMessage[];
  /** Operator messages the visitor hasn't read yet. */
  unreadCount: number;
}

export interface UpdateVisitorRequest {
  name?: string | null;
  email?: string | null;
  notifyByEmail?: boolean;
}

export interface UpdateVisitorResponse {
  visitor: WireVisitor;
}

export interface SendMessageRequest {
  body: string;
  clientId?: string;
  pageUrl?: string;
}

export interface SendMessageResponse {
  message: WireMessage;
  conversation: WireConversation;
}

export interface MarkReadRequest {
  lastMessageId: number;
}

export type VisitorClientFrame =
  | { type: 'auth'; token: string }
  | { type: 'ping' };

export type VisitorServerFrame =
  | { type: 'ready' }
  | { type: 'pong' }
  | { type: 'message'; message: WireMessage }
  | { type: 'read'; lastMessageId: number }
  | { type: 'visitor'; visitor: WireVisitor }
  | { type: 'error'; error: string };

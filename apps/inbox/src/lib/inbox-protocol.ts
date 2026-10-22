import type { MessageAuthor, WireMessage } from 'hailbox/protocol';

export type { WireMessage };

export interface InboxVisitor {
  id: string;
  name: string | null;
  email: string | null;
  notifyByEmail: boolean;
  userAgent: string | null;
  location: string | null;
  lastPageUrl: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface InboxConversation {
  id: string;
  status: 'open' | 'closed';
  pageUrl: string | null;
  createdAt: string;
  lastMessageAt: string;
  lastMessageAuthor: MessageAuthor | null;
  lastMessagePreview: string | null;
  /** Visitor messages no operator has read yet. */
  unreadCount: number;
  visitorLastReadMessageId: number | null;
  visitor: InboxVisitor;
}

export interface OperatorInfo {
  id: string;
  email: string;
  name: string | null;
  displayName: string;
}

export interface ConversationListResponse {
  conversations: InboxConversation[];
}

export interface ConversationDetailResponse {
  conversation: InboxConversation;
  messages: WireMessage[];
}

export type InboxServerFrame =
  | { type: 'ready' }
  | { type: 'pong' }
  | { type: 'message'; message: WireMessage }
  | { type: 'conversation'; conversation: InboxConversation };

export function visitorLabel(visitor: Pick<InboxVisitor, 'id' | 'name' | 'email'>): string {
  return visitor.name || visitor.email || `Visitor ${visitor.id.slice(0, 6)}`;
}

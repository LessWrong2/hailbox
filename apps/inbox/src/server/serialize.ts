import type { WireConversation, WireMessage, WireVisitor } from 'hailbox/protocol';
import type { InboxConversation, InboxVisitor, OperatorInfo } from '@/lib/inbox-protocol';
import type { Conversation, Message, Operator, Visitor } from './db/schema';

export function operatorDisplayName(operator: Pick<Operator, 'name' | 'email'>): string {
  return operator.name || operator.email.split('@')[0] || operator.email;
}

export function toOperatorInfo(operator: Operator): OperatorInfo {
  return {
    id: operator.id,
    email: operator.email,
    name: operator.name,
    displayName: operatorDisplayName(operator),
  };
}

export function toWireMessage(message: Message, authorName: string | null): WireMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    author: message.author,
    authorName: message.author === 'operator' ? authorName : null,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toWireVisitor(visitor: Visitor): WireVisitor {
  return {
    id: visitor.id,
    name: visitor.name,
    email: visitor.email,
    notifyByEmail: visitor.notifyByEmail,
  };
}

export function toWireConversation(conversation: Conversation): WireConversation {
  return {
    id: conversation.id,
    status: conversation.status,
    visitorLastReadMessageId: conversation.visitorLastReadMessageId,
  };
}

export function toInboxVisitor(visitor: Visitor): InboxVisitor {
  return {
    id: visitor.id,
    name: visitor.name,
    email: visitor.email,
    notifyByEmail: visitor.notifyByEmail,
    userAgent: visitor.userAgent,
    location: visitor.location,
    lastPageUrl: visitor.lastPageUrl,
    createdAt: visitor.createdAt.toISOString(),
    lastSeenAt: visitor.lastSeenAt.toISOString(),
  };
}

export function toInboxConversation(
  conversation: Conversation,
  visitor: Visitor,
  unreadCount: number,
): InboxConversation {
  return {
    id: conversation.id,
    status: conversation.status,
    pageUrl: conversation.pageUrl,
    createdAt: conversation.createdAt.toISOString(),
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    lastMessageAuthor: conversation.lastMessageAuthor,
    lastMessagePreview: conversation.lastMessagePreview,
    unreadCount,
    visitorLastReadMessageId: conversation.visitorLastReadMessageId,
    visitor: toInboxVisitor(visitor),
  };
}

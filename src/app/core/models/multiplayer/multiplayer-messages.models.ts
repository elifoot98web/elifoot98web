import { JsonValue } from 'trystero';

interface BaseMessage {
    [key: string]: JsonValue
}

/**
 * Sent once, targeted, by a host to every peer that joins. A guest learns who the
 * host is without waiting; a second host learns immediately that it has collided.
 */
export interface HostAnnounceMessage extends BaseMessage {
    hostName: string;
    /** How long this host has been broadcasting, by its own monotonic clock. */
    hostingForMs: number;
}

/** Request payload for the roleQuery action. Empty: the question is the message. */
export interface RoleQueryRequest extends BaseMessage {
    [key: string]: JsonValue
}

/** Reply to a roleQuery. Must never be undefined — trystero requires a payload. */
export interface RoleDescriptor extends BaseMessage {
    role: 'host' | 'guest';
    name: string;
    color: string;
    /** Elapsed broadcast time by the sender's own clock; 0 for a guest. */
    hostingForMs: number;
}

export interface CursorPositionMessage extends BaseMessage {
    x: number;
    y: number;
    color: string;
    name: string;
}

export interface CursorClickMessage extends BaseMessage {
    x: number;
    y: number;
    color: string;
}

export interface PlayerIdentMessage extends BaseMessage {
    name: string;
    color: string;
    host: boolean; // true if this is the host player
}

/**
 * `system` lines are generated locally on each peer (joins, leaves) and never travel over
 * the wire — every peer already observes those events for itself, so broadcasting them
 * would duplicate them. Required rather than optional so a missing `kind` is a build
 * error under `strict` instead of a silently-untyped message.
 */
export type MultiplayerChatMessageKind = 'user' | 'system';

export interface MultiplayerChatMessage extends BaseMessage {
    id: string; // unique id for message
    senderId: string;
    text: string;
    timestamp: number; // set by the sender, so all peers order messages identically
    kind: MultiplayerChatMessageKind;
}

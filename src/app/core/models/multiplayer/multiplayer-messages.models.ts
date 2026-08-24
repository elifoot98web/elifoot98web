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

export interface MultiplayerChatMessage extends BaseMessage {
    id: string; // unique id for message
    senderId: string;
    text: string;
    timestamp: number; // set by the sender, so all peers order messages identically
}

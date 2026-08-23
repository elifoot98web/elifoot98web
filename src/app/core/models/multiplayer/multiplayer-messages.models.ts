import { JsonValue } from 'trystero';

interface BaseMessage {
    [key: string]: JsonValue
}

export interface HostClaimMessage extends BaseMessage {
    hostName: string;
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

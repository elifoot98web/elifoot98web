// copied from JsonValue in trysteros because it is not exported

type SendableValue = null
    | string
    | number
    | boolean
    | SendableValue[]
    | {[key: string]: SendableValue}

interface BaseMessage {
    [key: string]: SendableValue
}

export interface HostClaimMessage extends BaseMessage {
    hostName: string;
    hostId: string;
}

export interface PlayerListMessage extends BaseMessage {
    players: { [peerId: string]: string };
}

export interface PlayerCursorMessage extends BaseMessage {
    x: number;
    y: number;
    color: string;
    name: string;
}

export interface MultiplayerChatMessage extends BaseMessage {
    id: string; // unique id for message
    senderId: string;
    senderName: string;
    text: string;
}

export interface MultiplayerChatMessageWithTimestamp extends MultiplayerChatMessage {
    timestamp: number; // timestamp of the received message
}

export interface HostClaimMessage {
    [key: string]: string;
    hostName: string;
    hostId: string;
}

export interface PlayerListMessage {
    [key: string]: string | { [peerId: string]: string };
    players: { [peerId: string]: string };
}

export interface PlayerCursorMessage {
    [key: string]: string | number;
    x: number;
    y: number;
    color: string;
}
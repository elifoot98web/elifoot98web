export enum GameState {
    NOT_IN_ROOM,
    JOINING_ROOM,
    WAITING_STREAM,
    IN_ROOM,
    HOST_LEFT,
    ERROR
}

export enum MultiplayerUserRole {
    HOST,
    GUEST
}

export interface PlayerInfo {
    peerId: string; // Unique identifier for the player
    playerName: string; // Display name of the player
    playerColor?: string; // Optional cursor color for the player
    role: MultiplayerUserRole; // Role of the player (HOST or GUEST)
    latency: number; // Ping time to the player in milliseconds
}
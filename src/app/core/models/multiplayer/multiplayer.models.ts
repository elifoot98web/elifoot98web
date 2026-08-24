export enum GameState {
    NOT_IN_ROOM,
    JOINING_ROOM,
    WAITING_STREAM,
    IN_ROOM,
    HOST_LEFT,
    ROOM_CODE_TAKEN,
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

/**
 * Failures trystero can actually report through `onJoinError`, as opposed to the
 * silence of a room nobody is hosting.
 */
export type MultiplayerJoinErrorKind = 'wrong-password' | 'connection-failed';

/** Thrown when a join fails for a reason trystero was able to name. */
export class MultiplayerJoinFailure extends Error {
    constructor(readonly kind: MultiplayerJoinErrorKind) {
        super(`Multiplayer join failed: ${kind}`);
        this.name = 'MultiplayerJoinFailure';
    }
}

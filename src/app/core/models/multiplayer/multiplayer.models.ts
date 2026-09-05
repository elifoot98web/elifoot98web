export enum GameState {
    NOT_IN_ROOM,
    JOINING_ROOM,
    WAITING_STREAM,
    IN_ROOM,
    HOST_LEFT,
    ROOM_CODE_TAKEN,
    ERROR,
    /**
     * The host's connection dropped and we are inside the grace period, still holding the
     * last frame. Terminal only if the grace expires, at which point this becomes
     * HOST_LEFT.
     *
     * Appended rather than inserted next to HOST_LEFT on purpose: the members have no
     * explicit values, so inserting one would silently renumber every member after it.
     */
    HOST_RECONNECTING
}

export enum MultiplayerUserRole {
    HOST,
    GUEST
}

/**
 * How healthy a peer's link is, as opposed to how fast it is.
 *
 * `poor` and `lost` are different facts, not degrees of the same one: a peer that misses a
 * ping while its RTCPeerConnection is still up has a bad link, whereas one whose connection
 * has failed or vanished is gone. Only the second is worth ending anything over.
 */
export type PlayerConnectionQuality = 'unknown' | 'good' | 'fair' | 'poor' | 'lost';

export interface PlayerInfo {
    peerId: string; // Unique identifier for the player
    playerName: string; // Display name of the player
    playerColor?: string; // Optional cursor color for the player
    role: MultiplayerUserRole; // Role of the player (HOST or GUEST)
    latency: number; // Ping time to the player in milliseconds
    quality: PlayerConnectionQuality; // Link health, corroborated against getPeers()
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

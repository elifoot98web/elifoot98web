export interface GameRoom {
    id: string;
    hostPlayerName: string;
    hostPlayerId: string;
    offer: {
        type: string;
        sdp?: string;
    },
    answer?: {
        type: string;
        sdp?: string;
    }
}
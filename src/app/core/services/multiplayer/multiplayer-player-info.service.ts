import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { MultiplayerUserRole, PlayerIdentMessage, PlayerInfo } from '../../models/multiplayer';
import { Room } from 'trystero';
import { MULTIPLAYER } from '../../models/constants';

@Injectable({
  providedIn: 'root'
})
export class MultiplayerPlayerInfoService {

  private remotePlayers: { [peerId: string]: PlayerInfo } = {}; // Maps peerId to player name
  private playerListSubject = new BehaviorSubject<PlayerInfo[]>([]);  
  private pingInterval: any; // For latency updates

  constructor() { }
  
  playerList$ = this.playerListSubject.asObservable();
  
  setup(room: Room) {
    // Listen for player ident messages    
    const [_sendPlayerIdent, receivePlayerIdent] = room.makeAction<PlayerIdentMessage>(MULTIPLAYER.EVENTS.PLAYER_IDENT);
    receivePlayerIdent((ident, peerId) => {
      console.log(`Received ident message from ${peerId}`, { ident });
      const playerInfo: PlayerInfo = {
        peerId,
        playerName: ident.name,
        playerColor: ident.color,
        role: ident.host ? MultiplayerUserRole.HOST : MultiplayerUserRole.GUEST,
        latency: -1 // Initial latency, will be updated later
      }
      this.updatePlayer(playerInfo);
    });

    this.pingInterval = setInterval(() => {
      const peerIds = Object.keys(this.remotePlayers); 
      peerIds.forEach(peerId => {
        let timedOut = false;
        
        const timeOutHandler = setTimeout(() => {
          timedOut = true; // Mark as timed out
        }, MULTIPLAYER.PING_TIMEOUT)

        room.ping(peerId).then(latency => {
          if(timedOut) return; // Ignore if already timed out
          
          clearTimeout(timeOutHandler); // Clear timeout if we got a response
          
          const playerInfo = this.getPlayer(peerId);
          if (!playerInfo) return;
            
          playerInfo.latency = latency;
          this.updatePlayer(playerInfo); // Update player with new latency
        })
      })
    }, MULTIPLAYER.PING_REFRESH_INTERVAL);
  }
  
  clear() {
    clearInterval(this.pingInterval); // Stop ping updates
    this.remotePlayers = {};
    this.playerListSubject.next([]);
  }

  updatePlayer(playerInfo: PlayerInfo) {
    this.remotePlayers[playerInfo.peerId] = playerInfo;
    this.playerListSubject.next(Object.values(this.remotePlayers));
  }

  removePlayer(peerId: string) {
    delete this.remotePlayers[peerId];
    this.playerListSubject.next(Object.values(this.remotePlayers));
  }

  getPlayer(peerId: string): PlayerInfo | undefined {
    return this.remotePlayers[peerId];
  }
}

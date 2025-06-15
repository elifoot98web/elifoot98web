import { Injectable } from '@angular/core';
import { Room } from 'trystero';
import { MultiplayerUserRole } from '../../models/multiplayer/multiplayer.models';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class MultiplayerStreamService {
  private stream?: MediaStream;
  private room?: Room;
  private role?: MultiplayerUserRole;
  private streamSubject = new BehaviorSubject<MediaStream>(new MediaStream());

  constructor() { }

  getStreamObservable(): Observable<MediaStream> {
    return this.streamSubject.asObservable();
  }

  /**
   * Initialize the stream service with the current room, role, and (if host) the stream to share.
   */
  setup(room: Room, role: MultiplayerUserRole, stream?: MediaStream) {
    this.room = room;
    this.role = role;
    if (role === MultiplayerUserRole.HOST && stream) {
      console.log('Setting up stream for HOST role');
      this.updateStream(stream);
    } else {
      console.log('Setting up stream for GUEST role');
      this.room.onPeerStream((peerStream, peerId) => {
        if (this.role === MultiplayerUserRole.GUEST) {
          console.log(`[STREAM] Received stream from peer: ${peerId}`, { role: this.role, room: this.room, peerStream });
          // For GUEST, just update the local stream reference
          this.stream = peerStream;
          this.streamSubject.next(peerStream); // Notify subscribers of the new stream
        } else {
          console.warn('Received stream as HOST, but should not handle streams from peers.');
        }
      })
    }
  }

  /**
   * Call this when a peer joins (from MultiplayerService).
   * For HOST, adds the stream to the new peer.
   */
  handlePeerJoin(peerId: string) {
    console.log(`[STREAM] Peer joined: ${peerId}`, { role: this.role, room: this.room, stream: this.stream });
    if (this.role === MultiplayerUserRole.HOST && this.room && this.stream) {
      this.room.addStream(this.stream, peerId);
    }
  }

  /**
   * Call this when a peer leaves (from MultiplayerService).
   * For HOST, removes the stream from the peer.
   */
  handlePeerLeave(peerId: string) {
    if (this.role === MultiplayerUserRole.HOST && this.room && this.stream) {
      this.room.removeStream(this.stream, peerId);
    }
  }

  /**
   * For HOST: update the stream being sent to peers (e.g., if the canvas changes)
   * For GUEST: this is an update of the stream received from the host.
   */
  updateStream(stream: MediaStream) {
    if (!this.room) return;
    if (!stream) {
      console.warn('Cannot update stream: stream is invalid.');
      return;
    }
    
    const currentStream = this.stream;
    this.stream = stream;

    if (this.role === MultiplayerUserRole.HOST) {
      if(currentStream) {
        this.stopBroadcasting(currentStream);
      }
      this.startBroadcast(stream);
    } else {
      // For GUEST, just update the local stream reference
      this.stream = stream;
      this.streamSubject.next(stream); // Notify subscribers of the new stream
    }
  }

  /**
   * Cleanup references (call on room leave)
   */
  clear() {
    if (this.stream) {
      this.stopBroadcasting(this.stream);
      this.stream = undefined;
      this.streamSubject.next(new MediaStream()); // Reset the stream subject
    }
    this.room = undefined;
    this.role = undefined;
  }

  private stopBroadcasting(stream: MediaStream) {
    if (!this.room) return;
    this.room.removeStream(stream);
  }

  private startBroadcast(stream: MediaStream) {
    if (!this.room) return;
    this.room.addStream(stream);
  }
}

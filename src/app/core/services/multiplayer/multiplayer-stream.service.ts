import { Injectable } from '@angular/core';
import { Room } from 'trystero';
import { MultiplayerUserRole } from '../../models/multiplayer/multiplayer.models';
import { BehaviorSubject, filter, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class MultiplayerStreamService {
  private stream?: MediaStream;
  private room?: Room;
  private role?: MultiplayerUserRole;
  private streamSubject = new BehaviorSubject<MediaStream>(new MediaStream());
  private hostPeerIdSubject = new BehaviorSubject<string | null>(null);

  constructor() { }

  /**
   * The peer that actually delivered a video track, or null while nobody has.
   *
   * Host identity is derived from the stream rather than from a claim: a guest has no
   * emulator and cannot serve one, so there is nothing to elect, and a self-declared
   * `host` flag is forgeable by any spectator with devtools. Only ever populated on a
   * guest — a host receives no streams, and knows its own role locally.
   */
  hostPeerId$ = this.hostPeerIdSubject.asObservable();

  /** Synchronous read for the peer-leave handler, which cannot wait for an emission. */
  get hostPeerId(): string | null {
    return this.hostPeerIdSubject.value;
  }

  getStreamObservable(): Observable<MediaStream> {
    return this.streamSubject.asObservable();
  }

  /**
   * Emits only once a stream actually carries video.
   *
   * A room code nobody is hosting looks exactly like an empty room — trystero joins a
   * room name, not a host — so callers must pair this with a timeout. Failures
   * trystero *can* name arrive separately via `MultiplayerService.joinError$`.
   */
  get videoStream$(): Observable<MediaStream> {
    return this.streamSubject.pipe(filter(stream => stream.getVideoTracks().length > 0));
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
      this.room.onPeerStream = (peerStream, peerId) => {
        if (this.role !== MultiplayerUserRole.GUEST) {
          console.warn('Received stream as HOST, but should not handle streams from peers.');
          return;
        }

        // `onPeerStream` is a single assignable property, not a listener list, so without
        // the guards below the last stream from ANY peer would win — replacing the picture
        // and, now that host identity is derived from it, reassigning who the host is.
        // First video track wins, and keeps winning until that peer leaves
        // (`releaseHost`) or the room is torn down.
        if (peerStream.getVideoTracks().length === 0) {
          console.log(`[STREAM] Ignoring stream without video from peer: ${peerId}`);
          return;
        }

        const currentHost = this.hostPeerIdSubject.value;
        if (currentHost !== null && currentHost !== peerId) {
          console.warn(`[STREAM] Ignoring video from ${peerId}: ${currentHost} is already the host.`);
          return;
        }

        console.log(`[STREAM] Received stream from peer: ${peerId}`, { role: this.role, room: this.room, peerStream });
        this.stream = peerStream;
        if (currentHost === null) {
          this.hostPeerIdSubject.next(peerId);
        }
        // Emitted after the host id, so a subscriber reacting to the stream can already
        // read `hostPeerId`. A re-emission from the same peer is the reconnect path.
        this.streamSubject.next(peerStream);
      }
    }
  }

  /**
   * Forget the current host so a returning or replacing one can claim identity again.
   * A no-op unless `peerId` is the peer that delivered the stream.
   *
   * Called from the guest's peer-leave path in `MultiplayerService`: the host-only
   * `handlePeerLeave` below never runs on a guest.
   */
  releaseHost(peerId: string) {
    if (this.hostPeerIdSubject.value === peerId) {
      console.warn(`[STREAM] Host ${peerId} left; host identity is now unclaimed.`);
      this.hostPeerIdSubject.next(null);
    }
  }

  /**
   * Call this when a peer joins (from MultiplayerService).
   * For HOST, adds the stream to the new peer.
   */
  handlePeerJoin(peerId: string) {
    console.log(`[STREAM] Peer joined: ${peerId}`, { role: this.role, room: this.room, stream: this.stream });
    if (this.role === MultiplayerUserRole.HOST && this.room && this.stream) {
      this.publishStream(peerId);
    }
  }

  /**
   * Hand trystero a NEW MediaStream around the same tracks on every add. Never pass the same
   * stream object twice.
   *
   * trystero labels a stream with a key it caches per stream *object* (a WeakMap in its media
   * manager), sends that key ahead of the tracks, and the receiving side caches the remote
   * stream under it on a shared peer that outlives any single room. Re-adding one object
   * therefore replays a key the other side has seen: its `receiveStreamMeta` finds the
   * previous remote stream and hands *that* to `onPeerStream`, so a spectator rejoining an
   * old connection was handed a MediaStream whose tracks belonged to a closed one — IN_ROOM,
   * roster and chat all correct, `videoWidth` stuck at 0, no error anywhere.
   *
   * A fresh wrapper misses that cache on both its key and its `id`, so that failure mode
   * becomes an honest timeout instead of a dead picture. It is not on its own enough to make
   * such a rejoin work — trystero will not renegotiate media onto a connection that is
   * already up, which is why the guest page rejoins from a fresh page load (see
   * `JoinGamePage.reloadSpectator`). Keep both: this is the half that guarantees a spectator
   * is never shown a frozen picture as if it were live.
   *
   * The tracks are shared, so this costs no extra capture or encoding, and removal is
   * unaffected: trystero matches senders by track, not by stream identity.
   */
  private publishStream(target?: string) {
    if (!this.room || !this.stream) return;
    const wrapped = new MediaStream(this.stream.getTracks());
    this.room.addStream(wrapped, target ? { target } : {});
  }

  /**
   * Call this when a peer leaves (from MultiplayerService).
   * For HOST, removes the stream from the peer.
   *
   * trystero logs `no peer with id …` here whenever it dropped the peer before we got the
   * event, which is most of the time. Harmless: the senders went with the connection, and
   * `publishStream` no longer depends on this having succeeded.
   */
  handlePeerLeave(peerId: string) {
    if (this.role === MultiplayerUserRole.HOST && this.room && this.stream) {
      this.room.removeStream(this.stream, { target: peerId });
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
      this.startBroadcast();
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
    // Only a host ever added a stream to the room; a guest's stream is the host's,
    // and asking trystero to remove it would be meaningless.
    if (this.stream && this.role === MultiplayerUserRole.HOST) {
      this.stopBroadcasting(this.stream);
    }
    this.stream = undefined;
    this.streamSubject.next(new MediaStream()); // Reset the stream subject
    this.hostPeerIdSubject.next(null); // Host identity does not survive a room
    this.room = undefined;
    this.role = undefined;
  }

  private stopBroadcasting(stream: MediaStream) {
    if (!this.room) return;
    this.room.removeStream(stream);
  }

  /** Broadcasts the current stream to every peer in the room. */
  private startBroadcast() {
    this.publishStream();
  }
}

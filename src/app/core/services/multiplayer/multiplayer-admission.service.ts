import { Injectable } from '@angular/core';
import { MULTIPLAYER } from '../../models/constants';
import { WireGuardHelper } from '../../helpers/wire-guard.helper';

/**
 * Decides whether a peer that has just connected may become part of the room, and holds the
 * limit that decision is made against.
 *
 * trystero has no kick, ban or max-peers; what it has is an admission gate
 * (`onPeerHandshake`) that runs after the password challenge and before a peer is active.
 * A peer held there is invisible — no `onPeerJoin`, no actions, no stream — so refusing it
 * costs nothing and leaves nothing to clean up. This service is the pure half of that gate;
 * `MultiplayerService` owns the handshake plumbing around it.
 *
 * Counted from the transport, never from the roster. `playerList$` only learns a peer when
 * its ident arrives, and it includes the host, so it is both late and off by one. The count
 * is therefore what trystero reports as active plus the peers this service has admitted but
 * that have not become active yet — without those, a burst of simultaneous joiners would
 * all see the same free slot.
 */
@Injectable({
  providedIn: 'root'
})
export class MultiplayerAdmissionService {
  private limit = MULTIPLAYER.DEFAULT_MAX_SPECTATORS;

  /** Peers let through whose handshake has not completed, with the moment their hold lapses. */
  private pending = new Map<string, number>();

  /** The spectator limit of the room being hosted, the host not counted. */
  get maxSpectators(): number {
    return this.limit;
  }

  /**
   * Set before the room is entered, so no peer can be judged against a stale limit. Read
   * lazily by `admit`, which is what would let a live control be added later.
   */
  setLimit(value: unknown) {
    this.limit = WireGuardHelper.spectatorLimit(value);
  }

  /**
   * Whether `peerId` may join, recording its slot if so.
   *
   * Synchronous on purpose, and it must stay that way: the comparison and the recording
   * are one step, so two peers cannot both be admitted into the last slot. Do not put an
   * `await` between calling this and acting on the answer.
   *
   * A peer that is already active or already admitted is let through without taking a
   * second slot. That is what keeps a spectator whose link blipped from being locked out of
   * a room they never left: they come back as the same `selfId`, which is still counted.
   * (One who reloads is a new `selfId`, and has already said goodbye on the way out.)
   */
  admit(peerId: string, activePeerIds: readonly string[]): boolean {
    this.prune();

    const known = activePeerIds.includes(peerId) || this.pending.has(peerId);
    if (!known) {
      const occupied = new Set([...activePeerIds, ...this.pending.keys()]);
      if (occupied.size >= this.limit) return false;
    }

    // Refreshed for a known peer too, so a retried handshake does not lapse mid-way.
    this.pending.set(peerId, performance.now() + MULTIPLAYER.ADMISSION_HOLD_MS);
    return true;
  }

  /** The peer is active now, so trystero counts it itself and the hold is no longer needed. */
  release(peerId: string) {
    this.pending.delete(peerId);
  }

  /** Idempotent; called by `MultiplayerService.leaveRoom()` like every other service here. */
  clear() {
    this.pending.clear();
    this.limit = MULTIPLAYER.DEFAULT_MAX_SPECTATORS;
  }

  private prune() {
    const now = performance.now();
    for (const [peerId, expiry] of this.pending) {
      if (expiry <= now) this.pending.delete(peerId);
    }
  }
}

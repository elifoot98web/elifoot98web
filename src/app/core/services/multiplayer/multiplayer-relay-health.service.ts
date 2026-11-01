import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { MULTIPLAYER } from '../../models/constants';

/**
 * What the relay (TURN) looks like from this browser right now.
 *
 * `unknown` until some connection has finished gathering; `ok` once any connection has been
 * handed a relay candidate; `unavailable` when a connection finished gathering with TURN
 * configured and none ever got one.
 */
export type RelayHealth = 'unknown' | 'ok' | 'unavailable';

/**
 * Notices when the TURN relay has stopped working, which nothing else in the app can see.
 *
 * The relay is the free tier of a third party, and when its quota runs out the provider cuts
 * it off. That degrades the app rather than breaking it — trystero keeps its public STUN
 * servers (`turnConfig` is added to them, not substituted), and two peers on ordinary home
 * networks connect directly without ever touching a relay. Only the minority behind symmetric
 * NATs, mobile carriers or strict firewalls need it, and for them a join simply fails. The
 * trouble is that it fails exactly like a user network problem, so nobody is told and the guest
 * is sent off to check a room code that was never wrong.
 *
 * trystero's public API cannot show this: a connection appears in `getPeers()` only once it is
 * up, so the ones that never come up are invisible. `rtcPolyfill` is the one early hook, and a
 * `RTCPeerConnection` subclass sees every connection trystero makes, including the pool of 20 it
 * opens before anyone has joined. That makes a separate probe pointless: it would only spend more
 * relay allocations to learn what the pool already shows for free.
 *
 * Deliberately outlives rooms and has no `clear()`, unlike the other multiplayer services.
 * Whether this browser can reach the relay is a property of the browser, not of a room, and the
 * pooled connections that carry the evidence are built once and reused, so resetting per room
 * would throw the answer away without any new connection to re-derive it.
 */
@Injectable({
  providedIn: 'root'
})
export class MultiplayerRelayHealthService {
  private healthSubject = new BehaviorSubject<RelayHealth>('unknown');
  health$ = this.healthSubject.asObservable();

  get health(): RelayHealth {
    return this.healthSubject.value;
  }

  private turnConfigured = false;
  private sawRelay = false;

  /** Armed when the first connection is built; see `armVerdictTimer`. */
  private verdictTimer?: ReturnType<typeof setTimeout>;

  /** Error codes already reported, so one dead relay is one console line and not eighty. */
  private reportedErrors = new Set<number>();

  /**
   * The class to pass trystero as `rtcPolyfill`.
   *
   * Built on each call rather than once at module load so it extends whichever
   * `RTCPeerConnection` exists at that moment, which keeps the test harness able to patch the
   * global and have the patch take effect.
   *
   * trystero builds every connection as `new RTCPeerConnection({ iceServers, ...rtcConfig })`.
   * Never pass it an `rtcConfig.iceServers`: that spread comes last and would replace the whole
   * list, public STUN included, which is the fallback this relies on.
   */
  peerConnectionClass(turnConfigured: boolean): typeof RTCPeerConnection {
    this.turnConfigured = turnConfigured;
    const observe = (pc: RTCPeerConnection) => this.observe(pc);
    return class extends RTCPeerConnection {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        observe(this);
      }
    };
  }

  private observe(pc: RTCPeerConnection) {
    this.armVerdictTimer();

    pc.addEventListener('icecandidate', event => {
      const candidate = event.candidate;
      if (!candidate) return;
      // `type` is the standard field; the SDP line is the fallback for an engine without it.
      if (candidate.type === 'relay' || / typ relay /.test(candidate.candidate)) this.relayReached();
    });

    // Diagnostic only. Firefox does not implement this event, so the verdict never depends on it.
    pc.addEventListener('icecandidateerror', event => this.noteError(event as RTCPeerConnectionIceErrorEvent));

    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') this.gatheringFinished();
    });
  }

  private relayReached() {
    this.sawRelay = true;
    clearTimeout(this.verdictTimer);
    this.healthSubject.next('ok'); // Sticky, and also the way back from `unavailable`.
  }

  /**
   * Call the relay unavailable if no connection has been handed a relay candidate a few seconds
   * after the first one was built. Armed once, by whichever connection comes first.
   *
   * Waiting for a connection to finish gathering is the slower, certain signal, and it stays as
   * the fast path when every server answers quickly. But a server that never answers makes
   * gathering run for ~40s, and a spectator's join gives up after 20s, so on its own that signal
   * would arrive after the only message that needed it. A relay that was merely slow is not lost
   * by this: the first candidate to arrive afterwards puts the state back to `ok`.
   */
  private armVerdictTimer() {
    if (this.verdictTimer !== undefined || !this.turnConfigured || this.sawRelay) return;
    this.verdictTimer = setTimeout(() => this.concludeUnavailable(), MULTIPLAYER.RELAY_VERDICT_MS);
  }

  /**
   * A connection has tried every server it was given. With TURN configured, finishing without
   * ever having seen a relay candidate means the relay did not answer: refused (401/403 once
   * the quota is gone), unreachable, or blocked by this network. Which of those it is does not
   * change what a user can do about it.
   *
   * This is a verdict about gathering, not about data flowing: a provider that allocates and
   * then drops the relayed traffic would still read as `ok`.
   */
  private gatheringFinished() {
    this.concludeUnavailable('A connection finished gathering without a relay candidate');
  }

  private concludeUnavailable(reason = 'No connection was handed a relay candidate in time') {
    if (!this.turnConfigured || this.sawRelay) return;
    if (this.healthSubject.value !== 'unavailable') {
      console.warn(`[RELAY] ${reason}; the relay looks unavailable.`);
      this.healthSubject.next('unavailable');
    }
  }

  private noteError(event: RTCPeerConnectionIceErrorEvent) {
    if (this.reportedErrors.has(event.errorCode)) return;
    this.reportedErrors.add(event.errorCode);
    console.warn(
      `[RELAY] ICE server error ${event.errorCode} from ${event.url || 'an ICE server'}: ${event.errorText}`
    );
  }
}

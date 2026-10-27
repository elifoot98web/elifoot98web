import { Injectable } from '@angular/core';

/**
 * Turns the game's sound into a track the host can publish next to the canvas video.
 *
 * js-dos owns its AudioContext privately, so the node is captured in `game.js`
 * (`getDosAudioNode`). A destination is fanned out from it; it is never connected to
 * `ctx.destination`, so the host hears exactly what they heard before and a spectator's
 * stream is independent of the host's own volume.
 *
 * The track is made once, before the first `addStream`, and then only ever switched with
 * `enabled`. It must not be added to or removed from a live room: trystero will not
 * renegotiate media onto a connection that is already up (see `JoinGamePage.reloadSpectator`),
 * so a late track would reach nobody, silently. Silence frames cost a spectator nothing.
 */
@Injectable({
  providedIn: 'root'
})
export class MultiplayerAudioService {
  private source?: ScriptProcessorNode;
  private destination?: MediaStreamAudioDestinationNode;
  private track?: MediaStreamTrack;

  /**
   * The track to add to the stream before it is published, or null when the game has no
   * audio to offer. Null is not an error: audio is best-effort and the picture must still
   * go out without it.
   */
  capture(enabled: boolean): MediaStreamTrack | null {
    this.clear();

    const source = getDosAudioNode();
    if (!source) {
      console.warn('[AUDIO] The game has no audio node; hosting without sound.');
      return null;
    }

    // Typed as BaseAudioContext, which has neither of the two members used below. It is
    // js-dos's real AudioContext (an OfflineAudioContext has no use for a script processor).
    const ctx = source.context as AudioContext;
    const destination = ctx.createMediaStreamDestination();
    // js-dos output is mono, and the default of two channels would only up-mix it.
    destination.channelCount = 1;
    source.connect(destination);

    const track = destination.stream.getAudioTracks()[0];
    if (!track) {
      source.disconnect(destination);
      console.warn('[AUDIO] The destination produced no track; hosting without sound.');
      return null;
    }

    // A suspended context yields a silent track. js-dos resumes it on the first gesture,
    // which has long since happened by the time anyone hosts; this is only insurance.
    if (ctx.state === 'suspended') ctx.resume().catch(() => { });

    track.enabled = enabled;
    this.source = source;
    this.destination = destination;
    this.track = track;
    return track;
  }

  /** Live switch. A no-op when there is no track, which is the case for a host without audio. */
  setEnabled(enabled: boolean) {
    if (this.track) this.track.enabled = enabled;
  }

  /** Idempotent, and called by `MultiplayerService.leaveRoom()` like every other service here. */
  clear() {
    if (this.source && this.destination) {
      try {
        this.source.disconnect(this.destination);
      } catch {
        // The context was closed under us (js-dos does that on exit), taking the connection with it.
      }
    }
    this.track?.stop();
    this.source = undefined;
    this.destination = undefined;
    this.track = undefined;
  }
}

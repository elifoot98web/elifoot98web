import { MULTIPLAYER } from '../models/constants';

/**
 * What the spectator's waiting card says while it waits for the host's picture. The wait is up to 20 s
 * (`MULTIPLAYER.STREAM_WAIT_TIMEOUT`) and used to sit behind an `ion-loading` with no way out: a spectator who had mistyped the code,
 * or whose network was slow, could only stare at it. The card has a "Cancelar", and this is the line under the spinner.
 *
 * Nothing here knows why it is slow, because nothing can: a room nobody hosts, a wrong password and a mobile network that has not
 * connected yet all look like silence for the first twenty seconds. So the hint says what is true of all of them. Kept free of Angular so
 * it can be tested on plain values.
 */
export class JoinWaitHelper {

  static hint(elapsedMs: number): string | null {
    if (elapsedMs >= MULTIPLAYER.JOIN_LONG_HINT_AFTER_MS) {
      return 'Ainda tentando. Você pode cancelar, conferir o código e tentar de novo.';
    }
    if (elapsedMs >= MULTIPLAYER.JOIN_HINT_AFTER_MS) {
      return 'Redes móveis podem demorar um pouco mais.';
    }
    return null;
  }

  /** The line above the hint. A previous room still draining is named, because that is the one wait the spectator can do nothing about. */
  static title(input: { roomCode: string; draining: boolean }): string {
    if (input.draining) return 'Encerrando a sala anterior…';
    return input.roomCode ? `Entrando na sala ${input.roomCode}…` : 'Entrando na sala…';
  }
}

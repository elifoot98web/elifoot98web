/**
 * The host's room dialog in its short form: "Transmitir agora" and a line that says what that will do. The form had ten controls
 * (a name, a code and its generator, a password, six limits, eight colours and two buttons) on a 390x844 modal, for a person who
 * is on a phone and who, the second time, retypes nothing, because the name, the colour and the limit are all remembered. The
 * fields are still there, behind "Alterar"; a first-time host, who has no name yet, sees the name field and nothing else.
 *
 * Passwords are never stored, here or anywhere (a share link leaves its password out on purpose, and the same reasoning
 * applies harder to disk), so the summary says "sem senha" or "com senha" and never the word. Kept free of Angular so it can be
 * tested on plain values.
 */
export class QuickHostHelper {

  /** "ELI-XK3P · sem senha · até 6 espectadores": what pressing "Transmitir agora" will do. */
  static summary(room: { roomCode: string; hasPassword: boolean; maxSpectators: number }): string {
    return [
      room.roomCode.trim().toUpperCase(),
      room.hasPassword ? 'com senha' : 'sem senha',
      QuickHostHelper.limit(room.maxSpectators),
    ].join(' · ');
  }

  static limit(maxSpectators: number): string {
    return maxSpectators === 1 ? 'até 1 espectador' : `até ${maxSpectators} espectadores`;
  }

  /**
   * Whether the name has to be asked for on the first screen of the dialog. A remembered name is shown inside "Alterar"; without
   * one there is nothing to broadcast under, and the button could not be pressed.
   */
  static needsName(playerName: string): boolean {
    return playerName.trim().length === 0;
  }

  /**
   * The line that names the person who will appear in the room: "Você aparece como Leu". Empty while there is no name, when the name
   * field itself is on the screen.
   */
  static identity(playerName: string): string {
    const name = playerName.trim();
    return name ? `Você aparece como ${name}` : '';
  }
}

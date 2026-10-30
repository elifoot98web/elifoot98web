import { STORAGE_KEY } from '../models/constants';

/**
 * The settings that are stored as the OFF flag, and the one place that says what a stored value means on screen.
 *
 * Four keys were named for the thing they turn off, from the day each switch was written as "Desativar …": a key that is
 * absent (every install that never touched it) means the feature is ON, which is the default that matters. Two of them, the
 * smoothing and the game-save, were also LABELLED as the double negative ("Desativar Suavização": checked meant off), and the
 * menu now says them the way a person thinks ("Suavizar a imagem", "Salvar ao gravar o jogo": checked means on).
 *
 * **The stored keys did not change, on purpose.** Renaming `disableSmoothFilter` or `disableAutoSave`, or flipping what a stored
 * `true` means, would have needed a migration that reads the old key, writes the new one and deletes the old, and any visit that
 * fails between the write and the delete (a tab evicted mid-update, storage that rejects a write) leaves a player's choice
 * silently reversed: smoothing back on for the one who turned it off, or, worse, auto-save back OFF for one who had it on. Keeping
 * the keys makes the upgrade a no-op: a player who chose "Desativar Suavização" on the old build has `disableSmoothFilter: true`,
 * and the new build reads that as "Suavizar a imagem: desligado". Only the wording and the direction of the switch are new, and
 * this is where the direction lives, so the page's handlers cannot each invert it a different way.
 *
 * Kept free of Angular so it can be tested on plain values.
 */
export class InvertedSettingHelper {

  /**
   * Whether the feature is on, from what is stored under its "disable" key. Only a stored truthy value switches the feature off:
   * an absent key, `null` (what Ionic Storage answers for a key it never held), `false` and anything unreadable all mean "on",
   * the default every existing install has.
   */
  static isOn(storedDisable: unknown): boolean {
    return !storedDisable;
  }

  /** What to store for a switch that now says `on`: the OFF flag. */
  static toStored(on: boolean): boolean {
    return !on;
  }

  /**
   * The keys that are stored inverted, for the spec that pins them. The first two are the ones whose labels changed with this
   * helper; the vibration and the spectators' sound were already worded as a positive ("Vibração nas teclas", "Enviar o som do
   * jogo aos espectadores") over an inverted flag, and read through the same function now.
   */
  static readonly KEYS: readonly (keyof typeof STORAGE_KEY)[] = [
    'DISABLE_SMOOTH_FILTER',
    'DISABLE_AUTO_SAVE',
    'DISABLE_KEY_VIBRATION',
    'DISABLE_SPECTATOR_AUDIO',
  ];
}

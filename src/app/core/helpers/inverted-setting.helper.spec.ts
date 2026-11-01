import { STORAGE_KEY } from '../models/constants';
import { InvertedSettingHelper } from './inverted-setting.helper';

/**
 * The upgrade path is the whole point: "Suavizar a imagem" and "Salvar ao gravar o jogo" read keys that two earlier builds wrote as
 * "Desativar …", so a player who chose back then must see the same behaviour now, and a player who never chose must see the default.
 */
describe('InvertedSettingHelper', () => {

  describe('isOn (what a stored OFF flag means on screen)', () => {
    // Every value Ionic Storage can hand back for a key, written the way it comes.
    const table: Array<{ stored: unknown; on: boolean; why: string }> = [
      { stored: undefined, on: true, why: 'a key that was never written: the default, on' },
      { stored: null, on: true, why: 'what Ionic Storage answers for a missing key' },
      { stored: false, on: true, why: 'the player turned it back on' },
      { stored: true, on: false, why: 'the player turned it off on the old build ("Desativar …" checked)' },
      { stored: 0, on: true, why: 'a falsy value is not an OFF flag' },
      { stored: '', on: true, why: 'an empty string is not an OFF flag' },
    ];

    for (const row of table) {
      it(`${String(row.stored)} -> ${row.on ? 'on' : 'off'}: ${row.why}`, () => {
        expect(InvertedSettingHelper.isOn(row.stored)).toBe(row.on);
      });
    }
  });

  describe('toStored (what the switch writes)', () => {
    it('writes the OFF flag: a switch turned off stores true, one turned on stores false', () => {
      expect(InvertedSettingHelper.toStored(false)).toBe(true);
      expect(InvertedSettingHelper.toStored(true)).toBe(false);
    });

    it('round-trips: what a switch writes is read back as the same switch', () => {
      for (const on of [true, false]) {
        expect(InvertedSettingHelper.isOn(InvertedSettingHelper.toStored(on))).toBe(on);
      }
    });
  });

  describe('upgrading players keep their choice', () => {
    it('stores the choice under the key the old build used', () => {
      // A rename would orphan the old value: these strings are what every existing install holds.
      expect(STORAGE_KEY.DISABLE_SMOOTH_FILTER).toBe('disableSmoothFilter');
      expect(STORAGE_KEY.DISABLE_AUTO_SAVE).toBe('disableAutoSave');
      expect(STORAGE_KEY.PERIODIC_SAVE).toBe('autoSave');
      expect(STORAGE_KEY.DISABLE_KEY_VIBRATION).toBe('disableKeyVibration');
      expect(STORAGE_KEY.DISABLE_SPECTATOR_AUDIO).toBe('disableSpectatorAudio');
    });

    it('a player who ticked "Desativar Suavização" sees "Suavizar a imagem" off, and one who ticked "Desativar Sync Save" sees "Salvar ao gravar o jogo" off', () => {
      const oldBuildStored = { disableSmoothFilter: true, disableAutoSave: true };
      expect(InvertedSettingHelper.isOn(oldBuildStored.disableSmoothFilter)).toBe(false);
      expect(InvertedSettingHelper.isOn(oldBuildStored.disableAutoSave)).toBe(false);
    });

    it('a player who never touched either sees both on', () => {
      expect(InvertedSettingHelper.isOn(undefined)).toBe(true);
      expect(InvertedSettingHelper.isOn(null)).toBe(true);
    });

    it('"Salvar a cada 5 min" is NOT inverted: its key already stores on as true', () => {
      // `autoSave` is the periodic save's key, true when it is on. It only changed its words.
      expect(InvertedSettingHelper.KEYS).not.toContain('PERIODIC_SAVE');
    });

    it('lists every key that stores the OFF flag, each of them a real STORAGE_KEY', () => {
      expect([...InvertedSettingHelper.KEYS].sort()).toEqual([
        'DISABLE_AUTO_SAVE', 'DISABLE_KEY_VIBRATION', 'DISABLE_SMOOTH_FILTER', 'DISABLE_SPECTATOR_AUDIO',
      ]);
      for (const name of InvertedSettingHelper.KEYS) {
        expect(STORAGE_KEY[name]).toEqual(jasmine.any(String));
        expect(name.startsWith('DISABLE_')).toBe(true);
      }
    });
  });
});

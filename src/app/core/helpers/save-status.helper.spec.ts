import { SAVE_SAFETY } from '../models/constants';
import { EMPTY_SAVE_STATUS, SaveStatusHelper, SaveStatusSnapshot } from './save-status.helper';

describe('SaveStatusHelper', () => {
  // Local-time dates, because the words are the device's local time.
  const at = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute, 30).getTime();
  const NOW = at(28, 14, 40);
  const status = (patch: Partial<SaveStatusSnapshot>): SaveStatusSnapshot => ({ ...EMPTY_SAVE_STATUS, ...patch });

  it('says "Salvo às 14:32" for a save made today', () => {
    const view = SaveStatusHelper.describe(status({ lastPersistedAt: at(28, 14, 32) }), NOW);

    expect(view.text).toBe('Salvo às 14:32');
    expect(view.tone).toBe('ok');
  });

  it('zero-pads the clock', () => {
    expect(SaveStatusHelper.describe(status({ lastPersistedAt: at(28, 9, 5) }), NOW).text).toBe('Salvo às 09:05');
  });

  it('names yesterday, and the date for anything older', () => {
    expect(SaveStatusHelper.describe(status({ lastPersistedAt: at(27, 21, 14) }), NOW).text).toBe('Salvo ontem 21:14');
    expect(SaveStatusHelper.describe(status({ lastPersistedAt: at(20, 21, 14) }), NOW).text).toBe('Salvo em 20/10 21:14');
  });

  it('treats the day before the first of the month as yesterday', () => {
    const now = new Date(2026, 10, 1, 9, 0).getTime();
    expect(SaveStatusHelper.describe(status({ lastPersistedAt: new Date(2026, 9, 31, 22, 15).getTime() }), now).text).toBe('Salvo ontem 22:15');
  });

  it('is neutral before anything has been saved', () => {
    const view = SaveStatusHelper.describe(status({}), NOW);

    expect(view.text).toBe('Ainda não salvo');
    expect(view.tone).toBe('idle');
  });

  it('says "Salvando…" while a persist runs, over everything else', () => {
    const view = SaveStatusHelper.describe(status({ persisting: true, persistFailed: true, dirty: true, dirtySince: NOW - 3_600_000, lastPersistedAt: at(28, 8, 0) }), NOW);

    expect(view.text).toBe('Salvando…');
    expect(view.tone).toBe('busy');
  });

  it('warns when the last persist failed and none has worked since', () => {
    const view = SaveStatusHelper.describe(status({ persistFailed: true, lastPersistedAt: at(28, 14, 0) }), NOW);

    expect(view.text).toBe('Falha ao salvar');
    expect(view.tone).toBe('warn');
  });

  it('keeps saying "Salvo" for input younger than the warning age, because most clicks change nothing', () => {
    const view = SaveStatusHelper.describe(
      status({ lastPersistedAt: at(28, 14, 32), dirty: true, dirtySince: NOW - SAVE_SAFETY.UNSAVED_WARNING_AFTER_MS + 1 }), NOW);

    expect(view.text).toBe('Salvo às 14:32');
    expect(view.tone).toBe('ok');
  });

  it('turns into a warning once unsaved input is old enough, counting from the first input', () => {
    const view = SaveStatusHelper.describe(
      status({ lastPersistedAt: at(28, 8, 0), dirty: true, dirtySince: NOW - 12 * 60_000 - 5_000 }), NOW);

    expect(view.text).toBe('Sem salvar há 12 min');
    expect(view.tone).toBe('warn');
  });

  it('says hours once it has been an hour', () => {
    expect(SaveStatusHelper.age(59 * 60_000)).toBe('59 min');
    expect(SaveStatusHelper.age(60 * 60_000)).toBe('1 h');
    expect(SaveStatusHelper.age(3 * 3_600_000 + 20 * 60_000)).toBe('3 h');
  });

  it('warns about unsaved input even before the first save of all', () => {
    const view = SaveStatusHelper.describe(status({ dirty: true, dirtySince: NOW - 11 * 60_000 }), NOW);

    expect(view.text).toBe('Sem salvar há 11 min');
  });

  it('gives a screen reader the words and what a tap does', () => {
    expect(SaveStatusHelper.describe(status({ lastPersistedAt: at(28, 14, 32) }), NOW).label).toBe('Salvo às 14:32. Toque para salvar agora.');
    expect(SaveStatusHelper.describe(status({ persisting: true }), NOW).label).toBe('Salvando o jogo no navegador.');
  });
});

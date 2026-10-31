import { EMULATOR_RAM_SIZE, MEMORY_SEARCH_PARAMS } from '../../models/constants';
import { DosCI } from '../../typings/jsdos';
import { CheatOmaticService } from './cheat-omatic.service';

/**
 * The O Matic talks to the guest for as long as a sweep of its 8 MB takes, and a battery saver that
 * put the guest to sleep in the middle of it (EmulatorPowerService) would be sweeping a machine that
 * was not running. Only that is specced: the door it holds the guest awake through, in the order
 * that matters. The search itself has no spec yet.
 */
describe('CheatOmaticService and the sleeping guest', () => {
  let calls: string[];

  beforeEach(() => {
    calls = [];
    globalThis.holdGuestAwake = reason => {
      calls.push(`hold ${reason}`);
      return () => calls.push('release');
    };
  });

  afterEach(() => {
    globalThis.holdGuestAwake = undefined;
  });

  /** An emulator whose memory is all zeros and which says what it was asked, in the same list as the door. */
  function emulator(options: { failRead?: boolean; failWrite?: boolean } = {}) {
    return {
      readMemory: async (address: number, length: number) => {
        calls.push(`read ${address}`);
        if (options.failRead) throw new Error('worker gone');
        return new Uint8Array(length);
      },
      writeMemory: async (address: number) => {
        calls.push(`write ${address}`);
        if (options.failWrite) throw new Error('worker gone');
      },
    } as unknown as DosCI;
  }

  it('holds the guest awake for the whole sweep and lets go when it is over', async () => {
    const service = new CheatOmaticService();
    service.resetSearch(emulator());
    service.inputValue = '7';

    await service.firstSearch();

    const sweeps = Math.ceil(EMULATOR_RAM_SIZE / MEMORY_SEARCH_PARAMS.CHUNK_SIZE);
    expect(calls[0]).toBe('hold omatic search');
    expect(calls.filter(call => call.startsWith('read')).length).toBe(sweeps);
    expect(calls[calls.length - 1]).toBe('release');
    expect(calls.filter(call => call === 'release').length).toBe(1);
  });

  it('lets go of the guest when a read fails', async () => {
    const service = new CheatOmaticService();
    service.resetSearch(emulator({ failRead: true }));
    service.inputValue = '7';

    await service.firstSearch().then(() => undefined, () => undefined);

    expect(calls[0]).toBe('hold omatic search');
    expect(calls[calls.length - 1]).toBe('release');
  });

  it('holds the guest awake around a write, which it would not see until it woke, and lets go', async () => {
    const service = new CheatOmaticService();
    service.resetSearch(emulator());
    service.setMatchDirectly('0x1000');
    service.inputValue = '9';

    await service.setValue();

    expect(calls).toEqual(['hold omatic write', 'write 4096', 'release']);
  });

  it('lets go of the guest when a write fails', async () => {
    spyOn(console, 'error');
    const service = new CheatOmaticService();
    service.resetSearch(emulator({ failWrite: true }));
    service.setMatchDirectly('0x1000');
    service.inputValue = '9';

    await service.setValue().then(() => undefined, () => undefined);

    expect(calls).toEqual(['hold omatic write', 'write 4096', 'release']);
  });

  it('asks nothing of the door when there is nothing to write', async () => {
    const service = new CheatOmaticService();
    service.resetSearch(emulator());
    service.inputValue = '9';

    await service.setValue().then(() => undefined, () => undefined);

    expect(calls).toEqual([]);
  });
});

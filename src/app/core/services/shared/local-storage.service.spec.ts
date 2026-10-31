import { STORAGE_KEY } from '../../models/constants';
import { LocalStorageService } from './local-storage.service';

describe('LocalStorageService.clearAllData', () => {
  afterEach(() => localStorage.removeItem(STORAGE_KEY.DIAGNOSTICS_LOG));

  const build = () => {
    const ionic = { create: jasmine.createSpy('create').and.resolveTo(undefined), clear: jasmine.createSpy('clear').and.resolveTo(undefined) };
    return { service: new LocalStorageService(ionic as never), ionic };
  };

  it('empties Ionic Storage', async () => {
    const { service, ionic } = build();

    await service.clearAllData();

    expect(ionic.clear).toHaveBeenCalledTimes(1);
  });

  it('also removes the diagnostics log\'s copy in localStorage, which Ionic Storage does not know about', async () => {
    localStorage.setItem(STORAGE_KEY.DIAGNOSTICS_LOG, '{"v":1}');
    localStorage.setItem('somebody else\'s key', 'kept');
    const { service } = build();

    await service.clearAllData();

    expect(localStorage.getItem(STORAGE_KEY.DIAGNOSTICS_LOG)).toBeNull();
    expect(localStorage.getItem('somebody else\'s key')).toBe('kept');
    localStorage.removeItem('somebody else\'s key');
  });

  it('still clears Ionic Storage when localStorage is blocked', async () => {
    const { service, ionic } = build();
    const remove = spyOn(Storage.prototype, 'removeItem').and.throwError('SecurityError');

    await expectAsync(service.clearAllData()).toBeResolved();

    expect(ionic.clear).toHaveBeenCalled();
    // The afterEach above removes a key too, and runs before jasmine puts the spy back.
    remove.and.callThrough();
  });
});

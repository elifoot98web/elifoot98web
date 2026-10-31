import { StorageHealthHelper, UNKNOWN_STORAGE } from './storage-health.helper';

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('StorageHealthHelper', () => {
  describe('bytes', () => {
    it('writes the unit that reads best, with a comma, as Portuguese does', () => {
      expect(StorageHealthHelper.bytes(0)).toBe('0 B');
      expect(StorageHealthHelper.bytes(900)).toBe('900 B');
      expect(StorageHealthHelper.bytes(1024)).toBe('1 KB');
      expect(StorageHealthHelper.bytes(5.4 * MB)).toBe('5,4 MB');
      expect(StorageHealthHelper.bytes(14.2 * MB)).toBe('14,2 MB');
      expect(StorageHealthHelper.bytes(1.9 * GB)).toBe('1,9 GB');
    });

    it('does not make a figure up', () => {
      expect(StorageHealthHelper.bytes(null)).toBe('?');
      expect(StorageHealthHelper.bytes(NaN)).toBe('?');
      expect(StorageHealthHelper.bytes(-5)).toBe('?');
    });
  });

  describe('protection: only what the browser said', () => {
    it('reports yes, no and "unknown" as three different things', () => {
      expect(StorageHealthHelper.protection(true)).toBe('Protegido');
      expect(StorageHealthHelper.protection(false)).toBe('Não protegido');
      expect(StorageHealthHelper.protection(null)).toBe('Proteção desconhecida');
    });
  });

  describe('summary', () => {
    it('puts the protection and the use on one line', () => {
      expect(StorageHealthHelper.summary({ persisted: true, usage: 14.2 * MB, quota: 1.9 * GB })).toBe('Protegido · 14,2 MB de 1,9 GB em uso');
      expect(StorageHealthHelper.summary({ persisted: false, usage: 5 * MB, quota: 2 * GB })).toBe('Não protegido · 5,0 MB de 2,0 GB em uso');
    });

    it('says what it knows when the browser leaves something out', () => {
      expect(StorageHealthHelper.summary({ persisted: true, usage: null, quota: null })).toBe('Protegido');
      expect(StorageHealthHelper.summary({ persisted: null, usage: 3 * MB, quota: null })).toBe('3,0 MB em uso');
      expect(StorageHealthHelper.summary({ persisted: null, usage: 3 * MB, quota: 1 * GB })).toBe('3,0 MB de 1,0 GB em uso');
    });

    it('says the browser does not say, when it says nothing', () => {
      expect(StorageHealthHelper.summary(UNKNOWN_STORAGE)).toBe('O navegador não informa o armazenamento.');
    });
  });

  describe('warning', () => {
    it('warns only when the browser declined to protect the data, and then points at the backup', () => {
      expect(StorageHealthHelper.warning(false)).toContain('pode apagar');
      expect(StorageHealthHelper.warning(false)).toContain('backup');
      expect(StorageHealthHelper.warning(true)).toBeNull();
      expect(StorageHealthHelper.warning(null)).toBeNull();
    });

    it('never promises protection', () => {
      for (const persisted of [true, false, null]) {
        const words = `${StorageHealthHelper.protection(persisted)} ${StorageHealthHelper.warning(persisted) ?? ''}`;
        expect(words).not.toMatch(/garant|seguro|nunca/i);
      }
    });
  });
});

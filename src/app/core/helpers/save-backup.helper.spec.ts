import JSZip from 'jszip';
import { BASE_SAVEGAME_DIR } from '../models/constants';
import { BackupInput, SaveBackupHelper } from './save-backup.helper';

const text = (value: string) => new TextEncoder().encode(value);
const asText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** A changes layer shaped like the one `dosCI.persist()` returns: the disk image, the game, the saves. */
async function layer(entries: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('hdd.img', new Uint8Array([1, 2, 3]));
  zip.file('d/eli98/ELIFOOT.INI', 'not a save');
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  return zip.generateAsync({ type: 'uint8array' });
}

async function zipOf(entries: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  return zip.generateAsync({ type: 'uint8array' });
}

const input = (name: string, data: Uint8Array | string): BackupInput => ({ name, data: typeof data === 'string' ? text(data) : data });

describe('SaveBackupHelper', () => {
  describe('the backup the app writes is one the app reads', () => {
    it('gives back every save, byte for byte', async () => {
      const disk = await layer({
        [`${BASE_SAVEGAME_DIR}MEUJOGO.E98`]: 'primeiro jogo',
        [`${BASE_SAVEGAME_DIR}OUTRO.E98`]: 'segundo jogo, com acentos: João, Açores',
      });

      const backup = await SaveBackupHelper.build(disk);
      expect(backup).not.toBeNull();
      expect(backup!.names.sort()).toEqual(['MEUJOGO.E98', 'OUTRO.E98']);

      const reading = await SaveBackupHelper.read([input(SaveBackupHelper.backupFileName(new Date()), backup!.bytes)]);

      expect(reading.unreadable).toEqual([]);
      expect(reading.ignored).toEqual([]);
      const byName = new Map(reading.saves.map(save => [save.name, asText(save.data)]));
      expect(byName.get('MEUJOGO.E98')).toBe('primeiro jogo');
      expect(byName.get('OUTRO.E98')).toBe('segundo jogo, com acentos: João, Açores');
      expect(reading.saves.length).toBe(2);
    });

    it('leaves out everything in the layer that is not a save game', async () => {
      const backup = await SaveBackupHelper.build(await layer({
        [`${BASE_SAVEGAME_DIR}A.E98`]: 'save',
        [`${BASE_SAVEGAME_DIR}DRLIST.ELI`]: 'not a save either',
        'd/eli98/OUTRA/B.E98': 'a .e98 outside the saves folder',
      }));

      const zip = await JSZip.loadAsync(backup!.bytes);
      expect(Object.keys(zip.files)).toEqual(['A.E98']);
    });

    it('finds saves whatever the case the disk gave their names', async () => {
      const backup = await SaveBackupHelper.build(await layer({ [`D/ELI98/JOGOS/Meu.e98`]: 'x' }));

      expect(backup!.names).toEqual(['MEU.E98']);
    });

    it('is null when the layer has no save, so the caller can say so', async () => {
      expect(await SaveBackupHelper.build(await layer({}))).toBeNull();
    });

    it('is smaller than what it holds: it is compressed', async () => {
      const big = 'abc'.repeat(20000);
      const backup = await SaveBackupHelper.build(await layer({ [`${BASE_SAVEGAME_DIR}A.E98`]: big }));

      expect(backup!.bytes.byteLength).toBeLessThan(big.length / 4);
    });
  });

  describe('read', () => {
    it('takes single .e98 files in any letter case and stores their names upper-cased', async () => {
      const reading = await SaveBackupHelper.read([input('meu jogo.e98', 'a'), input('Outro.E98', 'b')]);

      expect(reading.saves.map(save => save.name)).toEqual(['MEU JOGO.E98', 'OUTRO.E98']);
    });

    it('takes several zips and files at once', async () => {
      const reading = await SaveBackupHelper.read([
        input('um.zip', await zipOf({ 'A.E98': 'a' })),
        input('B.E98', 'b'),
        input('dois.ZIP', await zipOf({ 'C.E98': 'c', 'D.E98': 'd' })),
      ]);

      expect(reading.saves.map(save => save.name).sort()).toEqual(['A.E98', 'B.E98', 'C.E98', 'D.E98']);
    });

    it('takes a save from anywhere inside a zip, so the full-disk copy restores its saves too', async () => {
      const reading = await SaveBackupHelper.read([
        input('fullDiskChanges.zip', await layer({ [`${BASE_SAVEGAME_DIR}JOGO.E98`]: 'dados' })),
      ]);

      expect(reading.saves.map(save => save.name)).toEqual(['JOGO.E98']);
      expect(asText(reading.saves[0].data)).toBe('dados');
    });

    it('ignores the shadow copies a Mac puts in a zip', async () => {
      const reading = await SaveBackupHelper.read([
        input('mac.zip', await zipOf({ 'JOGO.E98': 'real', '__MACOSX/._JOGO.E98': 'shadow', '._OUTRO.E98': 'shadow' })),
      ]);

      expect(reading.saves.map(save => save.name)).toEqual(['JOGO.E98']);
    });

    it('flattens paths, backslashes included', async () => {
      const reading = await SaveBackupHelper.read([input('C:\\Users\\leu\\saves\\JOGO.E98', 'x'), input('pasta/dentro/OUTRO.E98', 'y')]);

      expect(reading.saves.map(save => save.name)).toEqual(['JOGO.E98', 'OUTRO.E98']);
    });

    it('reports what it left out, without failing', async () => {
      const reading = await SaveBackupHelper.read([
        input('JOGO.E98', 'ok'),
        input('notas.txt', 'nope'),
        input('vazio.e98', new Uint8Array(0)),
        input('quebrado.zip', 'isto não é um zip'),
      ]);

      expect(reading.saves.map(save => save.name)).toEqual(['JOGO.E98']);
      expect(reading.ignored).toEqual(['notas.txt', 'vazio.e98']);
      expect(reading.unreadable).toEqual(['quebrado.zip']);
    });

    it('keeps the later of two saves with the same DOS name and says there were two', async () => {
      const reading = await SaveBackupHelper.read([input('JOGO.E98', 'velho'), input('pasta/jogo.e98', 'novo')]);

      expect(reading.saves.length).toBe(1);
      expect(asText(reading.saves[0].data)).toBe('novo');
      expect(reading.repeated).toEqual(['JOGO.E98']);
    });

    it('is empty for an empty selection', async () => {
      const reading = await SaveBackupHelper.read([]);

      expect(reading.saves).toEqual([]);
    });

    it('finds nothing in a zip with no save in it', async () => {
      const reading = await SaveBackupHelper.read([input('vazio.zip', await zipOf({ 'leiame.txt': 'oi' }))]);

      expect(reading.saves).toEqual([]);
      expect(reading.unreadable).toEqual([]);
    });
  });

  describe('overwrites', () => {
    const saves = [
      { name: 'A.E98', data: new Uint8Array(1), source: 'x' },
      { name: 'B.E98', data: new Uint8Array(1), source: 'x' },
    ];

    it('flags the saves the game already has, whatever the case', () => {
      expect(SaveBackupHelper.overwrites(saves, ['b.e98', 'C.E98'])).toEqual(['B.E98']);
    });

    it('flags nothing when nothing collides', () => {
      expect(SaveBackupHelper.overwrites(saves, [])).toEqual([]);
    });

    it('accepts the existing names with a path on them', () => {
      expect(SaveBackupHelper.overwrites(saves, [`${BASE_SAVEGAME_DIR}A.E98`])).toEqual(['A.E98']);
    });

    it('lists what a layer already holds', async () => {
      const names = await SaveBackupHelper.existingNames(await layer({
        [`${BASE_SAVEGAME_DIR}Um.e98`]: 'x',
        [`${BASE_SAVEGAME_DIR}DRLIST.ELI`]: 'x',
      }));

      expect(names).toEqual(['UM.E98']);
    });
  });

  describe('importMessage', () => {
    const save = (name: string) => ({ name, data: new Uint8Array(1), source: 'x' });

    it('lists what will be added when nothing is replaced', () => {
      const message = SaveBackupHelper.importMessage([save('A.E98'), save('B.E98')], []);

      expect(message).toContain('2 jogos salvos serão adicionados:');
      expect(message).toContain('• A.E98');
      expect(message).not.toContain('substitui');
    });

    it('flags the replacements and lists them first', () => {
      const message = SaveBackupHelper.importMessage([save('A.E98'), save('B.E98'), save('C.E98')], ['C.E98']);

      expect(message).toContain('3 jogos salvos, 1 deles substitui um que já existe:');
      expect(message.indexOf('• C.E98 (substitui o atual)')).toBeLessThan(message.indexOf('• A.E98'));
    });

    it('says it right for one, and for how many are replaced', () => {
      expect(SaveBackupHelper.importMessage([save('A.E98')], [])).toContain('1 jogo salvo será adicionado:');
      expect(SaveBackupHelper.importMessage([save('A.E98')], ['A.E98'])).toContain('1 jogo salvo substitui um que já existe:');
      expect(SaveBackupHelper.importMessage([save('A.E98'), save('B.E98'), save('C.E98')], ['A.E98', 'B.E98']))
        .toContain('3 jogos salvos, 2 deles substituem outros que já existem:');
      expect(SaveBackupHelper.importMessage([save('A.E98'), save('B.E98')], ['A.E98', 'B.E98']))
        .toContain('2 jogos salvos substituem outros que já existem:');
    });

    it('cuts a long list so the buttons stay on a phone', () => {
      const many = Array.from({ length: 12 }, (_, i) => save(`J${String(i).padStart(2, '0')}.E98`));
      const message = SaveBackupHelper.importMessage(many, [], 8);

      expect(message.split('\n').filter(line => line.startsWith('• ')).length).toBe(8);
      expect(message).toContain('… e mais 4');
    });

    it('warns that the game restarts', () => {
      expect(SaveBackupHelper.importMessage([save('A.E98')], [])).toContain('O jogo será reiniciado');
    });
  });

  describe('skippedMessage', () => {
    it('is empty when nothing was left out', () => {
      expect(SaveBackupHelper.skippedMessage({ ignored: [], unreadable: [] })).toBe('');
    });

    it('names the files left out and why', () => {
      const message = SaveBackupHelper.skippedMessage({ ignored: ['a.txt'], unreadable: ['b.zip'] });

      expect(message).toContain('Não foi possível abrir: b.zip.');
      expect(message).toContain('Ignorado (não é um jogo salvo): a.txt.');
    });
  });

  describe('file names', () => {
    it('zero-pads every field and counts the months from 1', () => {
      // October, the month that used to be stamped as "9".
      const date = new Date(2026, 9, 5, 4, 3, 2);

      expect(SaveBackupHelper.fileStamp(date)).toBe('2026-10-05_04-03-02');
      expect(SaveBackupHelper.backupFileName(date)).toBe('elifoot98_saves_2026-10-05_04-03-02.zip');
    });

    it('stamps the last month of the year as 12', () => {
      expect(SaveBackupHelper.fileStamp(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31_23-59-59');
    });
  });

  describe('canShareFile', () => {
    const file = new File(['x'], 'a.zip', { type: 'application/zip' });

    it('needs share() and canShare() and a yes from canShare for files', () => {
      expect(SaveBackupHelper.canShareFile({ share: async () => undefined, canShare: () => true }, file)).toBeTrue();
    });

    it('is no when the browser can share links but not files', () => {
      expect(SaveBackupHelper.canShareFile({ share: async () => undefined, canShare: () => false }, file)).toBeFalse();
    });

    it('is no when either function is missing (desktop Firefox, an older Safari)', () => {
      expect(SaveBackupHelper.canShareFile({}, file)).toBeFalse();
      expect(SaveBackupHelper.canShareFile({ canShare: () => true }, file)).toBeFalse();
      expect(SaveBackupHelper.canShareFile({ share: async () => undefined }, file)).toBeFalse();
    });

    it('is no, not an error, when canShare throws', () => {
      expect(SaveBackupHelper.canShareFile({ share: async () => undefined, canShare: () => { throw new TypeError('bad'); } }, file)).toBeFalse();
    });

    it('hands canShare the file it is asked about', () => {
      const canShare = jasmine.createSpy('canShare').and.returnValue(true);

      SaveBackupHelper.canShareFile({ share: async () => undefined, canShare }, file);

      expect(canShare).toHaveBeenCalledWith({ files: [file] });
    });
  });
});

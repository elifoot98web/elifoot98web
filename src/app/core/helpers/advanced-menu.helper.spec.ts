import { AdvancedContext, AdvancedEntryId, AdvancedGroupId, AdvancedMenuHelper } from './advanced-menu.helper';

function context(overrides: Partial<AdvancedContext> = {}): AdvancedContext {
  return {
    inRoom: false,
    debug: false,
    cameraOffered: true,
    values: { autosaveGame: true, autosavePeriodic: false, liveKeyboard: false, idlePause: false, camera: false },
    idleSeconds: 20,
    storage: { summary: 'Protegido pelo navegador · 5,4 MB de 4 GB', warning: null },
    diagnosticsSummary: 'Desligado',
    ...overrides,
  };
}

const groups = (overrides: Partial<AdvancedContext> = {}) => AdvancedMenuHelper.groups(context(overrides));
const entries = (overrides: Partial<AdvancedContext> = {}) => AdvancedMenuHelper.entries(groups(overrides));
const find = (id: AdvancedEntryId, overrides: Partial<AdvancedContext> = {}) => entries(overrides).find(entry => entry.id === id);

describe('AdvancedMenuHelper', () => {

  describe('the order of the window', () => {
    it('goes from what is safe to what is not: backup, the save switches, patches, tools, the experiments, the danger zone', () => {
      const order: AdvancedGroupId[] = ['backup', 'autosave', 'patch', 'tools', 'experimental', 'danger'];
      expect(groups().map(group => group.id)).toEqual(order);
    });

    it('ends with the danger zone, alone, and the wipe is the only danger in the window', () => {
      const all = groups();
      const last = all[all.length - 1];
      expect(last.id).toBe('danger');
      expect(last.danger).toBeTrue();
      expect(last.entries.map(entry => entry.id)).toEqual(['wipe']);
      expect(entries().filter(entry => entry.danger).map(entry => entry.id)).toEqual(['wipe']);
      expect(all.filter(group => group.danger).length).toBe(1);
    });

    it('offers the backup before it offers the wipe, in the window as well as in the wipe\'s own dialog', () => {
      const ids = entries().map(entry => entry.id);
      expect(ids.indexOf('export')).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf('export')).toBeLessThan(ids.indexOf('wipe'));
    });

    it('lists no row twice', () => {
      const ids = entries({ debug: true }).map(entry => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('gives every group a "?" and every row a sentence about what it does', () => {
      for (const group of groups({ debug: true })) {
        expect(group.help).toBeDefined();
        for (const entry of group.entries) expect(entry.description.length).toBeGreaterThan(10);
      }
    });
  });

  describe('the positive wording', () => {
    it('words the two save switches as what is on', () => {
      expect(find('autosave-game')?.label).toBe('Salvar ao gravar o jogo');
      expect(find('autosave-periodic')?.label).toBe('Salvar a cada 5 min');
    });

    it('titles the group "Salvamento automático", not "Auto-Save"', () => {
      expect(groups().find(group => group.id === 'autosave')?.title).toBe('Salvamento automático');
    });

    it('shows a switch checked when its feature is on', () => {
      expect(find('autosave-game')?.checked).toBeTrue();
      expect(find('autosave-game', { values: { ...context().values, autosaveGame: false } })?.checked).toBeFalse();
      expect(find('autosave-periodic', { values: { ...context().values, autosavePeriodic: true } })?.checked).toBeTrue();
    });

    it('starts no label with "Desativar"', () => {
      for (const entry of entries({ debug: true })) expect(entry.label.startsWith('Desativar')).toBeFalse();
    });
  });

  describe('a room is live', () => {
    const reloaders: AdvancedEntryId[] = ['import', 'patch-load', 'patch-remove', 'wipe'];

    it('disables everything that ends in a reload, with the reason, because the reload would end the room for everyone watching', () => {
      for (const id of reloaders) {
        expect(find(id, { inRoom: true })?.disabled).withContext(id).toBeTrue();
        expect(find(id, { inRoom: true })?.reason).withContext(id).toBe(AdvancedMenuHelper.ROOM_REASON);
        expect(find(id)?.disabled).withContext(`${id} without a room`).toBeFalsy();
      }
    });

    it('leaves the rest alone: the backup, the switches and the tools work in a room', () => {
      for (const id of ['export', 'autosave-game', 'autosave-periodic', 'omatic', 'diagnostics', 'live-keyboard', 'idle-pause'] as AdvancedEntryId[]) {
        expect(find(id, { inRoom: true })?.disabled).withContext(id).toBeFalsy();
      }
    });
  });

  describe('what the device can use', () => {
    it('shows the developer\'s disk copy only while the diagnostics are on', () => {
      expect(find('disk-copy')).toBeUndefined();
      expect(find('disk-copy', { debug: true })).toBeDefined();
    });

    it('shows the camera switch only where a finger is the pointer', () => {
      expect(find('camera')).toBeDefined();
      expect(find('camera', { cameraOffered: false })).toBeUndefined();
    });

    it('keeps the camera, the live keyboard and the battery saver together under the experiments, with the caveat said once', () => {
      const experimental = groups().find(group => group.id === 'experimental');
      expect(experimental?.entries.map(entry => entry.id)).toEqual(['live-keyboard', 'idle-pause', 'camera']);
      expect(experimental?.intro).toContain('Ainda não foram testados em celulares de verdade');
    });

    it('quotes the idle time in the battery saver\'s description, so a change of the constant reaches the words', () => {
      expect(find('idle-pause', { idleSeconds: 45 })?.description).toContain('45 segundos');
    });
  });

  describe('the tools', () => {
    it('close the window before they open, because they are used over the game', () => {
      expect(find('omatic')?.closes).toBeTrue();
      expect(find('diagnostics')?.closes).toBeTrue();
    });

    it('leave the window open for the rows that finish by themselves', () => {
      for (const id of ['export', 'import', 'patch-load', 'autosave-game', 'wipe'] as AdvancedEntryId[]) {
        expect(find(id)?.closes).withContext(id).toBeFalsy();
      }
    });

    it('says whether the diagnostics are on without opening them', () => {
      expect(find('diagnostics', { diagnosticsSummary: 'Ligado · 12 eventos' })?.description).toContain('Ligado · 12 eventos');
    });
  });

  describe('the storage line', () => {
    it('says the figures, and the warning after them when the browser may clear the data', () => {
      const line = find('storage', { storage: { summary: 'Não protegido · 5,4 MB', warning: 'O navegador pode apagar estes dados.' } });
      expect(line?.kind).toBe('info');
      expect(line?.description).toBe('Não protegido · 5,4 MB. O navegador pode apagar estes dados.');
    });

    it('says it is looking until the browser answers', () => {
      expect(find('storage', { storage: { summary: null, warning: null } })?.description).toBe('Verificando…');
    });
  });
});

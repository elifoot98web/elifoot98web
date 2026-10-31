import { HelpTopic } from './help-topic.helper';

export type AdvancedGroupId = 'backup' | 'autosave' | 'patch' | 'tools' | 'experimental' | 'danger';

export type AdvancedEntryId =
  | 'storage' | 'export' | 'import'
  | 'autosave-game' | 'autosave-periodic'
  | 'patch-load' | 'patch-remove'
  | 'omatic' | 'diagnostics' | 'disk-copy'
  | 'live-keyboard' | 'idle-pause' | 'camera'
  | 'wipe';

/** `info` is a line of text with a label (the storage figures); the others are what they say. */
export type AdvancedEntryKind = 'info' | 'action' | 'toggle';

export interface AdvancedEntry {
  id: AdvancedEntryId;
  kind: AdvancedEntryKind;
  label: string;
  /** What it does, in a sentence. Every row says it, because the window is where the rare things live and nobody remembers them. */
  description: string;
  /** A toggle's state, in the positive: checked means the thing is on. */
  checked?: boolean;
  disabled?: boolean;
  /** Why it is disabled, said where the description is. */
  reason?: string;
  /** The wipe. The only row in the window that cannot be taken back, and it is in a group of its own. */
  danger?: boolean;
  /** The row opens a window of its own, so this one closes first (the O Matic and the diagnostics are tools to use over the game). */
  closes?: boolean;
}

export interface AdvancedGroup {
  id: AdvancedGroupId;
  title: string;
  /** A sentence under the title, for a group whose rows share a caveat. */
  intro?: string;
  entries: AdvancedEntry[];
  /** The "?" in the group's title opens the guide here. */
  help: HelpTopic;
  /** The group is fenced off from the others (its own box, its own colour). */
  danger?: boolean;
}

export interface AdvancedContext {
  /** A room is live: whatever ends in a reload would end it for everyone watching. */
  inRoom: boolean;
  /** The diagnostics are on, which is also what shows the developer's disk copy. */
  debug: boolean;
  /** The in-app camera is something this device can use (a finger is the pointer). */
  cameraOffered: boolean;
  values: {
    autosaveGame: boolean;
    autosavePeriodic: boolean;
    liveKeyboard: boolean;
    idlePause: boolean;
    camera: boolean;
  };
  /** How long a still screen has to stay still before the battery saver acts; the description quotes it. */
  idleSeconds: number;
  /** What the browser says about this site's storage; null until it has answered. */
  storage: { summary: string | null; warning: string | null };
  /** "Desligado" or "Ligado · 12 eventos": the diagnostics' state, so the row answers without opening the window. */
  diagnosticsSummary: string;
}

/**
 * "Dados e avançado": the rows that are not for every visit. Backup and restore, the two save switches, patches, the Cheat 'O Matic
 * and the diagnostics, the three experiments, and the wipe, which is the one thing here that cannot be taken back. They used to be
 * rows 4 to 13 of one popover, the wipe directly under "Importar jogos salvos", and a thumb that slipped landed on a confirmation
 * whose "Sim" looked like every other one (DANGER-1).
 *
 * The window is the options sheet's second tier: the sheet has one row that opens it ("Dados e avançado"), and nothing in this
 * model is in the sheet (menu.helper.spec.ts pins that), so a row cannot live in both. The groups are ordered by risk: what is safe
 * to press first, the experiments next, and the wipe last, alone, in a box of its own.
 *
 * Kept free of Angular so it can be tested on plain values.
 */
export class AdvancedMenuHelper {

  /** The line a disabled row gives for a room that is live. */
  static readonly ROOM_REASON = 'Encerre a sala para usar.';

  static groups(c: AdvancedContext): AdvancedGroup[] {
    const groups: AdvancedGroup[] = [
      AdvancedMenuHelper.backupGroup(c),
      AdvancedMenuHelper.autosaveGroup(c),
      AdvancedMenuHelper.patchGroup(c),
      AdvancedMenuHelper.toolsGroup(c),
      AdvancedMenuHelper.experimentalGroup(c),
      AdvancedMenuHelper.dangerGroup(c),
    ];
    return groups.filter(group => group.entries.length > 0);
  }

  /** Every row, in the order it is read. */
  static entries(groups: readonly AdvancedGroup[]): AdvancedEntry[] {
    return groups.reduce<AdvancedEntry[]>((all, group) => all.concat(group.entries), []);
  }

  private static backupGroup(c: AdvancedContext): AdvancedGroup {
    // The figures end in a full stop only when a sentence follows them: "Não protegido · 1,7 MB de 4 GB em uso. O navegador pode apagar...".
    const storage = c.storage.warning ? `${c.storage.summary ?? 'Verificando…'}. ${c.storage.warning}` : (c.storage.summary ?? 'Verificando…');
    return {
      id: 'backup', title: 'Backup', help: 'menu-backup',
      entries: [
        { id: 'storage', kind: 'info', label: 'Armazenamento', description: storage },
        {
          id: 'export', kind: 'action', label: 'Exportar jogos salvos',
          description: 'Baixa seus jogos num arquivo .zip. É a cópia que sobrevive se o navegador apagar os dados.',
        },
        AdvancedMenuHelper.roomBound({
          id: 'import', kind: 'action', label: 'Importar jogos salvos',
          description: 'Restaura jogos de um backup (.zip) ou de arquivos .e98. O jogo reinicia depois.',
        }, c),
      ],
    };
  }

  private static autosaveGroup(c: AdvancedContext): AdvancedGroup {
    return {
      id: 'autosave', title: 'Salvamento automático', help: 'menu-autosave',
      entries: [
        {
          id: 'autosave-game', kind: 'toggle', label: 'Salvar ao gravar o jogo', checked: c.values.autosaveGame,
          description: 'Salva no navegador sempre que o Elifoot grava o jogo. É o que mantém o seu progresso a salvo.',
        },
        {
          id: 'autosave-periodic', kind: 'toggle', label: 'Salvar a cada 5 min', checked: c.values.autosavePeriodic,
          description: 'Salva também a cada 5 minutos, mesmo sem o jogo gravar. É independente da opção de cima: dá para ligar as duas.',
        },
      ],
    };
  }

  private static patchGroup(c: AdvancedContext): AdvancedGroup {
    return {
      id: 'patch', title: 'Patches', help: 'menu-patch',
      entries: [
        AdvancedMenuHelper.roomBound({
          id: 'patch-load', kind: 'action', label: 'Carregar patch',
          description: 'Aplica um arquivo .zip com times e bandeiras atualizados. O jogo reinicia depois.',
        }, c),
        AdvancedMenuHelper.roomBound({
          id: 'patch-remove', kind: 'action', label: 'Remover patch',
          description: 'Volta aos times e bandeiras originais. O jogo reinicia depois.',
        }, c),
      ],
    };
  }

  private static toolsGroup(c: AdvancedContext): AdvancedGroup {
    const entries: AdvancedEntry[] = [
      {
        id: 'omatic', kind: 'action', label: 'Abrir \'O Matic', closes: true,
        description: 'Busca e altera valores na memória do jogo, como o dinheiro e a força dos jogadores.',
      },
      {
        id: 'diagnostics', kind: 'action', label: 'Diagnóstico', closes: true,
        description: `Anota o que acontece neste aparelho, para ajudar a achar problemas. ${c.diagnosticsSummary}.`,
      },
    ];
    if (c.debug) {
      entries.push({
        id: 'disk-copy', kind: 'action', label: 'Baixar disco virtual',
        description: 'Baixa uma cópia de tudo o que mudou no disco do jogo, para quem vai investigar um problema.',
      });
    }
    return { id: 'tools', title: 'Ferramentas', help: 'menu-tools', entries };
  }

  private static experimentalGroup(c: AdvancedContext): AdvancedGroup {
    const entries: AdvancedEntry[] = [
      {
        id: 'live-keyboard', kind: 'toggle', label: 'Teclado ao vivo (experimental)', checked: c.values.liveKeyboard,
        description: 'O botão Texto abre um campo acima do teclado do celular, e o que você digita aparece no jogo na hora.',
      },
      {
        id: 'idle-pause', kind: 'toggle', label: 'Economizar bateria quando parado', checked: c.values.idlePause,
        description: `Se a tela do jogo fica parada por ${c.idleSeconds} segundos ou mais, o emulador descansa e usa bem menos bateria. Ele acorda ao tocar ou digitar. Não age durante uma sala multiplayer, nem com "Salvar ao gravar o jogo" desligado.`,
      },
    ];
    if (c.cameraOffered) {
      entries.push({
        id: 'camera', kind: 'toggle', label: 'Zoom e movimento', checked: c.values.camera,
        description: 'Pince com dois dedos na imagem para ampliar e arraste com dois dedos para mover. Ligado, o menu ⋮ ganha o Zoom em Exibição. Só você vê isso: quem assiste à sala sempre vê o jogo inteiro.',
      });
    }
    return {
      id: 'experimental', title: 'Recursos experimentais', help: 'menu-experimental',
      intro: 'Ainda não foram testados em celulares de verdade. Se algo sair errado, desligue.',
      entries,
    };
  }

  private static dangerGroup(c: AdvancedContext): AdvancedGroup {
    return {
      id: 'danger', title: 'Zona de perigo', help: 'menu-danger', danger: true,
      intro: 'O que está aqui não dá para desfazer.',
      entries: [
        AdvancedMenuHelper.roomBound({
          id: 'wipe', kind: 'action', label: 'Apagar todos os dados…', danger: true,
          description: 'Remove os jogos salvos e as configurações deste navegador. Antes de apagar, o aplicativo oferece baixar um backup.',
        }, c),
      ],
    };
  }

  /** What ends in a reload cannot be used while a room is live: the reload would end the room for everyone watching. */
  private static roomBound(entry: AdvancedEntry, c: AdvancedContext): AdvancedEntry {
    return c.inRoom ? { ...entry, disabled: true, reason: AdvancedMenuHelper.ROOM_REASON } : entry;
  }
}

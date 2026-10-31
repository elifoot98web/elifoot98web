import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular/lazy';
import { AdvancedContext, AdvancedEntry, AdvancedEntryId, AdvancedGroup, AdvancedMenuHelper } from '../../../../core/helpers/advanced-menu.helper';
import { DiagnosticsReportHelper } from '../../../../core/helpers/diagnostics-report.helper';
import { HelpTopic } from '../../../../core/helpers/help-topic.helper';
import { StorageHealthHelper } from '../../../../core/helpers/storage-health.helper';
import { DiagnosticsService, StorageHealthService } from '../../../../core/services/shared';

/** What a row of the window asks of the page. */
export interface AdvancedEvent {
  id: AdvancedEntryId;
  /** A switch's new state. */
  value?: boolean;
}

/** What the page lends the window: the state it opens with, the rules the page keeps, and the ways out. */
export interface AdvancedHost {
  context: Omit<AdvancedContext, 'diagnosticsSummary' | 'storage'>;
  /** Called with the tap's own call stack: a file picker (`input.click()`) works only inside the gesture, so nothing is awaited first. */
  handle: (event: AdvancedEvent) => void | Promise<void>;
  /** The "?" of the window and of each group. */
  help: (topic: HelpTopic) => void;
}

/**
 * "Dados e avançado": the options sheet's second tier, for what is not needed on most visits (backup, patches, the O Matic, the
 * diagnostics, the experiments) and, last, in a box of its own, the wipe. Which rows exist and in what order is AdvancedMenuHelper;
 * this draws them and tells the page what was pressed. The page does the work, because it owns the services and the loaders.
 *
 * A companion window, so it is Windows 95 like the O Matic and the diagnostics beside it (CLAUDE.md, *Retro visual identity*): the
 * menu that opens it is the shell, and this is the first place the player leaves the shell for a window that has its own look.
 *
 * It stays open for the rows that finish by themselves (the backup, a switch, a patch, which reload the page when they are done) and
 * closes first for the ones that open a window to be used over the game (the O Matic, the diagnostics), as `closes` says.
 */
@Component({
  selector: 'app-advanced-modal',
  templateUrl: './advanced-modal.component.html',
  styleUrls: ['./advanced-modal.component.scss'],
  standalone: false
})
export class AdvancedModalComponent implements OnInit {
  @Input() host!: AdvancedHost;

  groups: AdvancedGroup[] = [];

  private context!: AdvancedContext;

  constructor(
    private modalController: ModalController,
    private storageHealth: StorageHealthService,
    private diagnostics: DiagnosticsService
  ) { }

  ngOnInit(): void {
    this.context = {
      ...this.host.context,
      storage: { summary: null, warning: null },
      diagnosticsSummary: this.diagnosticsSummary(),
    };
    this.rebuild();
    void this.readStorage();
  }

  trackGroup = (_: number, group: AdvancedGroup) => group.id;
  trackEntry = (_: number, entry: AdvancedEntry) => entry.id;

  /** An action row. A row that opens a window closes this one first, then asks the page. */
  async press(entry: AdvancedEntry): Promise<void> {
    if (entry.disabled) return;
    if (entry.closes) {
      await this.close();
      await this.host.handle({ id: entry.id });
      return;
    }
    // Not awaited before this call: a file picker is opened inside the tap, or not at all.
    await this.host.handle({ id: entry.id });
  }

  /** A switch row. The window shows the new state at once; the page applies it and keeps it. */
  async flip(entry: AdvancedEntry, checked: boolean): Promise<void> {
    this.remember(entry.id, checked);
    this.rebuild();
    await this.host.handle({ id: entry.id, value: checked });
  }

  openHelp(topic: HelpTopic): void {
    this.host.help(topic);
  }

  close(): Promise<boolean> {
    return this.modalController.dismiss();
  }

  private remember(id: AdvancedEntryId, checked: boolean): void {
    const values = this.context.values;
    switch (id) {
      case 'autosave-game': values.autosaveGame = checked; break;
      case 'autosave-periodic': values.autosavePeriodic = checked; break;
      case 'live-keyboard': values.liveKeyboard = checked; break;
      case 'idle-pause': values.idlePause = checked; break;
      case 'camera': values.camera = checked; break;
    }
  }

  private rebuild(): void {
    this.groups = AdvancedMenuHelper.groups(this.context);
  }

  /** What the browser says about the site's storage; it can take a moment, so the window opens with "Verificando…". */
  private async readStorage(): Promise<void> {
    try {
      const health = await this.storageHealth.read();
      this.context.storage = { summary: StorageHealthHelper.summary(health), warning: StorageHealthHelper.warning(health.persisted) };
      this.rebuild();
    } catch (e) {
      console.warn('Could not read the storage figures', e);
    }
  }

  private diagnosticsSummary(): string {
    if (!this.diagnostics.enabled) return 'Desligado';
    const events = DiagnosticsReportHelper.events(this.diagnostics.entryCount);
    return this.diagnostics.sessionOnly ? `Ligado nesta visita · ${events}` : `Ligado · ${events}`;
  }
}

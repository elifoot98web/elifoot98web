import { Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { AlertController, ModalController } from '@ionic/angular/lazy';
import { environment } from 'src/environments/environment';
import { DIAGNOSTICS } from 'src/app/core/models/constants';
import {
  DIAGNOSTICS_CATEGORIES, DIAGNOSTICS_CATEGORY_LABELS, DiagnosticsFilter
} from 'src/app/core/models/diagnostics.models';
import { DiagnosticsExportHelper, DiagnosticsExportOutcome } from 'src/app/core/helpers/diagnostics-export.helper';
import { DiagnosticsHeaderHelper } from 'src/app/core/helpers/diagnostics-header.helper';
import { DiagnosticsReport, DiagnosticsReportHelper, DiagnosticsView } from 'src/app/core/helpers/diagnostics-report.helper';
import { DiagnosticsService } from 'src/app/core/services/shared';
import { DosCI } from 'src/app/core/typings/jsdos';

/**
 * The diagnostics window: the switch, the last lines of the log, and the three ways to get the
 * whole report off the device. A companion window, so it is Windows 95 like the O Matic and the
 * room dialogs (see the scope rule in CLAUDE.md).
 *
 * Copy, share and download read a report that is **built before the tap**: the header is
 * collected when the window opens (and on "Atualizar"), and a tap only appends the live log to it,
 * synchronously. Safari honours `clipboard.writeText()` and `share()` only while the tap that
 * asked is still the current user gesture, and collecting the header awaits a storage estimate and
 * a service-worker lookup, so doing both inside the handler would work on a desktop and fail with
 * `NotAllowedError` on the iPhone this exists for.
 */
@Component({
  selector: 'app-diagnostics-modal',
  templateUrl: './diagnostics-modal.component.html',
  styleUrls: ['./diagnostics-modal.component.scss'],
  standalone: false,
})
export class DiagnosticsModalComponent implements OnInit, OnDestroy {
  /** The emulator's command interface, for the guest's framebuffer size in the report header. */
  @Input() dosCI: DosCI | null = null;

  @ViewChild('logPane') private logPane?: ElementRef<HTMLElement>;

  readonly filters: ReadonlyArray<{ value: DiagnosticsFilter; label: string }> = [
    { value: 'all', label: 'Todas as categorias' },
    ...DIAGNOSTICS_CATEGORIES.map(value => ({ value, label: DIAGNOSTICS_CATEGORY_LABELS[value] })),
  ];

  filter: DiagnosticsFilter = 'all';
  view: DiagnosticsView = { lines: [], matched: 0, matchedPrevious: 0 };
  /** The device facts for the report; `null` until collected, which keeps the three outputs disabled. */
  header: string[] | null = null;
  /** What the last action did, announced to screen readers. */
  status = '';
  statusIsError = false;
  readonly canShare = DiagnosticsExportHelper.canShare(navigator);

  private scrollTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private modalController: ModalController,
    private alertController: AlertController,
    private diagnostics: DiagnosticsService
  ) { }

  ngOnInit(): void {
    this.refresh();
    void this.collectHeader();
  }

  ngOnDestroy(): void {
    clearTimeout(this.scrollTimer);
  }

  get enabled(): boolean {
    return this.diagnostics.enabled;
  }

  get stateText(): string {
    if (!this.diagnostics.enabled) return 'Desligado: nada está sendo registrado.';
    const count = `${DiagnosticsReportHelper.events(this.diagnostics.entryCount)} desta página.`;
    return this.diagnostics.sessionOnly
      ? `Ligado só nesta visita (pedido com ?diag=1 no endereço). ${count}`
      : `Ligado. ${count}`;
  }

  /** What the log pane holds: the lines, or the reason there are none. */
  get logText(): string {
    if (this.view.lines.length > 0) return this.view.lines.join('\n');
    if (this.diagnostics.entryCount === 0 && !this.diagnostics.previous) {
      return this.diagnostics.enabled ? 'Nenhum evento registrado ainda.' : 'Ligue o registro para começar.';
    }
    return 'Nenhum evento nesta categoria.';
  }

  get countText(): string {
    const { lines, matched, matchedPrevious } = this.view;
    const shown = lines.filter(line => !line.startsWith('---')).length;
    const earlier = matchedPrevious > 0 ? ` (${matchedPrevious} da página anterior)` : '';
    return matched > shown
      ? `Mostrando os últimos ${shown} de ${DiagnosticsReportHelper.events(matched)}${earlier}.`
      : `${DiagnosticsReportHelper.events(matched)}${earlier}.`;
  }

  async onToggle(checked: boolean): Promise<void> {
    if (checked) {
      await this.diagnostics.enable();
    } else {
      await this.diagnostics.disable();
    }
    this.refresh();
    // The header says whether the log is on.
    await this.collectHeader();
  }

  onFilter(value: string): void {
    this.filter = value as DiagnosticsFilter;
    this.refresh();
  }

  async update(): Promise<void> {
    this.refresh();
    await this.collectHeader();
  }

  /** Needs the header, and does everything up to the hand-over synchronously: see the class comment. */
  copy(): void {
    const report = this.currentReport();
    if (!report) return;
    void DiagnosticsExportHelper.copy(navigator, document, report.text).then(outcome =>
      this.say(outcome, 'Relatório copiado.', 'Não foi possível copiar. Use Baixar ou Compartilhar.'));
  }

  share(): void {
    const report = this.currentReport();
    if (!report) return;
    void DiagnosticsExportHelper.share(navigator, report.text, report.fileName).then(outcome =>
      this.say(outcome, 'Relatório compartilhado.', 'Não foi possível compartilhar. Use Copiar ou Baixar.'));
  }

  download(): void {
    const report = this.currentReport();
    if (!report) return;
    try {
      DiagnosticsExportHelper.download(document, report.text, report.fileName);
      this.say('done', `Arquivo ${report.fileName} baixado.`, '');
    } catch (error) {
      console.warn('Could not download the diagnostics report', error);
      this.say('failed', '', 'Não foi possível baixar. Use Copiar ou Compartilhar.');
    }
  }

  async clear(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Limpar o registro?',
      message: 'Todos os eventos guardados neste aparelho serão apagados. Não dá para desfazer.',
      cssClass: 'win9x-alert alert-whitespace',
      backdropDismiss: false,
      buttons: [
        { text: 'Não', role: 'cancel' },
        { text: 'Sim', role: 'confirm', cssClass: 'alert-danger' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm') return;

    this.diagnostics.clearEntries();
    this.refresh();
    this.say('done', 'Registro limpo.', '');
  }

  async close(): Promise<void> {
    await this.modalController.dismiss();
  }

  /** Header plus the log as it is this instant, with no filter. Synchronous: see the class comment. */
  private currentReport(): DiagnosticsReport | null {
    // Disabled in the template until the header is in; this is for the tap that beats the disabling.
    if (!this.header) return null;
    return DiagnosticsReportHelper.report({
      header: this.header,
      previous: this.diagnostics.previous,
      current: this.diagnostics.entries,
      dropped: this.diagnostics.dropped,
      generatedAt: new Date(),
    });
  }

  private refresh(): void {
    this.view = DiagnosticsReportHelper.viewLines(
      this.diagnostics.previous, this.diagnostics.entries, this.filter, DIAGNOSTICS.PANEL_LINES);
    // Newest at the bottom, and the pane opens there: after the text is in the DOM.
    clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => {
      const pane = this.logPane?.nativeElement;
      if (pane) pane.scrollTop = pane.scrollHeight;
    }, 0);
  }

  private async collectHeader(): Promise<void> {
    this.header = null;
    try {
      const { versionName, versionNumber, buildDate, commitHash } = environment.versionConfig;
      this.header = await DiagnosticsHeaderHelper.build(DiagnosticsHeaderHelper.sourceFromGlobals(
        { name: versionName, number: versionNumber, buildDate, commit: commitHash },
        { capacity: DIAGNOSTICS.CAPACITY, enabled: this.diagnostics.enabled },
        this.dosCI
      ));
    } catch (error) {
      // The probes are individually guarded, so this is not expected; a report without the facts
      // beats no report.
      console.warn('Could not collect the diagnostics header', error);
      this.header = ['(não foi possível reunir os dados do aparelho)'];
    }
  }

  private say(outcome: DiagnosticsExportOutcome, done: string, failed: string): void {
    if (outcome === 'cancelled') {
      this.status = '';
      return;
    }
    this.statusIsError = outcome !== 'done';
    this.status = outcome === 'done' ? done : failed;
  }
}

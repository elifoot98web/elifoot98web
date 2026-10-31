import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, NgZone, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { SAVE_SAFETY } from 'src/app/core/models/constants';
import { SaveChipView, SaveStatusHelper } from 'src/app/core/helpers/save-status.helper';
import { SaveStatusService } from 'src/app/core/services/shared';

/**
 * "Salvo às 14:32": whether the player's progress has reached the browser's storage, in the
 * toolbar, where a player looks for it. Tapping it saves now (the page handles that; this only
 * says it was tapped).
 *
 * Flat and not Win9x on purpose: it lives in the page toolbar, which is app shell, like the room
 * pill (see the scope rule in CLAUDE.md). Its words are SaveStatusHelper's.
 *
 * Besides the status service's changes it re-reads the clock every `CHIP_REFRESH_MS`, because
 * "Sem salvar há 12 min" and "Salvo ontem" change with time and not with any event. That timer
 * runs outside the Angular zone and only re-enters it when the text actually changed.
 */
@Component({
  selector: 'app-save-status-chip',
  templateUrl: './save-status-chip.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class SaveStatusChipComponent implements OnInit, OnDestroy {
  @Output() activate = new EventEmitter<void>();

  /**
   * Drop the words on a narrow screen, leaving the dot (the text is still the button's accessible
   * name). The page sets it while a room is live: the room pill shares the title slot with this
   * chip, and at 360-390px it is the pill that gets squeezed, down to 20px, when both carry text.
   */
  @Input() compact = false;

  view: SaveChipView = SaveStatusHelper.describe(this.status.snapshot, Date.now());

  private subscription: Subscription | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private status: SaveStatusService, private zone: NgZone, private changeDetector: ChangeDetectorRef) { }

  ngOnInit(): void {
    this.subscription = this.status.snapshot$.subscribe(() => this.refresh());
    this.zone.runOutsideAngular(() => {
      this.timer = setInterval(() => this.refresh(), SAVE_SAFETY.CHIP_REFRESH_MS);
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    clearInterval(this.timer);
  }

  private refresh(): void {
    const next = SaveStatusHelper.describe(this.status.snapshot, Date.now());
    if (next.text === this.view.text && next.tone === this.view.tone) return;
    this.zone.run(() => {
      this.view = next;
      this.changeDetector.markForCheck();
    });
  }
}

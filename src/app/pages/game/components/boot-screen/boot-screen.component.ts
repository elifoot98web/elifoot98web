import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, NgZone, OnDestroy, OnInit, Output } from '@angular/core';
import { BootStatus } from '../../../../core/helpers/boot-progress.helper';
import { BootScreenHelper, BootScreenView } from '../../../../core/helpers/boot-screen.helper';

/**
 * The screen the game boots behind: the app's name on the game's green, which step the boot is on, a bar that is honest about whether
 * it knows how far along it is, and a way out. It is a page-level overlay and not an `ion-loading` (which said "Carregando game…" for
 * the whole 4 to 20 seconds, had no way out, and could not hold the form `?host=1` wants to show while the emulator starts).
 *
 * **It takes no room.** It is `position: fixed` over the page, out of its layout, and the game's container is behind it exactly as it
 * was behind the loader: hidden, and with no box until the game is up (`GamePage.isHidden` flips `.full` as the screen lifts). Nothing
 * about the layout depends on it (CLAUDE.md, *The control deck* and *The stage*: no new surface may change the picture's box).
 *
 * Shell, flat, not Win9x: it is the app's own splash, on the app's green, before there is a game for a companion window to accompany
 * (CLAUDE.md, *Retro visual identity*). The elapsed time lives here and not in the page, so the page's change detection is not
 * woken once a second for a hint.
 */
@Component({
  selector: 'app-boot-screen',
  templateUrl: './boot-screen.component.html',
  styleUrls: ['./boot-screen.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class BootScreenComponent implements OnInit, OnDestroy {
  /** What the boot is doing, as the page learns it (js-dos's text, then the guest's frames). */
  @Input() set status(value: BootStatus) {
    this.current = value;
    this.refresh();
  }
  /** A room the person asked for with `?host=1` is waiting for the game: one line says so, since the dialog is already gone. */
  @Input() hostWaiting = false;
  @Output() leave = new EventEmitter<void>();

  view: BootScreenView = BootScreenHelper.view(BootScreenHelper.initial(), 0);

  private current: BootStatus = BootScreenHelper.initial();
  private startedAt = performance.now();
  private timer?: ReturnType<typeof setInterval>;

  constructor(private zone: NgZone, private changeDetector: ChangeDetectorRef) { }

  ngOnInit(): void {
    // Once a second is all the hints need. Outside the zone: the page has nothing to check because a second went by.
    this.zone.runOutsideAngular(() => {
      this.timer = setInterval(() => {
        this.refresh();
        this.changeDetector.detectChanges();
      }, 1000);
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  get percentText(): string {
    return `${this.view.bar.percent}%`;
  }

  private refresh(): void {
    this.view = BootScreenHelper.view(this.current, performance.now() - this.startedAt);
  }
}

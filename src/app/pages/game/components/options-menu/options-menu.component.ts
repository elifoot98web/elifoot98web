import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { AUDIO_HEALTH } from '../../../../core/models/constants';
import { HelpTopic } from '../../../../core/helpers/help-topic.helper';
import { MenuEntry, MenuEntryId, MenuSection } from '../../../../core/helpers/menu.helper';

/** What a row of the menu asks of the page. The page holds every state and every service; the menu is a list that says "this one". */
export interface MenuEvent {
  id: MenuEntryId;
  /** A switch's new state, or a slider's new value (0 to 100). */
  value?: boolean | number;
  /** A slider reports twice: while it is dragged (heard at once) and when it is let go (stored). */
  phase?: 'input' | 'change';
  /** The zoom row's keys. */
  zoom?: 'fit' | 'in' | 'out';
}

/**
 * The options menu's rows, drawn the same way in the bottom sheet a finger opens and in the popover a mouse does. It owns no state and
 * calls no service: it draws the sections that MenuHelper made and tells the page what was pressed, so the rule for what is in the
 * menu is a pure function with a spec, and the page does not carry a second copy of it in its template.
 *
 * Shell, flat, not Win9x: it is the app's own menu, in the same family as the toolbar that opens it (decision D3; CLAUDE.md, *Retro
 * visual identity*). Rows are Ionic's `ion-item`, one control per row, and a switch is the WHOLE row (the label is inside the
 * `ion-toggle`), so the target is the row's 48 px and not the 36 px switch at its end.
 *
 * OnPush: the page memoizes `sections` by content, so a new array means something changed.
 */
@Component({
  selector: 'app-options-menu',
  templateUrl: './options-menu.component.html',
  styleUrls: ['./options-menu.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class OptionsMenuComponent {
  @Input() sections: readonly MenuSection[] = [];
  @Output() act = new EventEmitter<MenuEvent>();
  /** The "?" beside a section's title. */
  @Output() help = new EventEmitter<HelpTopic>();

  readonly volumeStep = AUDIO_HEALTH.VOLUME_STEP_PERCENT;

  trackSection = (_: number, section: MenuSection) => section.id;
  trackEntry = (_: number, entry: MenuEntry) => entry.id;

  onSwitch(entry: MenuEntry, event: Event): void {
    this.act.emit({ id: entry.id, value: !!(event as CustomEvent<{ checked: boolean }>).detail.checked });
  }

  onRange(entry: MenuEntry, event: Event, phase: 'input' | 'change'): void {
    const value = Number((event as CustomEvent<{ value: number }>).detail.value);
    this.act.emit({ id: entry.id, value, phase });
  }
}

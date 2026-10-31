import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-manual',
  templateUrl: './manual.component.html',
  standalone: false
})
export class ManualComponent {
  /**
   * The chapter to open, when a "?" sent the player here (HelpTopicHelper): an accordion `value` of the outer group, and `sub` the one
   * inside it, for the chapters that have a group of their own (the menu's). Without one the first chapter is open.
   */
  @Input() open: string | null | undefined = null;
  @Input() sub: string | null | undefined = null;
}

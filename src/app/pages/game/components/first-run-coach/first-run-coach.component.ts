import { Component, Input } from '@angular/core';
import { ModalController } from '@ionic/angular/lazy';
import { FirstRunCard, FirstRunHelper } from '../../../../core/helpers/first-run.helper';
import { HelpTopic } from '../../../../core/helpers/help-topic.helper';

/** How the coach was closed. The page treats every one of them as an answer: a coach that is dismissed is not shown again. */
export type FirstRunOutcome = 'done' | 'skip';

/**
 * The first minute, in three cards: tap, type, save and back up. It replaced the welcome alert, which was 643 characters in one block
 * and told people to learn to play from a FAQ that does not teach the game. Three screens of two sentences each can be read on a bus.
 *
 * A companion window, so Windows 95 like the dialogs beside it (decision D3), and a small one: it is a dialog, not a page, so it
 * sizes itself to its card (`.first-run-modal`, global.scss) instead of filling the phone. The cards are written for the device
 * (FirstRunHelper.cards): a finger and a mouse are told different things.
 *
 * Reachable again from "Primeiros passos" in the menu, which is why dismissing it is not a one-way door. "Saiba mais" on a card opens the guide at the
 * chapter that says the same at more length, over this window, and closing the guide brings the card back.
 */
@Component({
  selector: 'app-first-run-coach',
  templateUrl: './first-run-coach.component.html',
  standalone: false
})
export class FirstRunCoachComponent {
  /** A finger is how this device is used (`(pointer: coarse)`): the first two cards say "toque" and "Texto" instead of "clique" and the menu. */
  @Input() set touch(value: boolean) {
    this.cards = FirstRunHelper.cards({ touch: value });
  }
  /** Opens the guide at a topic; lent by the page, which owns the modal's stack. */
  @Input() help?: (topic: HelpTopic) => void;

  cards: FirstRunCard[] = FirstRunHelper.cards({ touch: true });
  index = 0;
  readonly footer = FirstRunHelper.FOOTER;

  constructor(private modalController: ModalController) { }

  get card(): FirstRunCard {
    return this.cards[this.index];
  }

  get first(): boolean {
    return this.index === 0;
  }

  get last(): boolean {
    return this.index === this.cards.length - 1;
  }

  next(): void {
    if (this.last) {
      void this.close('done');
      return;
    }
    this.index = FirstRunHelper.move(this.index, 1, this.cards.length);
  }

  back(): void {
    this.index = FirstRunHelper.move(this.index, -1, this.cards.length);
  }

  more(): void {
    this.help?.(this.card.help);
  }

  close(outcome: FirstRunOutcome): Promise<boolean> {
    return this.modalController.dismiss(null, outcome);
  }
}

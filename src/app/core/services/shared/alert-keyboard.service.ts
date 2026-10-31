import { Injectable, OnDestroy } from '@angular/core';
import { KeyboardInsetService } from './keyboard-inset.service';

/** Put on an alert that has a text field; _win9x.scss lays such an alert out for the keyboard. */
export const TEXT_FIELD_CLASS = 'alert-text-field';

/** Inputs that raise no keyboard. */
const NO_KEYBOARD_INPUT = new Set(['checkbox', 'radio']);

/**
 * Keeps an alert that has a text field above the OS keyboard, by running the inset measuring for as long as one is open.
 *
 * Why it exists: Ionic centres `ion-alert` in the layout viewport and sizes it from `100vh`, and iOS resizes neither for
 * the keyboard. On a landscape iPhone (the first device pass: Chrome on iOS, a 932x352 page of which 117 px were left above
 * the keyboard and its autofill strip) the compose dialog sat where a full-height page would have put it, so its title bar
 * showed and its text field and buttons were underneath the keyboard. The CSS that fixes the offset reads `--kb-inset`
 * (_win9x.scss), and `--kb-inset` is only measured while something has started KeyboardInsetService; the chat panel and the
 * type bar do, an alert did not.
 *
 * It listens on the document for Ionic's overlay events instead of being called by every place that creates an alert, so the
 * two alerts that have a text field today (the compose dialog and the 'O Matic cheat name) and any added later are covered
 * without anyone remembering. An alert without one has no keyboard to be above and starts nothing: a checkbox or a radio
 * (the wipe's last step, the resolution and touch-mode choices) never raises the keyboard.
 *
 * It also tags the alert with `alert-text-field`: the compact layout that fits a field and its buttons into what a landscape phone
 * leaves above the keyboard (_win9x.scss) belongs to every alert that has one, and a class each call site had to remember to pass
 * would be forgotten by the next one. Stencil leaves a class it does not manage alone, so it survives the alert's re-renders.
 *
 * Injected by AppComponent, not by a page: the listeners must be on before the first alert, and an alert is not a page.
 */
@Injectable({ providedIn: 'root' })
export class AlertKeyboardService implements OnDestroy {
  /** The alerts that hold a start() of the inset service: a held alert is released once, however it ends. */
  private readonly holding = new Set<EventTarget>();

  private readonly onPresent = (event: Event) => {
    const alert = event.target as (EventTarget & { inputs?: ReadonlyArray<{ type?: string }> }) | null;
    if (!alert || this.holding.has(alert) || !alert.inputs?.some(input => !NO_KEYBOARD_INPUT.has(input.type ?? 'text'))) return;
    this.holding.add(alert);
    (alert as unknown as HTMLElement).classList.add(TEXT_FIELD_CLASS);
    this.keyboardInset.start();
  };

  private readonly onDismiss = (event: Event) => {
    if (!event.target || !this.holding.delete(event.target)) return;
    this.keyboardInset.stop();
  };

  constructor(private keyboardInset: KeyboardInsetService) {
    // Will-present, not did-present: the keyboard comes up as the field takes the focus, which is during the present animation.
    document.addEventListener('ionAlertWillPresent', this.onPresent);
    document.addEventListener('ionAlertDidDismiss', this.onDismiss);
  }

  ngOnDestroy(): void {
    document.removeEventListener('ionAlertWillPresent', this.onPresent);
    document.removeEventListener('ionAlertDidDismiss', this.onDismiss);
    for (let held = this.holding.size; held > 0; held--) this.keyboardInset.stop();
    this.holding.clear();
  }
}

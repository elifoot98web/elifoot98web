import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DECK } from '../../models/constants';
import { DeckKeyDirective } from './deck-key.directive';

/**
 * The keycap's contract, against real buttons and real events: one release for every press however
 * the press ends, no focus taken, and a click that is only the browser's copy of a tap never
 * pressing anything. The pointer's capture calls throw for a synthetic pointer id and the directive
 * is meant to shrug that off, so these events are dispatched exactly as a browser would.
 */
@Component({
  template: `
    <button id="a" appDeckKey [deckKeyOn]="onA" [deckKeyDisabled]="disabledA" (deckPress)="log('a:press')" (deckRelease)="log('a:release')">A</button>
    <button id="b" appDeckKey (deckPress)="log('b:press')" (deckRelease)="log('b:release')">B</button>
    <button id="c" appDeckKey deckKeyOn="up" (deckPress)="log('c:press')" (deckRelease)="log('c:release')">C</button>
    <button id="d" appDeckKey *ngIf="showD" (deckPress)="log('d:press')" (deckRelease)="log('d:release')">D</button>
  `,
  standalone: false
})
class HostComponent {
  onA: 'down' | 'up' = 'down';
  disabledA = false;
  showD = true;
  events: string[] = [];
  log(event: string): void {
    this.events.push(event);
  }
}

describe('DeckKeyDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  // Never reset: the guard's clock is shared by every keycap in the page and by every spec, so a
  // spec that started the fake clock over would find the previous spec's tap still "recent".
  let clock = 100_000;

  const button = (id: string) => fixture.nativeElement.querySelector(`#${id}`) as HTMLButtonElement;
  const pointer = (id: string, type: string, pointerId = 1, init: PointerEventInit = {}) => {
    const event = new PointerEvent(type, { pointerId, pointerType: 'touch', bubbles: true, cancelable: true, button: 0, ...init });
    button(id).dispatchEvent(event);
    return event;
  };
  // TestBed here is zoneless, where detectChanges() refreshes only a view that was marked dirty, and
  // a plain field written by a spec is not a signal: mark it, or the change is never applied.
  const render = () => {
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  };
  const click = (id: string) => button(id).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  beforeEach(() => {
    spyOn(performance, 'now').and.callFake(() => clock);
    TestBed.configureTestingModule({ declarations: [HostComponent, DeckKeyDirective] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    // The guard's clock is shared by every keycap in the page, so a spec starts well after the last one's tap.
    clock += 10 * DECK.CLICK_AFTER_POINTER_MS;
  });

  afterEach(() => fixture.destroy());

  it('presses as the finger lands and releases as it lifts, once each', () => {
    pointer('a', 'pointerdown');
    expect(host.events).toEqual(['a:press']);
    pointer('a', 'pointerup');
    expect(host.events).toEqual(['a:press', 'a:release']);
  });

  it('is a button that cannot take the focus', () => {
    expect(button('a').getAttribute('tabindex')).toBe('-1');
    expect(button('a').getAttribute('type')).toBe('button');
    expect(pointer('a', 'pointerdown').defaultPrevented).toBeTrue();
    expect(button('a').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))).toBeFalse();
    expect(button('a').dispatchEvent(new Event('contextmenu', { bubbles: true, cancelable: true }))).toBeFalse();
  });

  it('opts out of panning exactly when it presses as the finger lands', () => {
    // A key that has already typed must not be scrolled out from under the finger (or cancelled by it), but one that waits for the lift
    // has to leave the gesture to the panel it sits in: the class is what `touch-action: none` hangs on in _deck.scss.
    expect(button('a').classList.contains('deck-key--landing')).toBeTrue();
    expect(button('b').classList.contains('deck-key--landing')).toBeTrue();
    expect(button('c').classList.contains('deck-key--landing')).toBeFalse();
    host.onA = 'up';
    render();
    expect(button('a').classList.contains('deck-key--landing')).toBeFalse();
  });

  it('wears the pressed class from the landing to the end', () => {
    pointer('a', 'pointerdown');
    expect(button('a').classList.contains('deck-key--down')).toBeTrue();
    pointer('a', 'pointerup');
    expect(button('a').classList.contains('deck-key--down')).toBeFalse();
  });

  it('releases once however the press ends', () => {
    for (const end of ['pointercancel', 'lostpointercapture']) {
      host.events.length = 0;
      pointer('a', 'pointerdown');
      pointer('a', end);
      expect(host.events).toEqual(['a:press', 'a:release']);
      // a late pointerup from the same gesture finds nothing to end
      pointer('a', 'pointerup');
      expect(host.events).toEqual(['a:press', 'a:release']);
    }
  });

  it('releases when the window loses the focus or the page is hidden while the key is down', () => {
    pointer('a', 'pointerdown');
    window.dispatchEvent(new Event('blur'));
    expect(host.events).toEqual(['a:press', 'a:release']);

    host.events.length = 0;
    pointer('a', 'pointerdown');
    spyOnProperty(document, 'hidden').and.returnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(host.events).toEqual(['a:press', 'a:release']);
  });

  it('does not listen to the window while no key is down', () => {
    window.dispatchEvent(new Event('blur'));
    expect(host.events).toEqual([]);
  });

  it('lets go of a key that is switched off under the finger', () => {
    pointer('a', 'pointerdown');
    host.disabledA = true;
    render();
    expect(host.events).toEqual(['a:press', 'a:release']);
    // and a switched-off key presses nothing
    pointer('a', 'pointerdown');
    expect(host.events).toEqual(['a:press', 'a:release']);
  });

  it('lets go of a key whose button goes away under the finger', () => {
    pointer('d', 'pointerdown');
    host.showD = false;
    render();
    expect(host.events).toEqual(['d:press', 'd:release']);
  });

  it('ignores a second finger on a key that is already down', () => {
    pointer('a', 'pointerdown', 1);
    pointer('a', 'pointerdown', 2);
    pointer('a', 'pointerup', 2);
    expect(host.events).toEqual(['a:press']);
    pointer('a', 'pointerup', 1);
    expect(host.events).toEqual(['a:press', 'a:release']);
  });

  it('ignores a mouse button other than the main one', () => {
    pointer('a', 'pointerdown', 1, { pointerType: 'mouse', button: 2 });
    expect(host.events).toEqual([]);
  });

  describe('a key that presses on release', () => {
    it('presses and releases at the lift, and not before', () => {
      pointer('c', 'pointerdown');
      expect(host.events).toEqual([]);
      pointer('c', 'pointerup');
      expect(host.events).toEqual(['c:press', 'c:release']);
    });

    it('does nothing when the browser takes the gesture over (a scroll)', () => {
      pointer('c', 'pointerdown');
      pointer('c', 'pointercancel');
      expect(host.events).toEqual([]);
    });
  });

  describe('the click that follows a tap', () => {
    it('is the browser\'s copy of the tap and presses nothing', () => {
      pointer('a', 'pointerdown');
      pointer('a', 'pointerup');
      click('a');
      expect(host.events).toEqual(['a:press', 'a:release']);
    });

    it('presses nothing on ANOTHER key when the keys moved under the finger', () => {
      // The bug that led to the shared clock: a tap on one key changed the layout, and the click
      // the browser made of it was aimed at whatever keycap was then under the finger.
      pointer('a', 'pointerdown');
      pointer('a', 'pointerup');
      host.events.length = 0;
      click('b');
      expect(host.events).toEqual([]);
    });

    it('is a press of its own once the tap is long past (assistive technology, a keyboard)', () => {
      pointer('a', 'pointerdown');
      pointer('a', 'pointerup');
      host.events.length = 0;
      clock += DECK.CLICK_AFTER_POINTER_MS + 1;
      click('b');
      expect(host.events).toEqual(['b:press', 'b:release']);
    });

    it('is a press and a release when no pointer came before it', () => {
      click('b');
      expect(host.events).toEqual(['b:press', 'b:release']);
    });

    it('does not press a key that is switched off', () => {
      host.disabledA = true;
      render();
      click('a');
      expect(host.events).toEqual([]);
    });

    it('is not a second press while the finger is still down', () => {
      pointer('a', 'pointerdown');
      click('a');
      expect(host.events).toEqual(['a:press']);
    });
  });

  it('can be switched between pressing on landing and on release', () => {
    host.onA = 'up';
    render();
    pointer('a', 'pointerdown');
    expect(host.events).toEqual([]);
    pointer('a', 'pointerup');
    expect(host.events).toEqual(['a:press', 'a:release']);
  });
});

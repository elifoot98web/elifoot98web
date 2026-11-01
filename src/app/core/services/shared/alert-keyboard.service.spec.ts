import { AlertKeyboardService, TEXT_FIELD_CLASS } from './alert-keyboard.service';
import { KeyboardInsetService } from './keyboard-inset.service';

/** The alerts are stand-ins: what the service reads is the `inputs` property of the event's target, and the events bubble to the document as Ionic's do. */
function alertWith(inputs: Array<{ type?: string }> | undefined): HTMLElement & { inputs?: Array<{ type?: string }> } {
  const element = document.createElement('div') as HTMLElement & { inputs?: Array<{ type?: string }> };
  element.inputs = inputs;
  document.body.appendChild(element);
  return element;
}
const present = (element: HTMLElement) => element.dispatchEvent(new CustomEvent('ionAlertWillPresent', { bubbles: true }));
const dismiss = (element: HTMLElement) => element.dispatchEvent(new CustomEvent('ionAlertDidDismiss', { bubbles: true }));

describe('AlertKeyboardService', () => {
  let inset: { start: jasmine.Spy; stop: jasmine.Spy };
  let service: AlertKeyboardService;
  const made: HTMLElement[] = [];
  const make = (inputs: Array<{ type?: string }> | undefined) => { const element = alertWith(inputs); made.push(element); return element; };

  beforeEach(() => {
    inset = { start: jasmine.createSpy('start'), stop: jasmine.createSpy('stop') };
    service = new AlertKeyboardService(inset as unknown as KeyboardInsetService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    made.splice(0).forEach(element => element.remove());
  });

  // The first device pass: a landscape iPhone left 117 of 352px above the keyboard and the compose dialog's field and buttons were under it.
  // --kb-inset is only measured while somebody started the inset service, so an alert with a field has to.
  it('starts the inset measuring for an alert with a text field, and tags it for the compact layout', () => {
    for (const type of ['textarea', 'text', 'password', 'number', undefined]) {
      const element = make([{ type }]);
      present(element);
      expect(element.classList.contains(TEXT_FIELD_CLASS)).withContext(`type ${type}`).toBeTrue();
    }
    expect(inset.start).toHaveBeenCalledTimes(5);
  });

  it('leaves an alert that raises no keyboard alone', () => {
    const cases: Array<Array<{ type?: string }> | undefined> = [undefined, [], [{ type: 'checkbox' }], [{ type: 'radio' }, { type: 'radio' }]];
    for (const inputs of cases) {
      const element = make(inputs);
      present(element);
      expect(element.classList.contains(TEXT_FIELD_CLASS)).withContext(JSON.stringify(inputs)).toBeFalse();
    }
    expect(inset.start).not.toHaveBeenCalled();
  });

  it('counts an alert that mixes a checkbox with a text field', () => {
    present(make([{ type: 'checkbox' }, { type: 'text' }]));
    expect(inset.start).toHaveBeenCalledTimes(1);
  });

  it('releases the hold once, however many times the alert says it is gone', () => {
    const element = make([{ type: 'textarea' }]);
    present(element);
    dismiss(element);
    dismiss(element);
    expect(inset.stop).toHaveBeenCalledTimes(1);
  });

  it('holds once, however many times the alert says it is presenting', () => {
    const element = make([{ type: 'textarea' }]);
    present(element);
    present(element);
    expect(inset.start).toHaveBeenCalledTimes(1);
  });

  it('does not release a hold it never took', () => {
    dismiss(make([{ type: 'checkbox' }]));
    dismiss(make(undefined));
    expect(inset.stop).not.toHaveBeenCalled();
  });

  it('holds one start per open alert, and lets go of them one at a time', () => {
    const first = make([{ type: 'text' }]);
    const second = make([{ type: 'textarea' }]);
    present(first);
    present(second);
    dismiss(first);
    expect(inset.start).toHaveBeenCalledTimes(2);
    expect(inset.stop).toHaveBeenCalledTimes(1);
    dismiss(second);
    expect(inset.stop).toHaveBeenCalledTimes(2);
  });

  it('lets go of what it still holds when it is destroyed, and listens no more', () => {
    present(make([{ type: 'text' }]));
    present(make([{ type: 'textarea' }]));
    service.ngOnDestroy();
    expect(inset.stop).toHaveBeenCalledTimes(2);
    present(make([{ type: 'text' }]));
    expect(inset.start).toHaveBeenCalledTimes(2);
  });
});

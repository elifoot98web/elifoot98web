import { KeyboardInsetService } from './keyboard-inset.service';

describe('KeyboardInsetService', () => {

  afterEach(() => {
    document.documentElement.style.removeProperty('--kb-inset');
    document.documentElement.style.removeProperty('--kb-open');
  });

  // The type bar logs where it sits the moment it is told the keyboard moved: the numbers are only
  // worth having if the page already has the layout of the new inset when it hears.
  it('has written the CSS properties by the time inset$ tells a subscriber', () => {
    const service = new KeyboardInsetService();
    const seen: Array<{ inset: number; cssInset: string; cssOpen: string }> = [];
    const subscription = service.inset$.subscribe(inset => {
      const style = document.documentElement.style;
      seen.push({ inset, cssInset: style.getPropertyValue('--kb-inset'), cssOpen: style.getPropertyValue('--kb-open') });
    });

    // The measuring is the viewport's business; the publication is the part under test.
    service['publish'](336);
    service['publish'](0);

    expect(seen.slice(1)).toEqual([
      { inset: 336, cssInset: '336px', cssOpen: '1' },
      { inset: 0, cssInset: '0px', cssOpen: '0' },
    ]);
    subscription.unsubscribe();
    service.ngOnDestroy();
  });

  it('tells a subscriber only when the inset changes', () => {
    const service = new KeyboardInsetService();
    const seen: number[] = [];
    const subscription = service.inset$.subscribe(inset => seen.push(inset));
    service['publish'](250);
    service['publish'](250);
    service['publish'](0);
    expect(seen).toEqual([0, 250, 0]);
    subscription.unsubscribe();
    service.ngOnDestroy();
  });
});

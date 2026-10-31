import { OcrRegionHelper, PixelFrame, PixelRegion } from './ocr-region.helper';

/** A frame of one colour: enough to tell regions apart without a real screenshot. */
function frame(width: number, height: number, fill: [number, number, number] = [0, 128, 0]): PixelFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function paint(target: PixelFrame, left: number, top: number, width: number, height: number, color: [number, number, number]) {
  for (let y = top; y < top + height; y++) {
    for (let x = left; x < left + width; x++) {
      const i = (y * target.width + x) * 4;
      (target.data as Uint8ClampedArray).set([color[0], color[1], color[2], 255], i);
    }
  }
}

/**
 * Something shaped like the dialog's title: a navy bar with a lighter mark in it, drawn into
 * `target` so that the 132x20 strip centred on the frame holds exactly it.
 */
function drawDialogTitle(target: PixelFrame) {
  const region = OcrRegionHelper.savingDialogRegion(target.width, target.height);
  paint(target, region.left, region.top, region.width, region.height, [0, 0, 128]);
  paint(target, region.left + 11, region.top + 6, 60, 7, [255, 255, 255]);
}

describe('OcrRegionHelper.savingDialogRegion', () => {

  it('is the strip the auto-saver always read at 800x600', () => {
    expect(OcrRegionHelper.savingDialogRegion(800, 600)).toEqual({ left: 332, top: 275, width: 132, height: 20 });
  });

  it('follows the centre when the guest runs at 640x480', () => {
    expect(OcrRegionHelper.savingDialogRegion(640, 480)).toEqual({ left: 252, top: 215, width: 132, height: 20 });
  });

  it('keeps its size at any frame size and its centre at the frame\'s', () => {
    for (const [w, h] of [[640, 480], [800, 600], [1024, 768], [1280, 1024]]) {
      const region = OcrRegionHelper.savingDialogRegion(w, h);
      expect(region.width).toBe(132);
      expect(region.height).toBe(20);
      // The strip's left edge is 68 px left of centre and its top edge 25 px above it.
      expect(region.left).toBe(w / 2 - 68);
      expect(region.top).toBe(h / 2 - 25);
    }
  });

  it('rounds half pixels the same way for either axis', () => {
    // 801 / 2 - 68 = 332.5 and 601 / 2 - 25 = 275.5, which Math.round takes up.
    expect(OcrRegionHelper.savingDialogRegion(801, 601)).toEqual({ left: 333, top: 276, width: 132, height: 20 });
  });

  it('stays inside a frame too small to hold it instead of running off the buffer', () => {
    const tiny = OcrRegionHelper.savingDialogRegion(100, 10);
    expect(tiny).toEqual({ left: 0, top: 0, width: 100, height: 10 });

    const narrow = OcrRegionHelper.savingDialogRegion(140, 600);
    expect(narrow.left + narrow.width).toBeLessThanOrEqual(140);
    expect(narrow.left).toBeGreaterThanOrEqual(0);
  });

  it('never leaves the frame, whatever its size', () => {
    for (let w = 1; w <= 300; w += 7) {
      for (let h = 1; h <= 120; h += 11) {
        const r: PixelRegion = OcrRegionHelper.savingDialogRegion(w, h);
        expect(r.left).toBeGreaterThanOrEqual(0);
        expect(r.top).toBeGreaterThanOrEqual(0);
        expect(r.left + r.width).toBeLessThanOrEqual(w);
        expect(r.top + r.height).toBeLessThanOrEqual(h);
      }
    }
  });
});

describe('OcrRegionHelper.hash', () => {

  it('is the same for the same picture at 800x600 and at 640x480', () => {
    // The two crops were measured byte-identical on the real game; the hash must not care which
    // frame the strip came out of.
    const wide = frame(800, 600);
    const narrow = frame(640, 480);
    drawDialogTitle(wide);
    drawDialogTitle(narrow);

    expect(OcrRegionHelper.hash(wide, OcrRegionHelper.savingDialogRegion(800, 600)))
      .toBe(OcrRegionHelper.hash(narrow, OcrRegionHelper.savingDialogRegion(640, 480)));
  });

  it('changes when a single pixel inside the strip changes', () => {
    const screen = frame(800, 600);
    const region = OcrRegionHelper.savingDialogRegion(800, 600);
    const before = OcrRegionHelper.hash(screen, region);

    paint(screen, region.left + region.width - 1, region.top + region.height - 1, 1, 1, [0, 128, 1]);
    expect(OcrRegionHelper.hash(screen, region)).not.toBe(before);

    paint(screen, region.left, region.top, 1, 1, [255, 255, 255]);
    expect(OcrRegionHelper.hash(screen, region)).not.toBe(before);
  });

  it('does not change for anything outside the strip', () => {
    const screen = frame(800, 600);
    const region = OcrRegionHelper.savingDialogRegion(800, 600);
    const before = OcrRegionHelper.hash(screen, region);

    // Just left, right, above and below it, and the far corners.
    paint(screen, region.left - 1, region.top, 1, region.height, [255, 0, 0]);
    paint(screen, region.left + region.width, region.top, 1, region.height, [255, 0, 0]);
    paint(screen, region.left, region.top - 1, region.width, 1, [255, 0, 0]);
    paint(screen, region.left, region.top + region.height, region.width, 1, [255, 0, 0]);
    paint(screen, 0, 0, 10, 10, [255, 0, 0]);
    paint(screen, 790, 590, 10, 10, [255, 0, 0]);

    expect(OcrRegionHelper.hash(screen, region)).toBe(before);
  });

  it('tells the dialog from the green backdrop, and a moved cursor from neither', () => {
    const backdrop = frame(800, 600);
    const dialog = frame(800, 600);
    drawDialogTitle(dialog);
    const region = OcrRegionHelper.savingDialogRegion(800, 600);

    expect(OcrRegionHelper.hash(dialog, region)).not.toBe(OcrRegionHelper.hash(backdrop, region));

    // A cursor parked on the title is a different picture, so it makes the caller look again.
    const withCursor = frame(800, 600);
    drawDialogTitle(withCursor);
    paint(withCursor, region.left + 40, region.top + 2, 8, 12, [255, 255, 255]);
    expect(OcrRegionHelper.hash(withCursor, region)).not.toBe(OcrRegionHelper.hash(dialog, region));
  });

  it('returns an unsigned 32-bit number', () => {
    const screen = frame(800, 600, [255, 255, 255]);
    const value = OcrRegionHelper.hash(screen, OcrRegionHelper.savingDialogRegion(800, 600));
    expect(Number.isInteger(value)).toBeTrue();
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
  });
});

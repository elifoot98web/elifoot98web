import { CursorRendererHelper } from './cursor-renderer.helper';
import { OverlaySyncHelper } from './overlay-sync.helper';

/**
 * The contract the camera relies on (CLAUDE.md, *The camera*): a transform on the picture's ROOT does not break the cursor overlay,
 * because `OverlaySyncHelper.align` reads the UNTRANSFORMED `offset*` of two nodes that scale together. Real layout, no mocks: a
 * container with the transform the camera writes, a canvas inside it (offset by a letterbox, as js-dos leaves it when it fits a frame
 * that is not the container's ratio) and an overlay aligned to the canvas.
 *
 * The one cost is rounding: `offset*` are integers, so the overlay can differ from the canvas by half a pixel of the picture's own
 * space, which a scale multiplies. Measured in a browser: 1.25 px at 2.5x. It is zero when the canvas sits on whole pixels, which is
 * what the stage plan arranges in landscape (whole-pixel container, zero offset).
 */
describe('OverlaySyncHelper under the camera\'s transform', () => {

  let host: HTMLElement;
  let container: HTMLElement;
  let canvas: HTMLElement;
  let overlay: HTMLElement;

  /** `left`, `top`, `width` and `height` of the canvas inside the container, in the picture's own px. */
  function build(box: { left: number; top: number; width: number; height: number }) {
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:30px;top:50px;width:1200px;height:900px;overflow:hidden';
    container = document.createElement('div');
    container.style.cssText = 'position:relative;width:393px;height:295px';
    canvas = document.createElement('div');
    canvas.style.cssText = `position:absolute;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
    overlay = document.createElement('div');
    container.append(canvas, overlay);
    host.append(container);
    document.body.append(host);
    OverlaySyncHelper.align(overlay, canvas);
  }

  const magnify = (scale: number, x: number, y: number) => {
    container.style.transformOrigin = '0 0';
    container.style.transform = scale === 1 && x === 0 && y === 0 ? '' : `translate(${x}px, ${y}px) scale(${scale})`;
  };

  const edges = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  };

  afterEach(() => host?.remove());

  for (const scale of [1, 1.5, 2, 3]) {
    it(`the overlay is exactly on the canvas at ${scale}x when the canvas sits on whole pixels`, () => {
      build({ left: 0, top: 0, width: 393, height: 295 });
      magnify(scale, -73, -41);
      const [canvasEdges, overlayEdges] = [edges(canvas), edges(overlay)];

      expect(overlayEdges.left).toBeCloseTo(canvasEdges.left, 6);
      expect(overlayEdges.top).toBeCloseTo(canvasEdges.top, 6);
      expect(overlayEdges.right).toBeCloseTo(canvasEdges.right, 6);
      expect(overlayEdges.bottom).toBeCloseTo(canvasEdges.bottom, 6);
    });

    it(`is within the rounding of offset* at ${scale}x when js-dos letterboxes the canvas on a fraction of a pixel`, () => {
      build({ left: 20.4, top: 0.4, width: 352.6, height: 294.2 });
      magnify(scale, -73, -41);
      const [canvasEdges, overlayEdges] = [edges(canvas), edges(overlay)];
      // The offset and the size are each rounded to a whole px of the picture's own space (half a px at most), and the scale multiplies
      // that: the near edges carry one rounding and the far ones two.
      for (const edge of ['left', 'top'] as const) {
        expect(Math.abs(overlayEdges[edge] - canvasEdges[edge])).toBeLessThanOrEqual(0.5 * scale + 0.001);
      }
      for (const edge of ['right', 'bottom'] as const) {
        expect(Math.abs(overlayEdges[edge] - canvasEdges[edge])).toBeLessThanOrEqual(1 * scale + 0.001);
      }
    });

    it(`a remote cursor at the middle of the picture is at the middle of the canvas at ${scale}x`, () => {
      build({ left: 0, top: 0, width: 393, height: 295 });
      magnify(scale, -73, -41);
      CursorRendererHelper.renderClick(overlay, { x: 0.5, y: 0.5, color: '#ff0000' } as never);
      const ping = overlay.querySelector('.cursor-click-ping') as HTMLElement;
      const canvasRect = canvas.getBoundingClientRect();
      const pingRect = ping.getBoundingClientRect();

      // The ping is anchored by its top-left corner at the normalised point (its 4 px are drawn from there).
      expect(pingRect.left).toBeCloseTo(canvasRect.left + canvasRect.width / 2, 0);
      expect(pingRect.top).toBeCloseTo(canvasRect.top + canvasRect.height / 2, 0);
    });

    it(`a cursor's normalised position is the same fraction of the canvas at ${scale}x as at 1x`, () => {
      build({ left: 0, top: 0, width: 393, height: 295 });
      CursorRendererHelper.renderClick(overlay, { x: 0.25, y: 0.75, color: '#ff0000' } as never);
      const ping = overlay.querySelector('.cursor-click-ping') as HTMLElement;
      const fractionOf = () => {
        const canvasRect = canvas.getBoundingClientRect();
        const pingRect = ping.getBoundingClientRect();
        return [(pingRect.left - canvasRect.left) / canvasRect.width, (pingRect.top - canvasRect.top) / canvasRect.height];
      };
      const plain = fractionOf();
      magnify(scale, -73, -41);
      const magnified = fractionOf();

      expect(magnified[0]).toBeCloseTo(plain[0], 2);
      expect(magnified[1]).toBeCloseTo(plain[1], 2);
    });
  }

  it('what the sync reads is not changed by the transform: offset* are layout values', () => {
    build({ left: 20, top: 0, width: 353, height: 295 });
    const before = [canvas.offsetLeft, canvas.offsetTop, canvas.offsetWidth, canvas.offsetHeight, container.offsetWidth, container.offsetHeight];
    magnify(3, -400, -200);
    const after = [canvas.offsetLeft, canvas.offsetTop, canvas.offsetWidth, canvas.offsetHeight, container.offsetWidth, container.offsetHeight];

    expect(after).toEqual(before);
  });

  it('the transform does not wake the observers that drive the sync: no feedback, no re-letterbox', async () => {
    build({ left: 0, top: 0, width: 393, height: 295 });
    let calls = 0;
    const stop = OverlaySyncHelper.observe([canvas, container], () => { calls++; });
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await frame();
    const initial = calls;

    magnify(2, -100, -60);
    await frame();
    magnify(3, -300, -200);
    await frame();
    magnify(1, 0, 0);
    await frame();
    stop();

    expect(initial).toBeGreaterThan(0);
    expect(calls).toBe(initial);
  });
});

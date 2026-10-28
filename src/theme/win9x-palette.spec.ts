/**
 * Guards the Win9x text palette against the one change that is easy to make and hard to see:
 * pointing a secondary-text rule back at `--win9x-shadow` (#808080), which is 2.2:1 on the
 * window face and 3.95:1 on white, or re-introducing a red that fails on the grey.
 *
 * It reads the real compiled stylesheet, not a copy of the hex values: karma loads
 * src/global.scss (angular.json `test.options.styles`), so the probes below are styled by the
 * actual `.win9x-roster-*` rules and the actual `:root` tokens. No component is created and
 * nothing here depends on layout, so it is a check on CSS and not a DOM spec.
 *
 * What it cannot see: the chat transcript's colours live in a component stylesheet, which a
 * probe cannot reach without creating the component. Those use the same token.
 */

const AA_NORMAL_TEXT = 4.5;

type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(css: string): Rgba {
  const match = css.match(/rgba?\(([^)]+)\)/);
  if (!match) throw new Error(`Not a computed colour: "${css}"`);
  const [r, g, b, a = 1] = match[1].split(',').map(part => parseFloat(part));
  return { r, g, b, a };
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: Rgba, background: Rgba): number {
  const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** The first opaque background on the way up: what the text is actually painted on. */
function effectiveBackground(element: Element): Rgba {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const background = parseColor(getComputedStyle(node).backgroundColor);
    if (background.a > 0) return background;
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

/** A token as the colour it computes to, so `var()` chains and hex spellings do not matter. */
function tokenColor(token: string): Rgba {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  document.body.appendChild(probe);
  const color = parseColor(getComputedStyle(probe).color);
  probe.remove();
  return color;
}

describe('Win9x text palette', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => host.remove());

  it('defines the muted ink as a neutral grey that clears AA on the window face and on white', () => {
    const muted = tokenColor('--win9x-ink-muted');

    expect(muted.r).toBe(muted.g);
    expect(muted.g).toBe(muted.b);
    expect(contrast(muted, tokenColor('--win9x-face'))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrast(muted, tokenColor('--win9x-field'))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('draws every roster secondary text at AA on the row it sits on', () => {
    // Three siblings of one type, so `:nth-of-type(even)` gives the middle one its shading;
    // the last is the "you" row, which has its own tint.
    host.innerHTML = `
      <div class="win9x-roster">
        <div class="win9x-roster-row" id="plain">${cells()}</div>
        <div class="win9x-roster-row" id="shaded">${cells()}</div>
        <div class="win9x-roster-row win9x-roster-row--self" id="mine">${cells()}</div>
        <p class="win9x-roster-empty" id="empty" data-probe="empty">Ninguém na sala ainda.</p>
      </div>`;

    const failures: string[] = [];
    host.querySelectorAll('[data-probe]').forEach(element => {
      const ratio = contrast(parseColor(getComputedStyle(element).color), effectiveBackground(element));
      if (ratio < AA_NORMAL_TEXT) {
        failures.push(`${element.closest('.win9x-roster-row, .win9x-roster-empty')?.id} ${element.getAttribute('data-probe')}: ${ratio.toFixed(2)}`);
      }
    });

    expect(failures).toEqual([]);
    expect(host.querySelectorAll('[data-probe]').length).toBe(3 * 6 + 1);
  });

  function cells(): string {
    return `
      <span class="win9x-roster-self" data-probe="self">(você)</span>
      <span class="win9x-roster-suffix" data-probe="suffix">a1b2c3</span>
      <span class="win9x-roster-meta" data-probe="meta">--</span>
      <span class="win9x-roster-meta" data-quality="success" data-probe="success">48 ms</span>
      <span class="win9x-roster-meta" data-quality="warning" data-probe="warning">180 ms</span>
      <span class="win9x-roster-meta" data-quality="danger" data-probe="danger">sem resposta</span>`;
  }
});

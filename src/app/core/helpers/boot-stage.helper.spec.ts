import { BootStage, BootStageHelper } from './boot-stage.helper';
import { PixelFrame } from './ocr-region.helper';

type Color = [number, number, number];

const GAME_GREEN: Color = [0, 128, 0];
const SPLASH_GREEN: Color = [0, 170, 85];
const DESKTOP_BLUE: Color = [0, 64, 128];
const BLACK: Color = [0, 0, 0];

/** A frame of one colour: enough to tell stages apart without a real screenshot. */
function frame(width: number, height: number, fill: Color): PixelFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function setPixel(target: PixelFrame, x: number, y: number, color: Color) {
  (target.data as Uint8ClampedArray).set([color[0], color[1], color[2], 255], (y * target.width + x) * 4);
}

describe('BootStageHelper.classify', () => {

  it('calls DOS\'s 640x400 text frame "dos"', () => {
    expect(BootStageHelper.classify(frame(640, 400, BLACK))).toBe('dos');
  });

  it('calls a black graphics frame "windows", at either resolution the guest can run', () => {
    expect(BootStageHelper.classify(frame(800, 600, BLACK))).toBe('windows');
    expect(BootStageHelper.classify(frame(640, 480, BLACK))).toBe('windows');
  });

  it('calls Windows\' blue desktop "elifoot": the game is the only program, so it is loading', () => {
    expect(BootStageHelper.classify(frame(800, 600, DESKTOP_BLUE))).toBe('elifoot');
    expect(BootStageHelper.classify(frame(640, 480, DESKTOP_BLUE))).toBe('elifoot');
  });

  it('calls the game\'s backdrop "game"', () => {
    expect(BootStageHelper.classify(frame(800, 600, GAME_GREEN))).toBe('game');
    expect(BootStageHelper.classify(frame(640, 480, GAME_GREEN))).toBe('game');
  });

  it('accepts the splash\'s lighter green too', () => {
    expect(BootStageHelper.classify(frame(800, 600, SPLASH_GREEN))).toBe('game');
  });

  it('tolerates the monitor\'s colour range, up to 25 per channel', () => {
    expect(BootStageHelper.classify(frame(800, 600, [20, 148, 20]))).toBe('game');
    expect(BootStageHelper.classify(frame(800, 600, [26, 154, 26]))).not.toBe('game');
  });

  it('survives a hourglass over the desktop and a title bar over the backdrop', () => {
    const desktop = frame(800, 600, DESKTOP_BLUE);
    setPixel(desktop, 400, 25, [255, 255, 255]);
    expect(BootStageHelper.classify(desktop)).toBe('elifoot');

    // Game green at 3 of the 4 probed points and the title bar's navy at the other: 3 of the 8
    // (colour, point) pairs match, which is exactly enough.
    const splash = frame(800, 600, [0, 0, 128]);
    setPixel(splash, 200, 25, GAME_GREEN);
    setPixel(splash, 400, 25, GAME_GREEN);
    setPixel(splash, 10, 250, GAME_GREEN);
    expect(BootStageHelper.classify(splash)).toBe('game');
  });

  it('needs three matches for the game, as the old detector did (greenCount > 2)', () => {
    const two = frame(800, 600, BLACK);
    setPixel(two, 0, 25, GAME_GREEN);
    setPixel(two, 200, 25, GAME_GREEN);
    expect(BootStageHelper.isGameScreen(two)).toBeFalse();

    setPixel(two, 400, 25, GAME_GREEN);
    expect(BootStageHelper.isGameScreen(two)).toBeTrue();
  });

  it('does not read past a frame too small to hold the probed points', () => {
    expect(() => BootStageHelper.classify(frame(100, 50, GAME_GREEN))).not.toThrow();
    expect(BootStageHelper.classify(frame(100, 50, GAME_GREEN))).toBe('dos');
  });

  it('treats a transparent frame as nothing, whatever its colour', () => {
    const clear = frame(800, 600, GAME_GREEN);
    for (let i = 3; i < clear.data.length; i += 4) (clear.data as Uint8ClampedArray)[i] = 0;
    expect(BootStageHelper.classify(clear)).toBe('windows');
  });
});

describe('BootStageHelper.advance', () => {

  it('takes the first stage seen', () => {
    expect(BootStageHelper.advance(null, 'windows')).toBe('windows');
  });

  it('moves forward', () => {
    expect(BootStageHelper.advance('dos', 'windows')).toBe('windows');
    expect(BootStageHelper.advance('windows', 'elifoot')).toBe('elifoot');
    expect(BootStageHelper.advance('dos', 'elifoot')).toBe('elifoot');
  });

  it('never goes back, so a black frame between the desktop and the splash changes nothing', () => {
    const order: BootStage[] = ['dos', 'windows', 'elifoot', 'game'];
    for (let from = 0; from < order.length; from++) {
      for (let to = 0; to < from; to++) {
        expect(BootStageHelper.advance(order[from], order[to])).toBe(order[from]);
      }
    }
  });

  it('keeps the stage on a repeat', () => {
    expect(BootStageHelper.advance('elifoot', 'elifoot')).toBe('elifoot');
  });
});

describe('BootStageHelper.message', () => {

  it('says each stage in Portuguese, with a real ellipsis', () => {
    expect(BootStageHelper.message('dos')).toBe('Iniciando o DOS…');
    expect(BootStageHelper.message('windows')).toBe('Abrindo o Windows 3.1…');
    expect(BootStageHelper.message('elifoot')).toBe('Carregando o Elifoot…');
    expect(BootStageHelper.message('game')).toBe('Abrindo o jogo…');
  });
});

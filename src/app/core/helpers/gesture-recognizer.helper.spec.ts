import { GestureConfig, GestureIntent, GestureRecognizer, TouchSample } from './gesture-recognizer.helper';

/**
 * The recognizer has no clock of its own: every sample carries its time, and the one deadline it
 * has (the hold) is advanced by hand, so these specs are plain function calls with made-up
 * timestamps.
 */
const at = (id: number, x: number, y: number, t: number, radius?: number): TouchSample => ({ id, x, y, t, radius });

const types = (intents: GestureIntent[]) => intents.map(intent => intent.type);

describe('GestureRecognizer', () => {
  let recognizer: GestureRecognizer;
  const make = (config: Partial<GestureConfig> = {}) => (recognizer = new GestureRecognizer(config));

  beforeEach(() => make());

  describe('a tap', () => {

    it('announces the finger when it lands, and clicks only when it lifts', () => {
      expect(recognizer.down(at(1, 100, 200, 0))).toEqual([{ type: 'down', x: 100, y: 200, preAim: true }]);
      expect(recognizer.up(at(1, 100, 200, 90))).toEqual([{ type: 'tap', x: 100, y: 200 }]);
      expect(recognizer.state).toBe('idle');
    });

    it('clicks where the finger landed, not where it lifted', () => {
      recognizer.down(at(1, 100, 200, 0));
      recognizer.move(at(1, 104, 203, 40));

      expect(recognizer.up(at(1, 106, 205, 90))).toEqual([{ type: 'tap', x: 100, y: 200 }]);
    });

    it('forgives a finger that wanders up to the slop, measured from where it landed', () => {
      recognizer.down(at(1, 100, 200, 0));
      expect(recognizer.move(at(1, 110, 200, 30))).toEqual([]);
      // Another step puts it 11.2 px from where it landed, which is no longer a tap.
      expect(types(recognizer.move(at(1, 105, 210, 60)))).toEqual(['drag-start', 'drag-move']);
    });

    it('is a tap however briefly or slowly it is held, as long as the hold has not fired', () => {
      recognizer.down(at(1, 50, 50, 0));
      expect(recognizer.up(at(1, 50, 50, 449))).toEqual([{ type: 'tap', x: 50, y: 50 }]);
    });
  });

  describe('a double tap', () => {

    const firstTap = () => {
      recognizer.down(at(1, 100, 200, 0));
      recognizer.up(at(1, 100, 200, 80));
    };

    it('is a second tap soon and near enough: it clicks again without moving the cursor', () => {
      firstTap();

      const down = recognizer.down(at(2, 110, 205, 200));
      expect(down).toEqual([{ type: 'down', x: 110, y: 205, preAim: false }]);
      expect(recognizer.up(at(2, 110, 205, 280))).toEqual([{ type: 'double-tap', x: 110, y: 205 }]);
    });

    it('does not pre-aim the second finger: re-aiming would put the second click outside the double-click rectangle', () => {
      firstTap();
      expect(recognizer.down(at(2, 130, 200, 150))).toEqual([jasmine.objectContaining({ preAim: false })]);
    });

    it('needs the second tap within 400 ms of the first one lifting', () => {
      firstTap();
      // Lifted at 80; down at 480 is 400 later, up at 560 is 480 later: too slow.
      recognizer.down(at(2, 100, 200, 480));
      expect(recognizer.up(at(2, 100, 200, 560))).toEqual([{ type: 'tap', x: 100, y: 200 }]);
    });

    it('accepts a second tap that lifts exactly 400 ms after the first, and the tap after it aims again', () => {
      firstTap();
      recognizer.down(at(2, 100, 200, 400));
      expect(types(recognizer.up(at(2, 100, 200, 480)))).toEqual(['double-tap']);

      expect(recognizer.down(at(3, 100, 200, 700))).toEqual([jasmine.objectContaining({ preAim: true })]);
    });

    it('needs the second tap within 32 px of where the first one landed', () => {
      firstTap();
      expect(recognizer.down(at(2, 133, 200, 150))).toEqual([jasmine.objectContaining({ preAim: true })]);
      expect(recognizer.up(at(2, 133, 200, 200))).toEqual([{ type: 'tap', x: 133, y: 200 }]);
    });

    it('is two taps, not three: the tap after a double starts over', () => {
      firstTap();
      recognizer.down(at(2, 100, 200, 150));
      expect(types(recognizer.up(at(2, 100, 200, 200)))).toEqual(['double-tap']);

      recognizer.down(at(3, 100, 200, 300));
      expect(types(recognizer.up(at(3, 100, 200, 350)))).toEqual(['tap']);
    });

    it('is forgotten after a drag: the next tap is a first tap', () => {
      firstTap();
      recognizer.down(at(2, 100, 200, 150));
      recognizer.move(at(2, 150, 200, 180));
      recognizer.up(at(2, 150, 200, 230));

      recognizer.down(at(3, 150, 200, 300));
      expect(types(recognizer.up(at(3, 150, 200, 350)))).toEqual(['tap']);
    });

    it('can be taken back by the caller: a tap that clicked nothing does not make the next one a double', () => {
      firstTap();
      recognizer.forgetTap();

      expect(recognizer.down(at(2, 110, 205, 150))).toEqual([{ type: 'down', x: 110, y: 205, preAim: true }]);
      expect(recognizer.up(at(2, 110, 205, 200))).toEqual([{ type: 'tap', x: 110, y: 205 }]);
    });
  });

  describe('a drag', () => {

    it('starts when the finger leaves the slop, with the button going down where the finger landed', () => {
      recognizer.down(at(1, 100, 100, 0));

      expect(recognizer.move(at(1, 120, 100, 50))).toEqual([
        { type: 'drag-start', x: 100, y: 100 },
        { type: 'drag-move', x: 120, y: 100 },
      ]);
      expect(recognizer.state).toBe('drag');
    });

    it('follows the finger and releases where it lifted, with no click', () => {
      recognizer.down(at(1, 100, 100, 0));
      recognizer.move(at(1, 120, 100, 50));

      expect(recognizer.move(at(1, 200, 160, 100))).toEqual([{ type: 'drag-move', x: 200, y: 160 }]);
      expect(recognizer.up(at(1, 210, 170, 150))).toEqual([{ type: 'drag-end', x: 210, y: 170 }]);
      expect(recognizer.state).toBe('idle');
    });

    it('cancels the hold: a finger that moves in time never becomes aim mode', () => {
      recognizer.down(at(1, 100, 100, 0));
      recognizer.move(at(1, 130, 100, 100));

      expect(recognizer.deadline).toBeNull();
      expect(recognizer.advance(1000)).toEqual([]);
    });

    it('ignores a move from a finger it is not tracking', () => {
      recognizer.down(at(1, 100, 100, 0));
      expect(recognizer.move(at(9, 500, 500, 10))).toEqual([]);
    });
  });

  describe('aim mode', () => {

    it('arms a deadline 450 ms after the finger lands, and only then', () => {
      expect(recognizer.deadline).toBeNull();
      recognizer.down(at(1, 100, 300, 1000));
      expect(recognizer.deadline).toBe(1450);
    });

    it('parks the cursor 56 px above the finger once the deadline passes', () => {
      recognizer.down(at(1, 100, 300, 0));

      expect(recognizer.advance(449)).toEqual([]);
      expect(recognizer.advance(450)).toEqual([{ type: 'aim-start', x: 100, y: 244, fingerX: 100, fingerY: 300 }]);
      expect(recognizer.state).toBe('aim');
      expect(recognizer.deadline).toBeNull();
    });

    it('follows the finger with the cursor above it, and a move is not a drag any more', () => {
      recognizer.down(at(1, 100, 300, 0));
      recognizer.advance(450);

      expect(recognizer.move(at(1, 180, 280, 600))).toEqual([{ type: 'aim-move', x: 180, y: 224, fingerX: 180, fingerY: 280 }]);
    });

    it('clicks where the cursor was parked when the finger lifts', () => {
      recognizer.down(at(1, 100, 300, 0));
      recognizer.advance(450);
      recognizer.move(at(1, 120, 310, 600));

      expect(recognizer.up(at(1, 120, 310, 700))).toEqual([{ type: 'aim-end', x: 120, y: 254, fingerX: 120, fingerY: 310 }]);
      expect(recognizer.state).toBe('idle');
    });

    it('takes effect even when the timer was late: a finger that lifts after the deadline aimed', () => {
      recognizer.down(at(1, 100, 300, 0));

      expect(types(recognizer.up(at(1, 100, 300, 520)))).toEqual(['aim-start', 'aim-end']);
    });

    it('is not a hold when the finger moved past the slop before the deadline, even slowly', () => {
      recognizer.down(at(1, 100, 300, 0));
      recognizer.move(at(1, 100, 320, 440));
      expect(recognizer.state).toBe('drag');
    });

    it('can be switched off, and then a long press is just a slow tap', () => {
      make({ holdMode: 'none' });
      recognizer.down(at(1, 100, 300, 0));

      expect(recognizer.deadline).toBeNull();
      expect(recognizer.advance(5000)).toEqual([]);
      expect(recognizer.up(at(1, 100, 300, 5000))).toEqual([{ type: 'tap', x: 100, y: 300 }]);
    });

    it('can park the cursor somewhere else', () => {
      make({ aimOffsetPx: 80, holdMs: 300 });
      recognizer.down(at(1, 100, 300, 0));

      expect(recognizer.advance(300)).toEqual([jasmine.objectContaining({ type: 'aim-start', y: 220 })]);
    });
  });

  describe('a palm', () => {

    it('is ignored outright when its contact is wider than a finger', () => {
      expect(recognizer.down(at(1, 100, 100, 0, 49))).toEqual([{ type: 'ignored', reason: 'palm' }]);
      expect(recognizer.active).toBeFalse();
      expect(recognizer.up(at(1, 100, 100, 50, 49))).toEqual([]);
    });

    it('does not stop a finger tapping while it rests', () => {
      recognizer.down(at(1, 300, 400, 0, 90));
      recognizer.down(at(2, 100, 100, 10, 12));

      expect(types(recognizer.up(at(2, 100, 100, 80)))).toEqual(['tap']);
    });

    it('lets a contact through that reports nothing about its size, or exactly the limit', () => {
      expect(types(recognizer.down(at(1, 10, 10, 0)))).toEqual(['down']);
      recognizer.cancelAll('test');
      expect(types(recognizer.down(at(2, 10, 10, 0, 48)))).toEqual(['down']);
    });
  });

  describe('a second finger', () => {

    it('cancels a tap before it clicks, and the first finger lifting afterwards does nothing', () => {
      recognizer.down(at(1, 100, 100, 0));

      expect(recognizer.down(at(2, 200, 200, 30))).toEqual([{ type: 'cancel', reason: 'second-finger' }]);
      expect(recognizer.up(at(2, 200, 200, 90))).toEqual([]);
      expect(recognizer.up(at(1, 100, 100, 100))).toEqual([]);
      expect(recognizer.state).toBe('idle');
    });

    it('cancels a drag, so the button is released', () => {
      recognizer.down(at(1, 100, 100, 0));
      recognizer.move(at(1, 150, 100, 40));

      expect(recognizer.down(at(2, 300, 300, 80))).toEqual([{ type: 'cancel', reason: 'second-finger' }]);
      expect(recognizer.move(at(1, 190, 100, 100))).toEqual([]);
      expect(recognizer.up(at(1, 190, 100, 140))).toEqual([]);
    });

    it('cancels aim mode', () => {
      recognizer.down(at(1, 100, 300, 0));
      recognizer.advance(450);

      expect(types(recognizer.down(at(2, 300, 300, 600)))).toEqual(['cancel']);
      expect(types(recognizer.up(at(1, 100, 300, 700)))).toEqual([]);
    });

    it('keeps the touch dead until EVERY finger is up: a third finger and a late first one do nothing', () => {
      recognizer.down(at(1, 100, 100, 0));
      recognizer.down(at(2, 200, 200, 10));

      expect(recognizer.down(at(3, 300, 300, 20))).toEqual([{ type: 'ignored', reason: 'extra-finger' }]);
      expect(recognizer.up(at(2, 200, 200, 50))).toEqual([]);
      // One finger still down: a new one is not a new gesture.
      expect(recognizer.state).toBe('ignoring');
      expect(recognizer.up(at(3, 300, 300, 60))).toEqual([]);
      expect(recognizer.up(at(1, 100, 100, 70))).toEqual([]);

      expect(recognizer.state).toBe('idle');
      expect(types(recognizer.down(at(4, 50, 50, 500)))).toEqual(['down']);
    });

    it('forgets the tap before it, so a tap and then two fingers is not half a double-tap', () => {
      recognizer.down(at(1, 100, 100, 0));
      recognizer.up(at(1, 100, 100, 50));
      recognizer.down(at(2, 100, 100, 100));
      recognizer.down(at(3, 150, 100, 110));
      recognizer.up(at(2, 100, 100, 150));
      recognizer.up(at(3, 150, 100, 160));

      expect(recognizer.down(at(4, 100, 100, 200))).toEqual([jasmine.objectContaining({ preAim: true })]);
    });
  });

  describe('being cancelled from outside', () => {

    it('pointercancel ends a drag without a release at the finger: it is a cancel', () => {
      recognizer.down(at(1, 100, 100, 0));
      recognizer.move(at(1, 150, 100, 40));

      expect(recognizer.cancel(1)).toEqual([{ type: 'cancel', reason: 'pointercancel' }]);
      expect(recognizer.state).toBe('idle');
      expect(recognizer.active).toBeFalse();
    });

    it('pointercancel on a pending tap cancels the tap', () => {
      recognizer.down(at(1, 100, 100, 0));
      expect(types(recognizer.cancel(1))).toEqual(['cancel']);
      expect(recognizer.deadline).toBeNull();
      expect(recognizer.advance(1000)).toEqual([]);
    });

    it('pointercancel of a finger it does not know is nothing', () => {
      expect(recognizer.cancel(7)).toEqual([]);
    });

    it('pointercancel of one finger of two keeps the touch dead until the other lifts', () => {
      recognizer.down(at(1, 100, 100, 0));
      recognizer.down(at(2, 200, 200, 10));

      expect(recognizer.cancel(1)).toEqual([]);
      expect(recognizer.state).toBe('ignoring');
      expect(recognizer.up(at(2, 200, 200, 50))).toEqual([]);
      expect(recognizer.state).toBe('idle');
    });

    it('cancelAll drops everything, whatever state it is in, and says so once', () => {
      recognizer.down(at(1, 100, 100, 0));
      recognizer.move(at(1, 150, 100, 40));

      expect(recognizer.cancelAll('page hidden')).toEqual([{ type: 'cancel', reason: 'page hidden' }]);
      expect(recognizer.active).toBeFalse();
      expect(recognizer.cancelAll('page hidden')).toEqual([]);
    });

    it('forgets the last tap, so nothing a hidden page remembered becomes a double-tap', () => {
      recognizer.down(at(1, 100, 100, 0));
      recognizer.up(at(1, 100, 100, 50));
      recognizer.cancelAll('window blur');

      expect(recognizer.down(at(2, 100, 100, 100))).toEqual([jasmine.objectContaining({ preAim: true })]);
    });
  });

  describe('configuration', () => {

    it('takes new thresholds on a live recognizer', () => {
      recognizer.configure({ tapSlopPx: 30 });
      recognizer.down(at(1, 100, 100, 0));

      expect(recognizer.move(at(1, 125, 100, 40))).toEqual([]);
      expect(types(recognizer.move(at(1, 135, 100, 60)))).toEqual(['drag-start', 'drag-move']);
    });
  });
});

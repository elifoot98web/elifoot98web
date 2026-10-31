import { NgZone } from '@angular/core';
import { fakeAsync, tick } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { LayoutViewport } from '../../helpers/layout-shape.helper';
import { StageInsets, StagePlan } from '../../helpers/stage.helper';
import { STAGE } from '../../models/constants';
import { logRecorder } from './diagnostics.testing';
import { LayoutHelperService } from './layout-helper.service';
import { StageLayoutService } from './stage-layout.service';

const PROPERTIES = ['--stage-w', '--stage-h', '--stage-mx', '--stage-my', '--stage-left', '--stage-right', '--chat-panel-width', '--chat-dock-w'];

/** The service with the safe areas the spec chooses: the headless page has none, and a probe cannot be told otherwise. */
class TestStageLayoutService extends StageLayoutService {
  insets: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** The window this instant, which the spec moves apart from the settled viewport to play a browser that resizes for the keyboard. */
  live: LayoutViewport = { width: 844, height: 390 };
  protected override readInsets(): StageInsets { return this.insets; }
  protected override liveViewport(): LayoutViewport { return this.live; }
}

/**
 * The rig: a host element whose size the spec moves, a viewport it moves with it (the real service gets both from the
 * page: the settled viewport from LayoutHelperService and the box from the element), and a log that keeps what it is told.
 * Nothing here waits for the real ResizeObserver: the spec asks the service to look, which is all the observer does.
 */
function rig(initial: { width: number; height: number } = { width: 844, height: 390 }) {
  let size = { ...initial };
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { get: () => size.width });
  Object.defineProperty(host, 'clientHeight', { get: () => size.height });
  const viewport$ = new BehaviorSubject<LayoutViewport>({ ...initial });
  const log = logRecorder();
  const service = new TestStageLayoutService(
    { viewport$ } as unknown as LayoutHelperService,
    log.diagnostics as never,
    new NgZone({ enableLongStackTrace: false }),
  );
  service.live = { ...initial };
  let window$ = { ...initial };
  const plans: StagePlan[] = [];
  const subscription = service.plan$.subscribe(plan => plans.push(plan));
  const css = (name: string) => document.documentElement.style.getPropertyValue(name);
  return {
    service, host, log, plans, css,
    /** A rotation or a resize: the window and the box move together, and the observers hear. */
    resize(width: number, height: number, box = { width, height }) {
      size = { ...box };
      window$ = { width, height };
      service.live = { width, height };
      viewport$.next({ width, height });
      service['recompute']('box');
    },
    /**
     * A browser that resizes the LAYOUT viewport for the OS keyboard: the window and the element lose `px` of height together,
     * and the settled viewport (LayoutShapeHelper.settle, a field has the focus) holds, so viewport$ says nothing.
     * `px = 0` is the keyboard closing: the window is what it was.
     */
    keyboard(px: number) {
      const base = { width: size.width, height: size.height + (window$.height - service.live.height) };
      size = { width: base.width, height: base.height - px };
      service.live = { width: window$.width, height: window$.height - px };
      service['recompute']('box');
    },
    /** The element changes size and the window does not: a toolbar appearing, say. */
    reflow(width: number, height: number) {
      size = { width, height };
      service['recompute']('box');
    },
    finish() {
      subscription.unsubscribe();
      service.stop();
    },
  };
}

describe('StageLayoutService', () => {

  afterEach(() => {
    PROPERTIES.forEach(name => document.documentElement.style.removeProperty(name));
    document.documentElement.style.removeProperty('--kb-inset');
  });

  describe('start and stop', () => {

    it('plans the page it is given and writes the plan where the stylesheets read it', () => {
      const r = rig();
      r.service.start(r.host);
      r.service.setKeys(true);

      expect(r.css('--stage-w')).toBe('520px');
      expect(r.css('--stage-h')).toBe('390px');
      // The middle of the screen is 162 px in, and the left rail has taken 112 of them: the picture's margin is the 50 left.
      expect(r.css('--stage-mx')).toBe('50px');
      expect(r.css('--stage-my')).toBe('0px');
      expect(r.css('--stage-left')).toBe('112px');
      expect(r.css('--stage-right')).toBe('112px');
      expect(r.css('--chat-panel-width')).toBe('240px');
      expect(r.css('--chat-dock-w')).toBe('0px');
      expect(r.service.plan?.leftColumns).toBe(2);
      expect(r.plans.length).toBeGreaterThan(0);
      r.finish();
    });

    it('takes the safe areas into the rails and into the chat', () => {
      const r = rig();
      r.service.insets = { top: 0, right: 47, bottom: 21, left: 47 };
      r.service.start(r.host);
      r.service.setKeys(true);

      expect(r.css('--stage-left')).toBe(`${47 + 112}px`);
      expect(r.css('--stage-right')).toBe(`${47 + 112}px`);
      expect(r.css('--stage-w')).toBe('520px');
      r.service.setChat(true);
      expect(r.css('--chat-dock-w')).toBe(`${200 + 47}px`);
      expect(r.css('--stage-w')).toBe('492px');
      r.finish();
    });

    it('lets go of every property when the page is left: a page without a stage must not inherit one', () => {
      const r = rig();
      r.service.start(r.host);
      expect(r.css('--stage-w')).not.toBe('');
      r.finish();
      for (const name of PROPERTIES) expect(r.css(name)).withContext(name).toBe('');
      expect(r.service.plan).toBeNull();
    });

    it('lets go of the first page when the second starts, and forgets its deck, view and chat', () => {
      const first = rig();
      first.service.start(first.host);
      first.service.setKeys(true);
      first.service.setView('wide');
      first.service.setChat(true);

      const second = document.createElement('div');
      Object.defineProperty(second, 'clientWidth', { get: () => 844 });
      Object.defineProperty(second, 'clientHeight', { get: () => 390 });
      first.service.start(second);
      // The second page has not said anything about its deck, its view or its chat: no keys, one column, nothing docked.
      expect(first.service.plan?.leftColumns).toBe(1);
      expect(first.service.plan?.rightColumns).toBe(0);
      expect(first.service.plan?.chatDocked).toBe(0);
      first.finish();
    });

    it('writes nothing for a page that is not on screen (0x0) and plans when it appears', () => {
      const r = rig({ width: 0, height: 0 });
      r.service.start(r.host);
      expect(r.css('--stage-w')).toBe('');
      expect(r.plans.length).toBe(0);

      r.resize(844, 390);
      expect(r.css('--stage-w')).toBe('520px');
      r.finish();
    });

    it('keeps the last stage in a window too small to hold one, instead of writing a picture of nothing', () => {
      const r = rig();
      r.service.start(r.host);
      r.resize(160, 100);
      // 160x100 would leave 92 px between the left rail and the edge: a stage under the minimum.
      expect(r.css('--stage-w')).toBe('520px');
      r.finish();
    });
  });

  describe('what the stage depends on', () => {

    it('follows the window: a rotation to portrait has no rails and no dock, back to landscape has them again', () => {
      const r = rig();
      r.service.start(r.host);
      r.service.setKeys(true);
      expect(r.service.plan?.shape).toBe('landscape-compact');

      r.resize(390, 844, { width: 390, height: 788 });
      expect(r.service.plan?.shape).toBe('portrait');
      expect(r.service.plan?.leftColumns).toBe(0);
      expect(r.css('--stage-left')).toBe('0px');
      expect(r.css('--stage-w')).toBe('390px');

      r.resize(844, 390);
      expect(r.service.plan?.leftColumns).toBe(2);
      expect(r.css('--stage-w')).toBe('520px');
      r.finish();
    });

    it('keeps the toolbar out of a tablet\'s box and the chat out of its picture', () => {
      const r = rig();
      // The window is 1180x820 and the toolbar takes 56 px of it: the box the page lays out in is 1180x764.
      r.resize(1180, 820, { width: 1180, height: 764 });
      r.service.start(r.host);
      expect(r.service.plan?.shape).toBe('landscape-regular');
      expect(r.service.plan?.stage).toEqual({ width: 1016, height: 762 });
      r.service.setChat(true);
      expect(r.service.plan?.stage.width).toBeLessThanOrEqual(1180 - 320);
      expect(r.css('--chat-dock-w')).toBe('320px');
      r.finish();
    });

    it('is Ampliar or Ajustar by the player\'s word, and nothing else moves the rails\' columns', () => {
      const r = rig();
      r.service.start(r.host);
      r.service.setKeys(true);
      expect(r.service.plan?.leftColumns).toBe(2);
      r.service.setView('wide');
      expect(r.service.plan?.leftColumns).toBe(1);
      expect(r.css('--stage-left')).toBe('68px');
      r.service.setView('fit');
      expect(r.service.plan?.leftColumns).toBe(2);
      r.finish();
    });

    it('does not move for the OS keyboard: --kb-inset is not an input, and a look at the page finds the same stage', () => {
      const r = rig();
      r.service.start(r.host);
      r.service.setKeys(true);
      const before = r.css('--stage-w') + r.css('--stage-h') + r.css('--stage-left') + r.css('--stage-right');

      const emitted = r.plans.length;
      // 120 px, not a real keyboard's 300: a box that took it would be 270 tall, a different but valid stage, where a bigger
      // number would leave less than the minimum, which the service refuses to write, and the spec would pass for that reason.
      document.documentElement.style.setProperty('--kb-inset', '120px');
      r.service['recompute']('box');
      const after = r.css('--stage-w') + r.css('--stage-h') + r.css('--stage-left') + r.css('--stage-right');

      expect(after).toBe(before);
      expect(r.plans.length).toBe(emitted);
      r.finish();
    });

    it('does not follow a browser that resizes the layout viewport for the OS keyboard: the window and the element shrink, the stage does not', () => {
      const r = rig();
      r.service.start(r.host);
      r.service.setKeys(true);
      const written = () => ['--stage-w', '--stage-h', '--stage-mx', '--stage-my', '--stage-left', '--stage-right', '--chat-dock-w'].map(r.css).join('|');
      const before = written();
      const emitted = r.plans.length;
      const lines = r.log.calls.length;

      // Half the height, as such a browser reports with a keyboard up: the element measures 844x195, the settled viewport is 844x390.
      r.keyboard(195);
      expect(written()).toBe(before);
      expect(r.css('--stage-w')).toBe('520px');
      expect(r.plans.length).toBe(emitted);
      expect(r.log.calls.length).toBe(lines);

      // The chat is the one input that moves it, and it moves it the same way with the keyboard up as without.
      r.service.setChat(true);
      const chatOpen = written();
      expect(r.css('--chat-dock-w')).toBe('240px');
      expect(chatOpen).not.toBe(before);
      r.keyboard(0);
      expect(written()).toBe(chatOpen);
      r.keyboard(195);
      expect(written()).toBe(chatOpen);
      r.keyboard(0);
      r.finish();
    });

    it('keeps the toolbar and the keyboard apart on a tablet: only what the keyboard took is given back', () => {
      const r = rig();
      // 1180x820 with a 56 px toolbar: the element is 1180x764.
      r.resize(1180, 820, { width: 1180, height: 764 });
      r.service.start(r.host);
      const before = JSON.stringify(r.service.plan?.stage);
      expect(before).toBe(JSON.stringify({ width: 1016, height: 762 }));

      r.keyboard(300);
      expect(JSON.stringify(r.service.plan?.stage)).toBe(before);
      r.keyboard(0);
      expect(JSON.stringify(r.service.plan?.stage)).toBe(before);
      r.finish();
    });

    it('still believes a real resize: a rotation or a window that was resized changes the stage even with a field focused', () => {
      const r = rig();
      r.service.start(r.host);
      r.service.setKeys(true);
      expect(r.css('--stage-w')).toBe('520px');

      // viewport$ emitted the new window (settle believes a change of width), so the live window and the settled one agree.
      r.resize(915, 412);
      expect(r.css('--stage-w')).toBe('548px');
      // The window got shorter and the settled viewport believed it (no field had the focus): the stage is smaller, as it must be.
      r.resize(915, 360);
      expect(r.service.plan?.stage).toEqual({ width: 480, height: 360 });
      r.finish();
    });

    it('does not move for a look that finds nothing new: no write, no emission, no log line', () => {
      const r = rig();
      r.service.start(r.host);
      r.service.setKeys(true);
      const emitted = r.plans.length;
      const lines = r.log.calls.length;

      r.service['recompute']('box');
      r.service['recompute']('box');
      r.service.setKeys(true);

      expect(r.plans.length).toBe(emitted);
      expect(r.log.calls.length).toBe(lines);
      r.finish();
    });
  });

  describe('the chat', () => {

    it('takes its room at once when it opens', fakeAsync(() => {
      const r = rig();
      r.service.start(r.host);
      r.service.setKeys(true);

      r.service.setChat(true);
      expect(r.service.plan?.chatDocked).toBeGreaterThan(0);
      expect(r.service.plan?.rightColumns).toBe(0);
      expect(r.css('--chat-dock-w')).toBe('240px');
      expect(r.service.plan?.leftColumns).toBe(1);
      r.finish();
    }));

    it('gives it back only when the slide-out has finished: the stage never grows into a panel that is still on screen', fakeAsync(() => {
      const r = rig();
      r.service.start(r.host);
      r.service.setKeys(true);
      r.service.setChat(true);
      const open = r.css('--stage-w');

      r.service.setChat(false);
      tick(STAGE.CHAT_CLOSE_DELAY_MS - 1);
      expect(r.css('--chat-dock-w')).toBe('240px');
      expect(r.css('--stage-w')).toBe(open);
      expect(r.service.plan?.rightColumns).toBe(0);

      tick(1);
      expect(r.css('--chat-dock-w')).toBe('0px');
      expect(r.service.plan?.rightColumns).toBe(2);
      expect(r.service.plan?.leftColumns).toBe(2);
      r.finish();
    }));

    it('cancels the give-back when the chat is opened again before it happens', fakeAsync(() => {
      const r = rig();
      r.service.start(r.host);
      r.service.setKeys(true);
      r.service.setChat(true);
      r.service.setChat(false);
      tick(100);
      r.service.setChat(true);
      tick(STAGE.CHAT_CLOSE_DELAY_MS * 2);

      expect(r.css('--chat-dock-w')).toBe('240px');
      expect(r.service.plan?.chatDocked).toBeGreaterThan(0);
      r.finish();
    }));

    it('leaves nothing scheduled when the page is left in the middle of a close', fakeAsync(() => {
      const r = rig();
      r.service.start(r.host);
      r.service.setChat(true);
      r.service.setChat(false);
      r.finish();
      expect(r.service.plan).toBeNull();
      // `flush: false` below: a timer left behind fails the case, where the default would drain it and hide it.
    }, { flush: false }));

    it('has nothing to wait for under reduced motion: the panel has no slide-out then', fakeAsync(() => {
      spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);
      const r = rig();
      r.service.start(r.host);
      r.service.setKeys(true);
      r.service.setChat(true);
      r.service.setChat(false);
      expect(r.css('--chat-dock-w')).toBe('0px');
      r.finish();
    }));

    it('pushes the picture aside only as far as the chat requires, and puts it back in the middle when it closes', fakeAsync(() => {
      const r = rig();
      r.service.start(r.host);
      r.service.setKeys(true);
      const middle = r.css('--stage-mx');
      r.service.setChat(true);
      // 844 less the chat's 240 and the picture's 520 leaves 84 for its left edge; the folded left rail is 56 of it.
      expect(r.css('--stage-mx')).toBe('28px');
      r.service.setChat(false);
      tick(STAGE.CHAT_CLOSE_DELAY_MS);
      expect(r.css('--stage-mx')).toBe(middle);
      r.finish();
    }));

    it('is ignored in portrait, where the chat is under the picture and costs it nothing', () => {
      const r = rig({ width: 390, height: 788 });
      r.service.start(r.host);
      const before = r.css('--stage-w');
      r.service.setChat(true);
      expect(r.css('--stage-w')).toBe(before);
      expect(r.css('--chat-dock-w')).toBe('0px');
      r.finish();
    });
  });

  describe('diagnostics', () => {

    it('writes one line to the layout log each time the plan changes, with the window it was made from', () => {
      const r = rig();
      r.service.start(r.host);
      r.service.setKeys(true);
      r.service.setChat(true);

      const lines = r.log.calls.filter(([cat, msg]) => cat === 'layout' && msg === 'stage plan');
      expect(lines.length).toBe(r.plans.length);
      const last = lines[lines.length - 1][2]!;
      expect(last['viewport']).toBe('844x390');
      expect(last['shape']).toBe('landscape-compact');
      expect(last['chat']).toBeTrue();
      expect(last['keys']).toBeTrue();
      // 'f': the left rail is folded to icons, because the chat is docked.
      expect(last['columns']).toBe('1f+0');
      expect(last['stage']).toBe('520x390');
      expect(last['lossPercent']).toBe(0);
      r.finish();
    });
  });
});

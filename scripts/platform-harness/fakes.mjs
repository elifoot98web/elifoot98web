// Init scripts that fake browser APIs the headless shell lacks or refuses. Each runs before any page script.
export const FAKE_WAKELOCK = `(() => {
  const saved = JSON.parse(sessionStorage.getItem('__wl_log') || '[]');
  const st = window.__wl = { requests: 0, live: 0, log: saved, mode: 'grant', sentinels: [] };
  const persist = () => sessionStorage.setItem('__wl_log', JSON.stringify(st.log));
  const api = { request: (type) => {
    st.requests++; st.log.push('request'); persist();
    if (st.mode === 'deny') { st.log.push('denied'); persist(); return Promise.reject(new DOMException('battery saver', 'NotAllowedError')); }
    const s = new EventTarget(); s.released = false;
    s.release = () => { if (s.released) return Promise.resolve(); s.released = true; st.live--; st.log.push('release'); persist(); s.dispatchEvent(new Event('release')); return Promise.resolve(); };
    st.live++; st.sentinels.push(s); st.log.push('granted'); persist(); return Promise.resolve(s);
  } };
  Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => api });
})();`

// A document whose visibility the spec can flip. visibilitychange is dispatched by the caller.
export const SETTABLE_VISIBILITY = `(() => {
  let v = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => v !== 'visible' });
  window.__setVisibility = (next) => { v = next; document.dispatchEvent(new Event('visibilitychange')); };
})();`

export const FAKE_INSTALL_PROMPT_AFTER = (ms, outcome = 'accepted') => `(() => {
  setTimeout(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    window.__installPrompts = 0;
    e.prompt = () => { window.__installPrompts++; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: '${outcome}' });
    window.dispatchEvent(e);
  }, ${ms});
})();`

// js-dos's AudioContext with a state the spec can force, and a resume() that obeys the spec (WebKit refusing without a gesture).
export const FAKE_AUDIO_STATE = `(() => {
  const proto = BaseAudioContext.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'state');
  const a = window.__audio = { forced: null, resumes: 0, allowResume: true, ctxs: [] };
  Object.defineProperty(proto, 'state', { configurable: true, get() { return a.forced ?? desc.get.call(this); } });
  const origResume = AudioContext.prototype.resume;
  AudioContext.prototype.resume = function () {
    a.resumes++;
    if (a.forced) {
      if (!a.allowResume) return new Promise(() => undefined);
      a.forced = null;
      setTimeout(() => this.dispatchEvent(new Event('statechange')), 0);
      return Promise.resolve();
    }
    return origResume.call(this);
  };
  const origCreate = AudioContext.prototype.createScriptProcessor;
  AudioContext.prototype.createScriptProcessor = function (...args) { a.ctxs.push(this); return origCreate.apply(this, args); };
  window.__forceAudio = (state) => { a.forced = state; for (const c of a.ctxs) c.dispatchEvent(new Event('statechange')); };
})();`

import { EmulatorKeyCode } from "./game";

export const STORAGE_KEY = {
  DISABLE_SMOOTH_FILTER: 'disableSmoothFilter',
  DISABLE_AUTO_SAVE: 'disableAutoSave',
  PERIODIC_SAVE: 'autoSave',
  HIDE_TUTORIAL: 'hideTutorial',
  PENDING_UPDATE: 'pendingUpdate',
  FAIL_COUNT: 'failCount',
  PLAYER_NAME: 'playerName',
  PLAYER_COLOR: 'playerColor',
  // Host-side escape hatch: hides every spectator cursor, label and click ping on the
  // game surface. Local and permanent, not a protocol change — nothing tells the
  // spectators, because there is nothing they need to do about it.
  HIDE_SPECTATOR_CURSORS: 'hideSpectatorCursors',
  // Host side: stop sending the game's sound to spectators. Absent means "send it". The track
  // stays in the stream either way and is only switched, never removed (see
  // MultiplayerAudioService), so this changes nothing about what is negotiated.
  DISABLE_SPECTATOR_AUDIO: 'disableSpectatorAudio',
  // Guest side: the spectator muted the game. Persisted because every rejoin is a fresh page
  // load (JoinGamePage.reloadSpectator), which would otherwise un-mute them on each retry.
  SPECTATOR_MUTED: 'spectatorMuted',
  // Host side: how many spectators the last room allowed. Remembered so the dialog opens on
  // the host's usual choice; clamped on read, because storage is just another input.
  MAX_SPECTATORS: 'maxSpectators',
  // Room CODES only, never passwords. A share link deliberately omits the password
  // (room-code.helper.ts), and persisting one here would undo that.
  RECENT_ROOMS: 'recentRooms',
  // Diagnostics (DiagnosticsService): whether the log is on, and the tail of the last page's log.
  // Both live in Ionic Storage like every other setting, so "Apagar todos os dados" clears them
  // with it. The tail is what survives a tab the OS evicted; see DiagnosticsService.
  DIAGNOSTICS: 'diagnostics',
  DIAGNOSTICS_LOG: 'diagnosticsLog',
  // How a finger drives the game: 'direct' (a tap lands under the finger, the default) or
  // 'classic' (js-dos's own touchpad). Absent means direct. Lives in Ionic Storage, so
  // "Apagar todos os dados" restores the default; see TouchModeHelper.
  TOUCH_MODE: 'touchMode',
  // Save visibility (SaveStatusService). All four are epoch milliseconds or a flag, and all four
  // are about the DISK they describe, so "Apagar todos os dados" has to reset them with it.
  // When the emulator's disk last reached IndexedDB, by any path (the auto-saver, the chip, the
  // page going hidden, leaving). It is what the toolbar chip says.
  LAST_PERSISTED_AT: 'lastPersistedAt',
  // The first time that ever happened here. A player who has never exported anything has no
  // lastBackupAt to count seven days from, so the nudge counts from this.
  FIRST_PERSISTED_AT: 'firstPersistedAt',
  // When a backup last left the app (a download, or a share sheet that was not cancelled).
  LAST_BACKUP_AT: 'lastBackupAt',
  // The "faça um backup" nudge was answered. Once, ever: see SavePolicyHelper.backupNudgeDue.
  BACKUP_NUDGE_DISMISSED: 'backupNudgeDismissed',
  // Whether the control deck (the key panel under the picture) is shown: 'auto' (where a finger is
  // the primary pointer), 'on' or 'off'. Absent means auto; see DeckLayoutHelper.
  DECK_MODE: 'deckMode',
  // The deck's keys buzz the phone by default where the browser can (Android; iOS has no
  // vibration API). Stored as the OFF flag so that an absent key, every existing install, means on.
  DISABLE_KEY_VIBRATION: 'disableKeyVibration',
  // EXPERIMENTAL. The deck's Texto button opens the live type bar (TypeBarComponent) instead of the
  // compose dialog. Absent means off: the bar has never run on a real phone's keyboard, and the
  // owner decides after the device pass (decision D7).
  LIVE_KEYBOARD: 'liveKeyboard',
  // "Economizar bateria quando parado" (EmulatorPowerService): the guest sleeps while nothing is
  // happening on screen. Stored as an explicit boolean when the player chooses, so that a change
  // of EMULATOR_POWER.DEFAULT_ENABLED reaches only the people who never touched the switch.
  IDLE_PAUSE: 'idlePause',
  // "Manter a tela ligada" (WakeLockService): the screen stays on while the game runs. Stored as an
  // explicit boolean when the player chooses, like IDLE_PAUSE, so that a change of
  // WAKE_LOCK.DEFAULT_ENABLED reaches only the people who never touched the switch. A room overrides it.
  KEEP_AWAKE: 'keepAwake',
  // The game's own volume on THIS device (0 to 1) and whether it is muted. They are the host's
  // headphones and nobody else's: the stream a spectator gets is tapped before js-dos's gain node
  // (MultiplayerAudioService). Applied through dosInstance.setVolume, which js-dos also keeps in its
  // own `emulators.ui.volume` entry; the wipe removes that one too (JSDOS_STORAGE).
  GAME_VOLUME: 'gameVolume',
  GAME_MUTED: 'gameMuted',
  // "Som no modo silencioso": `navigator.audioSession.type = 'playback'`, so the game is heard with the
  // iPhone's ringer switch on silent. Off unless chosen: it makes the page interrupt other apps' audio.
  AUDIO_PLAYBACK: 'audioPlayback',
  // The two one-time nudges of the platform polish (NudgeStateService). Each is shown once, ever, and
  // an answer is a stored `true`; the menu entries stay as the permanent way to the same things.
  ROTATE_HINT_SHOWN: 'rotateHintShown',
  INSTALL_NUDGE_DISMISSED: 'installNudgeDismissed',
  // "Tamanho da imagem" (StageLayoutService): 'fit' (Ajustar, the default) or 'wide' (Ampliar: the side
  // panels shrink to one column). Absent means fit; it changes the picture's box only when the player flips it.
  STAGE_VIEW: 'stageView',
}

/** Where a STORAGE_KEY lives. Ionic Storage is the default; the others are written around it. */
export type StorageHome = 'ionic' | 'localStorage';

/**
 * Where every {@link STORAGE_KEY} is written, and the reason this table exists: "Apagar todos os
 * dados" has to reach each of them, and `LocalStorageService.clearAllData` derives what it removes
 * from here. Ionic Storage is emptied wholesale (`storage.clear()`), so a key that lives only
 * there is wiped by construction; a key that is ALSO written somewhere Ionic Storage cannot see
 * (the diagnostics log's second copy, in `localStorage`) has to be listed with that home or the
 * wipe leaves it behind. The type is `Record<keyof typeof STORAGE_KEY, ...>`, so adding a key
 * without deciding where it lives does not compile, and storage-keys.spec.ts writes every key to
 * every home it declares and fails if the wipe leaves any of them standing.
 *
 * A key written anywhere not listed here (a bare `localStorage.setItem` somewhere else in the
 * app) is invisible to both the wipe and the spec: route it through a STORAGE_KEY entry instead.
 */
export const STORAGE_KEY_HOMES: Readonly<Record<keyof typeof STORAGE_KEY, readonly StorageHome[]>> = {
  DISABLE_SMOOTH_FILTER: ['ionic'],
  DISABLE_AUTO_SAVE: ['ionic'],
  PERIODIC_SAVE: ['ionic'],
  HIDE_TUTORIAL: ['ionic'],
  PENDING_UPDATE: ['ionic'],
  FAIL_COUNT: ['ionic'],
  PLAYER_NAME: ['ionic'],
  PLAYER_COLOR: ['ionic'],
  HIDE_SPECTATOR_CURSORS: ['ionic'],
  DISABLE_SPECTATOR_AUDIO: ['ionic'],
  SPECTATOR_MUTED: ['ionic'],
  MAX_SPECTATORS: ['ionic'],
  RECENT_ROOMS: ['ionic'],
  DIAGNOSTICS: ['ionic'],
  // The tail is written to Ionic Storage every few seconds and to localStorage when the page goes
  // hidden, because only the second write is complete when the page dies.
  DIAGNOSTICS_LOG: ['ionic', 'localStorage'],
  TOUCH_MODE: ['ionic'],
  LAST_PERSISTED_AT: ['ionic'],
  FIRST_PERSISTED_AT: ['ionic'],
  LAST_BACKUP_AT: ['ionic'],
  BACKUP_NUDGE_DISMISSED: ['ionic'],
  DECK_MODE: ['ionic'],
  DISABLE_KEY_VIBRATION: ['ionic'],
  LIVE_KEYBOARD: ['ionic'],
  IDLE_PAUSE: ['ionic'],
  KEEP_AWAKE: ['ionic'],
  GAME_VOLUME: ['ionic'],
  GAME_MUTED: ['ionic'],
  AUDIO_PLAYBACK: ['ionic'],
  ROTATE_HINT_SHOWN: ['ionic'],
  INSTALL_NUDGE_DISMISSED: ['ionic'],
  STAGE_VIEW: ['ionic'],
};

/**
 * Entries js-dos writes to `localStorage` under names of its own, which the registry above cannot
 * list (it maps STORAGE_KEY names). They are the app's in effect, because the app's own setting
 * is what makes js-dos write them, so "Apagar todos os dados" removes them as well
 * (`LocalStorageService.clearAllData`) and storage-keys.spec.ts proves it.
 *
 * `emulators.ui.volume` is `dosInstance.setVolume`'s: the game's volume. It is applied at the next
 * boot before the page has read its own copy, so a value left behind by a wipe would play the first
 * seconds of the game at a volume the person had just erased.
 */
export const JSDOS_STORAGE = {
  VOLUME_KEY: 'emulators.ui.volume',
}

/**
 * Save visibility and the safety nets around it (SaveStatusService, SaveSafetyService,
 * SavePolicyHelper). Every number here is a policy, not a measurement of the guest.
 */
export const SAVE_SAFETY = {
  // A page going hidden persists at most this often, however many times the player flips
  // between tabs: each persist rewrites the whole changes layer (about 5 MB, about a second on a
  // desktop), and a mobile browser that is busy being backgrounded has little time to spare.
  HIDDEN_PERSIST_MIN_GAP_MS: 3 * 60 * 1000,
  // Seven days without exporting a backup (counted from the first save when there never was one)
  // earns the player one reminder, ever.
  BACKUP_NUDGE_AFTER_MS: 7 * 24 * 60 * 60 * 1000,
  // Unsaved input older than this turns the chip from "Salvo às 14:32" into a warning. The game
  // writes its own save at kickoffs, so a long stretch of clicking in menus is normal; ten minutes
  // is where "nothing has reached the browser's storage" starts to be worth saying.
  UNSAVED_WARNING_AFTER_MS: 10 * 60 * 1000,
  // How often the chip re-reads the clock for its own text ("Sem salvar há 12 min").
  CHIP_REFRESH_MS: 30 * 1000,
  // The longest a leave waits for the game's own "A gravar o jogo..." dialog to close before it
  // saves anyway. The dialog is up for about a second, so this is a ceiling for a stuck one.
  GAME_IDLE_WAIT_MS: 15 * 1000,
  GAME_IDLE_POLL_MS: 500,
}

/**
 * Telling that Elifoot has exited to the Windows Program Manager, which the boot chain makes the
 * only other thing there is (`win D:\ELI98\ELIFOOT.EXE`), see GameExitHelper for the signature and
 * why the game's green is no use for it at 640x480.
 */
export const GAME_EXIT_WATCH = {
  // One look a second is plenty (a look is a screenshot and a coarse scan, about a millisecond),
  // and the game has to stay gone for this many looks in a row before anyone is told: Windows draws
  // this very desktop for a moment while the game starts, and an hourglass cursor or a closing
  // window must not read as an exit.
  POLL_MS: 1000,
  LOOKS_NEEDED: 3,
  // screenshot() has no deadline of its own; one that never answers costs a look.
  SCREENSHOT_TIMEOUT_MS: 5 * 1000,
  // How long "Reiniciar jogo" waits for the emulator to exit before it reloads anyway.
  EXIT_TIMEOUT_MS: 3000,
}

/**
 * What the frame looks like once ELIFOOT.EXE has exited and left Windows 3.1 with nothing but the
 * Program Manager (GameExitHelper). Measured on real frames at 640x480 and 800x600, which differ
 * only in size: the desktop is a flat (0, 64, 128), and the Program Manager sits at the bottom
 * left as an icon (x 16-61, 60 px tall, 10 px above the bottom edge, in both modes) with its title
 * in white on a navy bar. That is the whole picture: 99.3% of a 640x480 frame is the desktop colour.
 *
 * This is NOT the load-detection probe, and cannot be built from it: that one looks for the game's
 * green backdrop, which the window hides at 640x480, so "green lost" is the normal state there.
 * Across ~120 real Elifoot frames at 640x480 (every dialog, tab, menu, list and live match walked
 * for P4, plus the team lists) the desktop colour never appeared once, not even within a tolerance
 * of 25, and the programs that do share the screen with it (the team editor, the Program Manager
 * window itself) leave it 31% and 44% of the frame, nowhere near the 99% asked for here.
 */
export const GAME_EXIT_SIGNATURE = {
  DESKTOP_COLOR: { r: 0, g: 64, b: 128 },
  // The 256-colour driver paints the desktop in one exact palette entry; the slack is for a
  // driver that rounds, not for look-alikes.
  COLOR_TOLERANCE: 8,
  // Only graphics modes: DOS text mode is 640x400, and a frame that small is another stage.
  MIN_WIDTH: 640,
  MIN_HEIGHT: 480,
  // One sample every GRID_STEP pixels each way (4,800 at 640x480, about a millisecond). The
  // guest's mouse cursor is drawn into the frame (12x20 px, so at most 2x3 samples), and so is an
  // hourglass, which is why a few samples are allowed to be something else.
  GRID_STEP: 8,
  MAX_STRAY_SAMPLES: 8,
  // The Program Manager's icon, measured from the bottom-left corner so it holds at both sizes:
  // the box spans x 8-71 and the 74 rows above the 6 px margin. It is excluded from the grid above
  // and tested on its own. A second icon (Elifoot merely minimised) lands to the right of it, in
  // the grid, and is what keeps that from reading as an exit.
  ICON_BOX: { LEFT: 8, WIDTH: 64, BOTTOM_INSET: 6, HEIGHT: 74 },
  // Measured in the box: 489 white pixels (the title and icon highlights) and 2,035 that are not
  // the desktop colour. The floors are well under that so a cursor sitting on the icon passes.
  ICON_MIN_WHITE_PIXELS: 200,
  ICON_MIN_INK_PIXELS: 800,
  ICON_WHITE_MIN_CHANNEL: 200,
}

// The opt-in diagnostics log (DiagnosticsService). Off by default; every limit below exists to keep
// it from becoming the thing that slows down or fills the device it was turned on to examine.
export const DIAGNOSTICS = {
  // Entries kept in memory. The oldest are overwritten, never the newest: what matters is what
  // happened just before the report was taken.
  CAPACITY: 5000,
  // Ceilings on what one entry may hold, in characters. An entry is a note about an event, not a
  // dump of it, and 5000 of them have to stay a few MB at most.
  MESSAGE_MAX_CHARS: 120,
  DATA_MAX_CHARS: 400,
  // The URL parameter that switches the log on (or, with 0, off) for the tab's session.
  URL_PARAM: 'diag',
  // Where the tab's session remembers what the address asked: the address itself does not last
  // (the router rewrites it on the first navigation).
  SESSION_KEY: 'diagnosticsSession',
  // How many lines the panel renders at once. The export always carries the whole log.
  PANEL_LINES: 300,
  // The tail written to storage so that a page the OS evicted can still be explained by the one
  // that replaces it. Bounded in entries and in characters, whichever bites first.
  PERSIST_ENTRIES: 1000,
  PERSIST_MAX_CHARS: 200 * 1000,
  // Written at this pace while the log is on and has something new. A page that is killed in the
  // foreground (memory pressure) gets no pagehide, so waiting for one would lose exactly the
  // case this exists for; hiding and pagehide also write, as a best effort.
  PERSIST_INTERVAL_MS: 5000,
  // A burst of resize and orientation events becomes one entry after this quiet time.
  VIEWPORT_COALESCE_MS: 250,
  // Each asynchronous probe of the report header (storage estimate, service worker) gets this
  // long; a probe that hangs is reported as unavailable instead of holding the export back.
  HEADER_PROBE_TIMEOUT_MS: 1500,
}

/**
 * Elifoot's twelve formations, one per function key, and the caption each key carries in the
 * control deck (defenders-midfielders-attackers; every one adds up to the ten outfield players).
 * This is the one table: DeckKeyHelper builds the "Táticas" panel and the "Mais teclas" F-key grid
 * from it, so a caption cannot drift from the key it is printed on. There used to be a second,
 * reversed copy of it for the portrait FAB column, which died with the FABs.
 */
export const GAME_INPUT_FN_BTNS = [
  { keyCode: EmulatorKeyCode.KBD_f1, label: '3-3-4', text: 'F1' },
  { keyCode: EmulatorKeyCode.KBD_f2, label: '3-4-3', text: 'F2' },
  { keyCode: EmulatorKeyCode.KBD_f3, label: '4-2-4', text: 'F3' },
  { keyCode: EmulatorKeyCode.KBD_f4, label: '4-3-3', text: 'F4' },
  { keyCode: EmulatorKeyCode.KBD_f5, label: '4-4-2', text: 'F5' },
  { keyCode: EmulatorKeyCode.KBD_f6, label: '4-5-1', text: 'F6' },
  { keyCode: EmulatorKeyCode.KBD_f7, label: '5-2-3', text: 'F7' },
  { keyCode: EmulatorKeyCode.KBD_f8, label: '5-3-2', text: 'F8' },
  { keyCode: EmulatorKeyCode.KBD_f9, label: '5-4-1', text: 'F9' },
  { keyCode: EmulatorKeyCode.KBD_f10, label: '5-5-0', text: 'F10' },
  { keyCode: EmulatorKeyCode.KBD_f11, label: '6-3-1', text: 'F11' },
  { keyCode: EmulatorKeyCode.KBD_f12, label: '6-4-0', text: 'F12' },
];

export const AUTO_SAVER = {
  // How often the framebuffer is sampled. A sample is a screenshot() plus a hash of a 132x20
  // region (about 1 ms together, measured), and OCR runs only when that hash changed, so it can
  // be fast. It has to be: the game's "A gravar o jogo..." dialog stays up for only about 1.7 s
  // (measured on a real save at 800x600). Timed again with a 10 ms recorder on a new game, same
  // machine, same minute: 0.61 s at 800x600 and 0.62 s at 640x480, so the length belongs to the
  // machine and not to the video mode, and a quicker one has less than 1.7 s to spare. The old
  // 1.5 s tick could land inside that window only because 1.5 < 1.7, with nothing to spare for a
  // phone whose OCR pass takes longer than 0.2 s.
  DEFAULT_TICK_INTERVAL_MS: 300,
  DEFAULT_PERIODIC_SAVE_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  // Gap between two looks at the dialog while waiting for it to go away.
  DEFAULT_GAME_SAVING_DETECTED_TIMEOUT_MS: 1000, // 1 second
  MAX_WAITING_TIME_FOR_GAME_SAVE_DETECTED: 2 * 60 * 1000, // 2 minutes
  // The longest any single step of a tick may take: one screenshot, one OCR pass. It is not a
  // deadline for the tick, which lasts as long as the game takes to save. A step that overruns
  // is a hung one (an emulator that stopped answering), and the tick fails instead of waiting.
  HEARTBEAT_MS: 10 * 1000,
  // Ceiling on one persist of the emulator's disk, which has no deadline of its own. The loader
  // over the screen cannot be dismissed by the user, so a persist that never answered would
  // otherwise pin it there for good. A desktop takes about a second.
  PERSIST_TIMEOUT_MS: 30 * 1000,
  // How long to wait for Ionic to finish presenting or dismissing the loader before carrying on
  // without it. A page Chrome considers hidden runs no animation frames, so those promises never
  // settle there, and a hosting browser keeps ticking while hidden.
  OVERLAY_TIMEOUT_MS: 2000,
  // Wait before the next tick after the 1st, 2nd, 3rd... consecutive tick that threw; the last
  // entry repeats. A tick that worked puts it back to DEFAULT_TICK_INTERVAL_MS.
  RETRY_BACKOFF_MS: [5 * 1000, 15 * 1000, 60 * 1000],
}

export const APP_UPDATE = {
  // How long installing an update waits for the emulator's changes layer to reach IndexedDB
  // before reloading anyway: about a second on a desktop (a 5.4 MB zip), so this is a ceiling
  // for a persist that hangs, which must not be able to hold an update hostage. A persist cut
  // short loses what it was still writing and nothing else, because the write is one
  // IndexedDB put and the previous snapshot stays in place until it commits.
  SAVE_TIMEOUT_MS: 5000,
  // How long an update waits for the game's own save dialog to close before it persists anyway.
  // The dialog is up for about a second; this only bounds a stuck one.
  IDLE_WAIT_MS: 5000,
}

export const GAME_BOOT = {
  // How long loadGame() keeps looking for the game's own screen once the emulator is up. That
  // covers DOS, Windows 3.1 and the game's own start, because the screen it waits for is the
  // game's: measured on a desktop it is green 3.5 s after run() resolves, so this is a ceiling
  // chosen for a phone, not a measurement of one. The old 10 s ended a slow boot in silence.
  DETECTION_TIMEOUT_MS: 45 * 1000,
  // Wait before the first look, so js-dos has painted something, and between looks after it.
  DETECTION_SETTLE_MS: 500,
  DETECTION_POLL_MS: 500,
  // screenshot() is a round trip to the emulator's worker and has no deadline of its own. One
  // that never answers must cost a look, not the whole window.
  SCREENSHOT_TIMEOUT_MS: 5 * 1000,
  // The wipe is offered from the Nth failure in a row (a timeout is never one). Earlier than
  // this a failure is most likely a bad connection, and "Limpar todos os dados" is the one
  // button on the dialog that cannot be taken back.
  WIPE_OFFER_AFTER_FAILURES: 3,
}

// What the framebuffer must look like for BootStageHelper to call a frame "the game's screen".
// The pixels, the two greens and the tolerance are the ones load detection has always used; they
// are coordinate- and colour-sensitive, see CLAUDE.md before touching them. The desktop blue is
// Windows 3.1's own, seen while ELIFOOT.EXE loads: it is only used to label a stage, never to
// decide the game is ready.
//
// What the pixels sample is Elifoot's green BACKDROP form (a full-screen form behind the game
// window), not the game window. At 800x600 the window is ~634x474 and centred, so the backdrop
// shows on every side and the probe holds for as long as the game runs. At 640x480 the window
// fills the frame and hides the backdrop, so in play the four points read the menu bar and the
// squad list: the probe passes at boot only because the splash (Acerca / Registo) is smaller than
// the frame and sits on the backdrop, and "green lost" is the NORMAL state afterwards. Nothing may
// read a missing green as "the game exited" at 640x480; the Program Manager is told by the blue.
export const GAME_SCREEN_PROBE = {
  POINTS: [
    { x: 0, y: 25 },
    { x: 200, y: 25 },
    { x: 400, y: 25 },
    { x: 10, y: 250 },
  ],
  GAME_COLORS: [
    { r: 0, g: 128, b: 0, a: 255 },
    { r: 0, g: 170, b: 85, a: 255 },
  ],
  WINDOWS_DESKTOP_COLOR: { r: 0, g: 64, b: 128, a: 255 },
  // Adjust this value as needed (depends on the color range of the monitor)
  TOLERANCE: 25,
  // A match is one (colour, point) pair. The game's screen needs at least 3 of the 8 pairs (the
  // old `greenCount > 2`), the desktop 3 of its 4 points.
  GAME_MATCHES_NEEDED: 3,
  DESKTOP_MATCHES_NEEDED: 3,
  // DOS draws text at 640x400 (80x25 characters); every Windows frame is 640x480 or 800x600.
  GRAPHICS_MIN_HEIGHT: 480,
}

// The guest's video mode is chosen at every boot by d/SETRES.BAT, from dosbox.conf (see
// scripts/resolution/README.md): 640x480 unless FLAG_PATH exists in the saved disk, then 800x600.
// The flag is a file in the changes layer, written by PatchService.setDisplayMode; nothing is
// kept in storage, and the mode in force is read off the live framebuffer (DisplayModeHelper),
// so there is no second copy of it to fall out of step.
export const DISPLAY_MODE = {
  FLAG_PATH: 'd/res/use800.flg',
  // The frame each mode produces. Anything else (DOS text mode is 640x400, before the first
  // frame the size is 0x0) belongs to neither.
  SIZES: {
    '640': { width: 640, height: 480 },
    '800': { width: 800, height: 600 },
  },
  // How long the page waits for the emulator to exit before it reloads regardless. The layer is
  // already written by then; a guest that does not stop must not hold the reload back.
  EXIT_TIMEOUT_MS: 3000,
}

export const EMULATOR_CONTROL_CONFIG = {
  // Where the title of the game's "A gravar o jogo..." dialog is, as an offset from the CENTRE of
  // the frame: the dialog is centred and its size does not depend on the video mode (cropped at
  // 800x600 and at 640x480 the two are byte-identical, 0 of 10560 bytes differ). Anchored to the
  // centre the same four numbers give left=332, top=275 at 800x600 and left=252, top=215 at
  // 640x480; the old absolute (332, 275) silently matched nothing at 640x480. See
  // OcrRegionHelper.savingDialogRegion, which applies them.
  SAVING_DIALOG_REGION: {
    OFFSET_X: -68,
    OFFSET_Y: -25,
    WIDTH: 132,
    HEIGHT: 20,
  },
  DEFAULT_TOLERANCE_GAME_SAVING_DETECTION: 4,
  // How long the tesseract worker may take to come up. Its start is three downloads (the worker
  // script, the 3.9 MB core, the 1.4 MB Portuguese model) from a CDN and createWorker() has no
  // deadline of its own: with the model unreachable it stays pending forever (measured), so
  // without this the auto-save would wait on it for good.
  OCR_WORKER_TIMEOUT_MS: 20 * 1000,
  // Wait before another attempt after the 1st, 2nd and 3rd failed start. Past the last the host
  // stops trying until auto-save is switched off and on again: tesseract.js hands out the Worker
  // only once it is fully initialised, so a start that stalls or fails leaves a worker behind
  // that cannot be reached to terminate, and an endless retry would leak one per minute.
  OCR_RETRY_BACKOFF_MS: [5 * 1000, 15 * 1000, 60 * 1000],
  // Gap between two groups of raw key events sent to the guest: keys down, gap, keys up, gap.
  // It is a lower bound (a timer can only be late), and it exists because dosCI.simulateKeyPress
  // stamps its release 16 ms in the future, so two calls closer than that wedge the guest
  // keyboard for good. The queue never calls it: raw sendKeyEvent down/up with this gap held
  // 141 characters at 5 ms and 384 at 8 ms on a desktop, and 10 is the margin for slower phones
  // (not yet measured on a low-end Android). A chord costs two gaps, an Alt code ten, so about
  // 20 ms per ordinary character and 100 ms per accented one.
  KEY_PACING_MS: 10,
  // DOSBox's keyboard buffer silently drops events past this many arriving without a pause in
  // between (129 characters in one synchronous burst delivered 14). The only synchronous burst
  // the queue produces is a chord's presses or releases, so this caps the chord length.
  MAX_SYNC_KEY_EVENTS: 14,
  // The BIOS keyboard flags byte (0040:0017). Verified on the real bundle that it follows the
  // NumLock (0x20) and CapsLock (0x40) toggles and agrees with Windows' own idea of them: keypad
  // digits type only after a NumLock tap, and letters invert case after a CapsLock tap. Both
  // are off at boot. Only CapsLock is guarded: Alt+0nnn composes the same character with
  // NumLock off or on, and an Alt-composed letter ignores CapsLock.
  BIOS_KEYBOARD_FLAGS_ADDRESS: 0x417,
  BIOS_CAPS_LOCK_FLAG: 0x40,
  // readMemory is a round trip to the emulator's worker and has no deadline of its own. The
  // queue is a single consumer, so a read that never answered would stop every key behind it.
  KEYBOARD_STATE_TIMEOUT_MS: 500,
  // A text shorter than this goes out without the "Enviando n/N" toast. At about 20 ms a
  // character it is done before the toast has finished sliding in, and the typing showing up
  // in the game is feedback enough.
  PROGRESS_MIN_CHARACTERS: 24,
  // After a key could not be handed to the emulator (the call threw: the worker is gone) the
  // queue reports itself faulted for this long, and the control deck greys its keys. A key that
  // cannot be sent says so once (the page rate-limits that alert to the same interval); without
  // the pause a held arrow would raise it and retry on every tick. It is a pause, not a
  // verdict: nothing else can tell the deck the emulator is back, so the keys try again.
  KEY_FAULT_COOLDOWN_MS: 5 * 1000,
}

/**
 * The control deck (DockComponent): the key panel that replaced the FABs, the header buttons
 * and js-dos's own keyboard. Layout numbers are in css px and are the deck's, not the guest's.
 */
export const DECK = {
  // ---- hold-to-repeat (KeyRepeatScheduler) ----
  // How long a key is held before it starts repeating, and the gap between repeats after that.
  // 380 ms is a keyboard's own delay and 55 ms (18 a second) is below it: a list scrolls briskly
  // without a long press running away from the finger. The queue spends ~20 ms on a chord, so
  // there is room for the interval on a desktop; on a slower device the pending guard below is
  // what keeps the deck from outrunning the guest.
  REPEAT_DELAY_MS: 380,
  REPEAT_INTERVAL_MS: 55,
  // A repeat tick is skipped when the key queue already holds this many tasks. A held key must
  // never build a backlog that keeps typing after the finger has lifted.
  REPEAT_MAX_PENDING: 2,
  // A key held this long without a release was lost (pointerup stolen by the OS, say) and stops:
  // a held arrow is the one deck input that repeats without anyone touching it.
  REPEAT_MAX_HOLD_MS: 30 * 1000,

  // ---- sticky modifiers (ModifierLatch) ----
  // A second tap on a one-shot modifier this soon after the first locks it.
  LATCH_DOUBLE_TAP_MS: 400,

  // ---- keycaps (DeckKeyDirective) ----
  // A `click` this soon after a pointer's release is the browser's copy of it. One that arrives
  // with no pointer before it is assistive technology (TalkBack, VoiceOver, a switch) or a
  // keyboard activating the button, and is a press of its own.
  CLICK_AFTER_POINTER_MS: 700,
  // navigator.vibrate() on a press, where the browser has it and the setting is on.
  VIBRATE_MS: 8,

  // ---- layout (DeckLayoutHelper, LayoutShapeHelper) ----
  // A landscape viewport this short or shorter has no room for a toolbar: the header is dropped
  // and the picture takes the height. Every landscape phone is under it (the tallest measured is
  // 430), every tablet and laptop window over it.
  LANDSCAPE_COMPACT_MAX_HEIGHT: 500,
  // The toolbar's height, and the 4:3 picture's share of the width, to estimate the band the
  // portrait page leaves under the picture. The estimate ignores the safe areas on purpose: it
  // only has to tell a band from a pathologically short one.
  HEADER_HEIGHT: 56,
  PICTURE_HEIGHT_PER_WIDTH: 0.75,
  // Under this the portrait band cannot give Táticas, the panel that needs the most, its 44 px
  // keycaps (the 44-48 px target floor of a coarse pointer), and the deck falls back to the launcher,
  // as a landscape page does: the sheet's panels scroll at their natural 48 px rows. The arithmetic
  // (_deck.scss; deck-layout.helper.spec.ts derives it from this constant and fails if it drifts):
  // the band less the dock's 2 px seam and the 58 px taskbar is the panel, less its 8 px padding
  // twice is what the keys have; the 5 px gaps leave two thirds of the rest to the two formation
  // rows, so a row is 44 px from an inner height of 144.5 px, which is a band of 220.5. A 360x640
  // viewport has 314, but the same phone in a Chrome tab with the URL bar and the navigation bar
  // is ~512 tall and has ~186: that one used to get 32 px formation keys that overlapped.
  MIN_BAND_HEIGHT: 225,
  // The OS keyboard shrinks innerHeight on browsers that resize the layout viewport for it. A
  // drop to this fraction of the previous height or less, at the same width and with a field
  // focused, is the keyboard, and the layout must not move for it (the contract: it depends on
  // the viewport and the orientation, not on the OS keyboard).
  KEYBOARD_HEIGHT_RATIO: 0.8,
}

/**
 * The stage (StageHelper, StageLayoutService): the box the picture lives in, and the rails and the chat that share the
 * screen with it. Everything is in css px. The rails' KEY HEIGHT is not here: it is `--deck-key-dense-h` (_deck.scss),
 * 44 px under a coarse pointer, so that seven rows of keys, their gaps and the rail's padding are 344 px and fit the
 * shortest landscape phone there is (667x375) with room to spare.
 */
export const STAGE = {
  // The picture's ratio, as integers so that a stage is always a whole number of pixels on both sides (a stage of 521 px
  // would need 390.75). The guest's frame is 4:3 at 800x600 and at 640x480; the other video modes (DOS text, 720x400)
  // are letterboxed INSIDE it by js-dos, as they always were.
  RATIO_WIDTH: 4,
  RATIO_HEIGHT: 3,

  // ---- rails (the landscape phone's gutters) ----
  // The padding between a rail's edge (or the notch's inset) and its keys, the gap between keys, and a key's width. A
  // two column rail is 112 px of keys and padding, a one column rail 68; the notch's inset is added to the side it is on.
  // At 844x390 the gutters are 162 px: 47 of notch and 112 fit them with 3 px to spare, which is why the keys are 48 wide
  // and not 52 (the wireframe's pitch).
  RAIL_PAD: 6,
  RAIL_GAP: 4,
  RAIL_KEY_WIDTH_TWO_COLUMNS: 48,
  RAIL_KEY_WIDTH_ONE_COLUMN: 56,
  // The left rail while the chat is docked: icons only, the narrowest a 44 px touch target can be (the wireframe's 56 px of
  // rail). The room's code is not on it then, because the chat's own title bar says it.
  RAIL_KEY_WIDTH_FOLDED: 44,

  // ---- the chat dock ----
  // On a landscape phone the chat REPLACES the right rail and takes what the gutters leave, between these two (the
  // notch's inset is added): 240 is the width the wireframe asked for and 200 the narrowest a transcript, a field and an
  // "Enviar" button are still usable in.
  CHAT_PHONE_MIN: 200,
  CHAT_PHONE_MAX: 240,
  // Tablets and laptops (no rails) keep the widths global.scss always gave the chat: 320 px, or 40% of the window up to
  // 300 px where the window is 900 px wide or less.
  CHAT_WIDE: 320,
  CHAT_NARROW: 300,
  CHAT_NARROW_SHARE: 0.4,
  CHAT_NARROW_MAX_VIEWPORT: 900,
  // Closing the chat slides it out (220 ms, global.scss) before the width it held is given back. The plan waits for
  // the same time, or the stage would grow into a panel that is still on screen.
  CHAT_CLOSE_DELAY_MS: 220,

  // A stage narrower than this is a degenerate window (or a hidden page measured at 0): it is not written.
  MIN_STAGE_WIDTH: 120,
}

/**
 * The live type bar (TypeBarComponent, TypeBarSession, TypeMirror), EXPERIMENTAL and behind
 * STORAGE_KEY.LIVE_KEYBOARD. Every number here is a guess about keyboards nobody has held yet; the
 * device pass (the `ime` category of the diagnostics log) is what settles them.
 */
export const TYPE_BAR = {
  // An IME holding a word may still rewrite it, so a composition is mirrored when it ends. An IME
  // that never ends one must not leave the bar mute: after this long without a composition or
  // input event, the text as it stands is mirrored, and a later rewrite is a plain diff on top.
  // Long enough that continuous typing never trips it; 0 turns it off (commit-only).
  COMPOSITION_SETTLE_MS: 700,
  // The key queue reads the guest's CapsLock (a round trip to the emulator) before a text that
  // types letters. Per keystroke that would be a round trip per keystroke, so the bar asks when it
  // first types letters and again only after this long without typing any (the clock is the last
  // send of letters, not the last read): nothing on a phone can toggle the guest's CapsLock, only
  // a hardware keyboard forwarded to it can.
  CAPS_GUARD_REARM_MS: 15 * 1000,
  // A send of at least this many keys shows "Enviando n/N" with a Cancelar (a paste): the compose
  // dialog's threshold, so the two surfaces agree on what a long text is.
  PROGRESS_MIN_TASKS: EMULATOR_CONTROL_CONFIG.PROGRESS_MIN_CHARACTERS,
  // A held Backspace, arrow or PageUp on a hardware keyboard repeats unless the queue is already
  // this backed up, as the deck's keys do.
  REPEAT_MAX_PENDING: DECK.REPEAT_MAX_PENDING,
  // What one field holds. A paste is one send and the bar is for a name or a number; a list belongs
  // to the "Colar lista" dialog.
  MAX_LENGTH: 300,
  // Layout, in css px. The bar is a title, the field and a strip of keys; it is pinned to the bottom
  // of the screen, above the OS keyboard, and never takes space from the page. It needs
  // FULL_HEIGHT_* of room between the picture and the keyboard (two rows of five keys on a phone,
  // one row of ten from WIDE_STRIP_MIN_WIDTH wide); with less, or in landscape, whose keyboard covers
  // 55-60% of the screen, it folds into ONE row (56 px high) of the field and the keys that fit:
  // Tab, Enter and the way out always, Esc from 400 px wide, "123" and Backspace from 560 (the OS
  // keyboard has a Backspace and a number page of its own).
  // Measured at 393 px wide: 190 (title 24, field row 58, two strip rows 54 each), and 196 asks for a
  // little more than that, so a bar that "fits" never touches the picture.
  FULL_HEIGHT_NARROW: 196,
  FULL_HEIGHT_WIDE: 148,
  WIDE_STRIP_MIN_WIDTH: 520,
}

/**
 * Is there a text field in the guest? (CaretWatcher, IBeamHelper, FieldHintHelper). A HINT for the
 * live type bar and the Texto button, never a gate: a selected-text field shows no caret, and a
 * blinking thing that is not a caret is possible, so nothing is ever blocked or opened by it.
 *
 * Measured on the real game at 640x480 (and, before it, at 800x600): Windows' CursorBlinkRate is
 * 530 ms and frames arrived 528-600 ms apart with a field focused (none at all on a still screen),
 * the caret is one bar 1 px wide and 14 tall (17 tall in the sale price field) whatever the video
 * mode, because the font and not the frame fixes it, and consecutive frames differ by exactly that
 * bar. So none of the numbers below depend on the frame size or on where the field is.
 */
export const FIELD_HINT = {
  // A frame event is a blink when it comes this long after the one before it...
  BLINK_MIN_MS: 420,
  BLINK_MAX_MS: 700,
  // ...and a caret is suspected when, within this window, at least two gaps are blinks and at most
  // one is not. The frames kept for it are the last few only.
  BLINK_WINDOW_MS: 2600,
  BLINK_MIN_GAPS: 2,
  BLINK_MAX_STRAY_GAPS: 1,
  FRAME_HISTORY: 8,
  // After a verification that found no bar, the next one waits this long (frames of something else
  // that happens to tick at about 530 ms must not cost a pair of screenshots every frame).
  VERIFY_COOLDOWN_MS: 1000,
  // The caret is gone when no frame has come for this long (a still screen sends none), or when
  // frames keep coming for this long without a single blink-sized gap (the screen is animating).
  GONE_AFTER_MS: 1200,
  STALE_AFTER_MS: 8000,
  // What a bar looks like, in guest pixels: the sum of the three channel differences that counts as
  // changed, the widest and the shortest and tallest bar, and how much of its box it must fill.
  PIXEL_DIFF: 150,
  BAR_MAX_WIDTH: 3,
  BAR_MIN_HEIGHT: 8,
  BAR_MAX_HEIGHT: 25,
  BAR_MIN_FILL: 0.6,

  // The I-beam under a tap. The guest draws its mouse cursor into the frame, and Windows' I-beam is
  // an XOR cursor: a 17-row sprite, a one pixel stem 15 rows tall between two 7 pixel serifs, in the
  // inverse of whatever is under it (blue on the focused yellow field, black on a white one).
  // The arrow is not: its black left edge has the same stem-like look over a white list, and what
  // tells them apart is the serif.
  IBEAM_LOOK_DELAY_MS: 150,
  IBEAM_TTL_MS: 4000,
  IBEAM_SEARCH_X: 4,
  IBEAM_SEARCH_Y: 4,
  IBEAM_TOP_ROWS_ABOVE_HOTSPOT: 9,
  IBEAM_STEM_ROWS: 15,
  IBEAM_STEM_MIN_ROWS: 11,
  IBEAM_STEM_NEIGHBOUR: 2,
  IBEAM_SERIF_HALF_WIDTH: 3,
  IBEAM_SERIF_MIN_PIXELS: 6,
  IBEAM_SERIF_REFERENCE: 6,
  // A pixel differs from its neighbour at this sum of channel differences; two that are "the same
  // background" differ by less than IBEAM_SAME.
  IBEAM_DIFF: 120,
  IBEAM_SAME: 48,
}

/**
 * Direct touch (TouchInputService, GestureRecognizer, GuestPointer). The pointer numbers are
 * properties of the GUEST, not of the app: Windows 3.1's mouse driver and DOSBox's callback. They
 * were measured with the RAM oracle in scripts/touch-harness (see its README for the tables), and
 * must be measured again after any change to the video mode, the Windows mouse settings
 * (WIN.INI / SYSTEM.INI), js-dos or the disk image.
 */
export const TOUCH_INPUT = {
  // ---- the gestures (css px and ms; recalled thresholds, to be tuned on a real finger) ----
  // A finger may wander this far from where it landed and still be a tap. Past it, before the
  // hold time, the touch is a drag.
  TAP_SLOP_PX: 10,
  // Still for this long = aim mode: the guest cursor is parked above the finger and the click
  // happens when the finger lifts, because a fingertip is bigger than the 6 px targets.
  HOLD_MS: 450,
  // A second tap this soon after the first one lifted (measured release to release), and this
  // near it, is a double-click. Windows needs a real WM_LBUTTONDBLCLK, two single clicks at two
  // positions are not one, so the second click goes out where the first one did.
  DOUBLE_TAP_MS: 400,
  DOUBLE_TAP_SLOP_PX: 32,
  // How far above the finger aim mode parks the cursor, so the sprite (~6x10 css px) is not
  // under the fingertip.
  AIM_OFFSET_PX: 56,
  // Contacts reporting a radius over this are a palm, not a finger, and are ignored. Only
  // browsers that report contact geometry can use it (Chrome on Android does).
  PALM_RADIUS_PX: 48,
  // What a long hold does: 'aim' (above) or 'none' (a hold is just a slow tap).
  HOLD_MODE: 'aim' as 'aim' | 'none',
  // A mouse event this soon after a touch is the browser's compatibility copy of it, and is
  // dropped: on an iPad with the default (Macintosh) user agent js-dos would answer it with a
  // pointer-lock request.
  COMPAT_MOUSE_WINDOW_MS: 500,
  // A gesture that has heard nothing at all from its finger for this long lost its pointerup
  // (an OS gesture stole the touch, say) and is released, because a held button is the worst
  // failure this layer has.
  GESTURE_STALL_MS: 20 * 1000,

  // ---- the guest cursor ----
  // Windows 3.1 moves the cursor 1 px per unit of a relative event up to 2 units and 2 px per unit
  // beyond, per axis, and clips it to the frame. A single positive event of 256 units or more wraps
  // modulo 256 (and -300 does something else again), so a send never exceeds MAX_SEND_UNITS.
  MAX_SEND_UNITS: 255,
  // The biggest chunk a move sends. Two sends can land in one guest callback on a slow device and
  // their units are summed there, so two chunks must stay under the 256 that wrap: 90 + 90 = 180.
  MAX_CHUNK_UNITS: 90,
  // The least time between two motion sends (and between the last one and a button event). The guest
  // sums the units of sends that arrive within a frame, ~16.7 ms, and applies Windows' gain to the sum:
  // a pair of 2-unit sends moves 8 px instead of 4. Measured with the oracle, pairs were summed 40 of 40
  // times at 14 ms, 11 of 40 at 16 ms and 0 of 40 from 18 ms. Over 18 screens x 144 taps every spacing
  // from 16 to 40 stayed within 3 px (worst 3 at 16, 2 from 18). 24 is the boundary plus 7 ms rather
  // than the smallest value that passes (18): the margin costs nothing a person can feel (the click
  // follows the lift by 0.1 ms, because the cursor walks during the touch) and the phone's emulator is
  // unmeasured. 40 ms costs 9 ms per click, because the press waits for the spacing to run out.
  SEND_SPACING_MS: 24,
  // Homing: this many (HOME_UNITS, HOME_UNITS) sends clip the cursor into the top-left corner,
  // which is the one position the model knows exactly. 4 x 400 px is twice the biggest frame. A
  // single -2000 also worked in one run and is unproven across boots.
  HOME_SENDS: 4,
  HOME_UNITS: -200,
  // The button is held this long for a click. Windows needs the press to be seen as a state.
  CLICK_HOLD_MS: 50,
  // Re-homing is for drift the model cannot see, and the cursor is part of the stream the
  // spectators watch, so it is rare: only after this long with nothing happening AND more than
  // REHOME_AFTER_MOVES moves since the last home. The cursor returns to where it was.
  IDLE_REHOME_MS: 900,
  REHOME_AFTER_MOVES: 12,
  // Safety net: never go this many sends without a home, even mid-use.
  FORCED_REHOME_SENDS: 600,
  // A move op gives up after this many sends (a target that keeps running away from a stalled
  // emulator would otherwise loop for ever); the next gesture starts a new one.
  MAX_SENDS_PER_MOVE: 200,

  // ---- feedback ----
  // How long a tap ring lives (the animation in global.scss, `.touch-feedback--tap`, is the same 420 ms;
  // this is what the cleanup timer is built on), and how many may be on screen at once.
  FEEDBACK_RING_MS: 420,
  FEEDBACK_MAX_RINGS: 8,
}

/**
 * Letting the guest sleep while the screen is still (EmulatorPowerService, IdlePowerMachine).
 * DOSBox pins one core at 100% even on a static menu (measured: 101.8% of an Apple-silicon core,
 * 1.5% with `pause()`, and lowering `cycles` changes nothing), and a manager game spends most of
 * its time on static menus. These numbers are policy, and they were set on a desktop: the phone
 * numbers are on the device checklist.
 */
export const EMULATOR_POWER = {
  // Whether a player who never touched the switch has it on. Off: at the roadmap's 2 s the scripted
  // rounds ran 1.8 times slower with the saver on, and the 20 s that fixes that was set on a desktop,
  // for a feature that exists for a phone. The numbers, and what flips this, are in CLAUDE.md,
  // *Letting the guest sleep*; it is one constant. The FAQ entry follows it and IDLE_MS by binding;
  // the menu's "Ainda não foi testado em celulares de verdade" (game.page.html) is prose about the
  // device pass and is revised by hand in the commit that flips this.
  DEFAULT_ENABLED: false,
  // No frame for this long and the guest may sleep, and no input either (INPUT_QUIET_MS). The roadmap
  // said 2 s; the scripted rounds said no. Elifoot spends whole seconds with the picture untouched while
  // it works, with no input at all: on a desktop (Apple silicon, headless Chrome 143, 640x480) the
  // gaps between two frames in play were 2.8 to 4.9 s, a 6 to 7.4 s one two seconds after the key that
  // starts a round, and the longest, 9.3 to 10.3 s, 38 s after the last key (the end of a match). A
  // guest put to sleep in the middle of one runs the rest at the probe's duty cycle, so the idle time
  // has to sit above the longest gap the game makes; 20 s is twice the longest seen here, and the
  // longest on a phone is on the device checklist. A still menu, the case this exists for, is still
  // for minutes. A focused text field blinks its caret every ~0.55 s and keeps the guest awake for as
  // long as it is focused.
  IDLE_MS: 20000,
  // When a frame arrives from a guest that was put to sleep, it was working, and the idle time grows to
  // twice the quiet stretch that ended (see IdlePowerMachine.frame), up to this. The first stall on a
  // slow device costs one stretched computation, not one every round. 0 turns it off.
  MAX_IDLE_MS: 120000,
  // No input for this long either. The same reasoning from the other side: a gap that starts with a tap
  // (the weekly update after a round) is the most likely to be a computation.
  INPUT_QUIET_MS: 20000,
  // How often the rule is checked. The clock is the timer's, so every duration below is a multiple
  // of this to within a tick.
  TICK_MS: 250,
  // The duty-cycle probe: asleep this long, then running for PROBE_MS, then asleep again, until a
  // frame arrives in a probe (which proves the guest is doing something visible and wakes it).
  // 250 ms of every 2.25 s measured 14.6% of a core against ~100% awake and ~1% for a hard pause.
  // What it buys over the hard pause is guest-side work that never redraws: it still advances, at
  // roughly one ninth of its speed.
  SLEEP_MS: 2000,
  PROBE_MS: 250,
  // 'probe' (the default) or 'hard' (never resume until something happens). The hard pause is NOT
  // on: it would freeze each of those silent stretches (up to 10 s on a desktop) until the next touch,
  // and it saves 12 points of a core over the probe (3% against 15%, measured).
  POLICY: 'probe' as 'probe' | 'hard',
  // A timer that fires a hair early must not cost a probe a whole extra tick.
  SLACK_MS: 25,
  // When the look at the game's save dialog does not say "not up", it is not repeated sooner than this.
  LOOK_RETRY_MS: 1000,
  // A look that could not tell (auto-save off, no OCR) will not be able to a second later either, so each one
  // in a row doubles the wait up to this. It keeps a page where the saver is inert from asking, and from
  // filling the diagnostics log, once a second for as long as the screen is still.
  LOOK_RETRY_MAX_MS: 15000,
  // The look is a screenshot and a cached verdict (~0.1 ms), or one OCR pass for a strip never read;
  // it has no deadline of its own, and a look that hangs is an answer of "could not tell".
  LOOK_TIMEOUT_MS: 3000,
  // The page's own events that mean somebody is using the game. Capture phase on the document, so
  // they run before the touch layer's listener on the emulator's root stops the event.
  INPUT_EVENTS: ['pointerdown', 'pointerup', 'keydown', 'keyup', 'touchstart', 'wheel'] as readonly string[],
}

/**
 * Keeping the screen on while the game runs (WakeLockService, WakeLockHelper). A phone dims and locks
 * after 30 to 60 s without a touch, and Elifoot plays whole matches and seasons without one; a locked
 * page is a hidden page, where js-dos pauses the emulator, and a host's stream freezes for everyone.
 */
export const WAKE_LOCK = {
  // Whether a player who never touched the switch has it on (decision D10: on in solo play, with a
  // toggle). A room holds the screen whatever the switch says: a locked host closes the room.
  DEFAULT_ENABLED: true,
  // A lock the browser takes back within this long of granting it is an unstable one, not a lock that
  // was ended by the system: after QUICK_RELEASE_LIMIT in a row the service stops asking on its own
  // (a page that is visible again, or a new choice, starts it over). iOS standalone web apps had
  // versions that granted and released at once (recalled, unverified), and a loop of requests is the
  // wrong answer to that.
  QUICK_RELEASE_MS: 2000,
  QUICK_RELEASE_LIMIT: 3,
  // A request refused with NotAllowedError (battery saver, a browser that wants a gesture first) is
  // asked again on a later tap, but not on every tap: at most this often.
  GESTURE_RETRY_MIN_MS: 30 * 1000,
  // The page's own events that count as "a gesture" for that retry. Capture phase, passive, and only
  // while a refusal is waiting for one.
  GESTURE_EVENTS: ['pointerup', 'touchend', 'keydown'] as readonly string[],
}

/**
 * The game's audio when the browser has put its context to sleep, and the player's own volume
 * (AudioHealthService, AudioHealthHelper).
 */
export const AUDIO_HEALTH = {
  // js-dos builds its AudioContext inside run(), before any gesture, and wakes it from a one-shot
  // listener. After a phone call, a lock or a Bluetooth change the context can be 'suspended' or (WebKit)
  // 'interrupted' again, and only a resume() from a gesture brings it back. The chip says so after the
  // page had this long to fix it by itself, so it does not flash during an ordinary resume.
  BLOCKED_GRACE_MS: 1200,
  // The events that may carry the user activation resume() needs. touchstart is not among them: on iOS
  // it does not unlock audio, touchend and click do.
  GESTURE_EVENTS: ['pointerup', 'touchend', 'click', 'keydown'] as readonly string[],
  DEFAULT_VOLUME: 1,
  // The slider moves in percent and in steps of this many.
  VOLUME_STEP_PERCENT: 5,
  // One tap is three events that each ask for a resume; the diagnostics log writes the first of them.
  RESUME_LOG_GAP_MS: 1000,
}

/** Fullscreen, and the phone in portrait that the "Gire o aparelho" hint is for. */
export const FULLSCREEN = {
  // A phone is a viewport whose short side is under this (css px): a Pro Max is 430, a small tablet 600+.
  PHONE_MAX_SHORT_SIDE_PX: 600,
}

/** The two one-time toasts of the platform polish: how long each stays, if it is not dismissed first. */
export const PLATFORM_NUDGES = {
  ROTATE_TOAST_MS: 12 * 1000,
  INSTALL_TOAST_MS: 20 * 1000,
}

export const BASE_SAVEGAME_DIR = 'd/eli98/jogos/'

export enum Endianness {
  BIG_ENDIAN = 'big',
  LITTLE_ENDIAN = 'little',
}

export const EMULATOR_RAM_SIZE = 0x800000; // 8MB

export const MEMORY_SEARCH_PARAMS = {
  CHUNK_SIZE: 0x100000, // 1MB
  MAX_RESULTS: 10000,
}

export const MULTIPLAYER = {
  APP_ID: 'br.com.elifoot98.multiplayer',
  DEFAULT_CURSOR_COLOR: '#aa00aa',
  EVENTS: { // WARNING: names must be unique and at most 32 bytes (trystero's action-wire typeByteLimit)
    PLAYER_IDENT: 'Ident',
    PLAYER_CURSOR_POS: 'pPosition',
    PLAYER_CLICK: 'pClick',
    CHAT_MESSAGE: 'chatMsg',
    // Ask a peer what it is. Registered by both roles: a host uses it to notice
    // another host, a guest to pull the host's identity without waiting.
    ROLE_QUERY: 'roleQuery',
    // Sent once, targeted, by a host to each joining peer.
    HOST_ANNOUNCE: 'hostAnnounce',
    // "I am composing". Fire and forget: never retried, never acknowledged.
    TYPING: 'typing',
  },
  ROLE_QUERY_TIMEOUT: 5000, // 5 seconds
  // When two hosts collide, the one that has been hosting longer keeps the room. Each
  // side reports its own elapsed time, so there is no shared clock to skew — but the
  // two samples are taken moments apart, so differences under this tolerance are
  // treated as simultaneous and settled by selfId instead.
  HOST_AGE_TOLERANCE: 2000, // 2 seconds
  PING_TIMEOUT: 5000, // 5 seconds
  PING_REFRESH_INTERVAL: 10000, // 10 seconds
  // Latency bands for PlayerInfo.quality. Owned here rather than in the roster component so
  // the pill, the roster and the instability warning cannot disagree about what "poor" is.
  PING_GOOD_MAX: 150, // under this, 'good'
  PING_FAIR_MAX: 400, // under this, 'fair'; at or above, 'poor'
  // Minimum gap between two "connection is unstable" notices about the same peer. The
  // notice is edge-triggered as well, so this only bounds a peer that keeps flapping.
  CONNECTION_WARNING_COOLDOWN: 30000, // 30 seconds
  // How long a guest holds the last frame, waiting for a dropped host to come back, before
  // giving up and reporting the room as over. Long enough to ride out a WiFi handover or a
  // brief tunnel, short enough that a genuinely closed room does not feel hung.
  HOST_GRACE_TIMEOUT: 13000, // 13 seconds
  // Minimum gap between outgoing "I am typing" pings, so a fast typist sends a handful of
  // them rather than one per keystroke.
  TYPING_SEND_THROTTLE_MS: 2000,
  // How long a received typing ping stands before it is assumed stale. Must exceed the
  // throttle above, or a peer that keeps typing would flicker in and out.
  TYPING_EXPIRY_MS: 5000,
  // How long an arrival must last before "Fulano entrou na sala." is written to the
  // transcript. A second host that tries a code already in use joins, loses the tie-break
  // and yields within a few hundred milliseconds; without this, every spectator in the
  // established room reads a join and a leave for someone who was never in their room.
  // The line is stamped with the moment of arrival, not of flushing, so ordering holds.
  SYSTEM_JOIN_LINE_DELAY: 1500,
  CURSOR_Z_INDEX: 10, // Cursors should be above the game elements
  CURSOR_CLICK_Z_INDEX: 9, // Click pings should be below the cursors
  // How long a guest waits for the host's video stream before giving up.
  // A room code that nobody is hosting is indistinguishable from an empty room —
  // trystero joins a room name, not a host — so silence is the only signal there is.
  // Failures trystero *can* report (a wrong password, a dead relay) arrive via
  // onJoinError and cut this short.
  STREAM_WAIT_TIMEOUT: 20000, // 20 seconds
  // Minimum interval between outgoing cursor position broadcasts (~20/s).
  CURSOR_SEND_THROTTLE_MS: 50,
  // How long a cursor may sit still before its name label fades out, leaving the arrow.
  // A pointer that is being used moves; one that is parked is either forgotten or
  // deliberate cover over the game. Since only a *changed* position re-shows the label,
  // re-sending the same coordinates cannot hold a name on screen.
  CURSOR_LABEL_IDLE_MS: 2000,
  // Hard ceiling on the rendered width of a cursor name, in characters. Equal to
  // WIRE_MAX_NAME_LENGTH, so it elides nothing a peer can currently send — it is the
  // backstop that keeps one label's footprint bounded if that cap ever moves, since the
  // label sits on top of the game and every pixel of it is occlusion.
  CURSOR_LABEL_MAX_CHARS: 20,
  // Room codes use an alphabet without easily confused characters (no O/0, I/1).
  ROOM_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  ROOM_CODE_PREFIX: 'ELI-',
  ROOM_CODE_LENGTH: 4,
  // Palette offered in the join/host dialogs for the player's cursor colour.
  PLAYER_COLORS: [
    '#aa00aa', '#e6194b', '#f58231', '#ffe119',
    '#3cb44b', '#42d4f4', '#4363d8', '#911eb4',
  ],
  // Ceilings applied to anything arriving off the wire. A peer is not the dialog: the
  // `maxlength` attributes in the chat composer (200) and the room-setup name field (20)
  // bind our own UI and nothing else, so these mirror them on the receiving side. Sized
  // to match rather than to be generous — a value a peer's own UI could not have produced
  // is not one we need to render.
  WIRE_MAX_TEXT_LENGTH: 200,
  WIRE_MAX_NAME_LENGTH: 20,
  WIRE_MAX_ID_LENGTH: 64,
  // Ceiling on a peer's self-reported hosting duration, used by the host-collision
  // tie-break. Generous (24h) because a real host may legitimately run for hours and
  // disbelieving a marathon session would be a worse failure than the forgery it guards
  // against.
  WIRE_MAX_HOSTING_MS: 86400000,
  // How many spectators a room may hold, the host not counted. The ceiling is Elifoot's own
  // limit of six players; the host picks anything from 1 up to it, and the default leaves
  // existing hosts' behaviour unchanged. Each spectator costs the host a WebRTC encode and
  // upload of the canvas, so this is the one lever against a room filling up.
  MIN_SPECTATORS: 1,
  MAX_SPECTATORS: 6,
  DEFAULT_MAX_SPECTATORS: 6,
  // How long a spectator keeps waiting for a stream after being told the room is full,
  // before believing it. The refusal arrives as a claim from an unverified peer, so a
  // stream that shows up inside this window wins — see MultiplayerService.onRoomFullClaim.
  ROOM_FULL_GRACE_MS: 5000,
  // How long after the first peer connection is built, with no relay candidate seen, before the
  // relay is called unavailable. A working relay hands out its first candidate within a second or
  // two, so this is generous; it exists because the other signal, a connection finishing its
  // gathering, takes ~40s when some servers simply do not answer, and a spectator gives up on a
  // join after 20s — a verdict that arrives later than that can never reach the message it is for.
  RELAY_VERDICT_MS: 10000,
  // How long a refusing host listens for the other side's answer before tearing the
  // handshake down. Only a rival host answers; a spectator never does, so for the common
  // case this is simply how long the refusal takes to complete.
  HOST_REPLY_WAIT_MS: 1000,
  // How long an admitted-but-not-yet-active peer keeps holding a slot. trystero abandons a
  // handshake after 10s (`handshakeTimeoutMs`), and a peer that dies mid-handshake fires
  // no event of its own, so the slot has to expire by itself.
  ADMISSION_HOLD_MS: 11000,
}
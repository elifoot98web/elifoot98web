export interface DosCI {
    // * get bundle config
    config: () => Promise<any>;

    // * current render buffer width
    height: () => number;

    // * current render buffer height
    width: () => number;

    // * sound frequency
    soundFrequency: () => number;

    // * `screenshot()` - get screnshot of canvas as ImageData
    screenshot: () => Promise<ImageData>;

    // * `pause()` - pause emulation (also mute all sounds)
    pause: () => void;

    // * `resume()` - resume emulation (also unmute all sounds)
    resume: () => void;

    // * `mute()` - mute all sounds
    mute: () => void;

    // * `unmute()` - unmute all sounds
    unmute: () => void;

    // * `exit()` - exit from runtime
    exit: () => Promise<void>;

    // * `simulateKeyPress(...keyCodes)` - allows to simulate key press **AND** release event for key code
    // see `sendKeyPress` to find meaning of keyCode. Key combination is supported when more than 1 keyCode is set.
    //
    // NEVER CALL THIS. It stamps the release 16 ms in the future, so a second call within 16 ms
    // permanently wedges the guest keyboard. Send through GuestKeyQueueService, which uses only
    // `sendKeyEvent`. The only other caller was js-dos's own on-screen keyboard, which is no longer
    // in the page (game.js), and ESLint now rejects any reference to this name (eslint.config.mjs).
    /** @deprecated wedges the guest keyboard if two calls land within 16 ms; use GuestKeyQueueService. */
    simulateKeyPress: (...keyCodes: number[]) => void;

    // * `sendKeyEvent(keyCode, pressed)` - sends single key (press or release) event to backend.
    // Only GuestKeyQueueService calls it: the queue is what spaces the events out.
    sendKeyEvent: (keyCode: number, pressed: boolean) => void;

    // * `sendMouseMotion` - sends mouse motion event to backend, position is in range [0, 1]
    sendMouseMotion: (x: number, y: number) => void;

    // * `sendRelativeMotion` - sends mouse motion event to backend, position is absolute diff of position
    sendMouseRelativeMotion: (x: number, y: number) => void;

    // * `simulateMouseButton` - sends mouse button event (press or release) to backend
    sendMouseButton: (button: number, pressed: boolean) => void;

    // * `sendMouseSync` - sends mouse sync event 
    sendMouseSync: () => void;

    // dump **changed** FS as Uint8Array <zip archive>
    persist(): Promise<Uint8Array>;

    // events
    events(): CommandInterfaceEvents;

    /**
     * Reads data from emulator memory
     * @param address address in emulator memory
     * @param size amount of data to read
     * @returns data read from emulator memory
     */
    readMemory(address: number, size: number): Promise<Uint8Array>

    /**
     * Writes data to emulator memory
     * @param address address in emulator memory
     * @param data data to write
     * @returns number of bytes written
     */
    writeMemory(address: number, data: Uint8Array): Promise<number>
}

export type MessageType = "log" | "warn" | "error" | string;

export interface CommandInterfaceEvents {
    onStdout: (consumer: (message: string) => void) => void;
    onFrameSize: (consumer: (width: number, height: number) => void) => void;
    onFrame: (consumer: (rgb: Uint8Array) => void) => void;
    onSoundPush: (consumer: (samples: Float32Array) => void) => void;
    onExit: (consumer: () => void) => void;

    onMessage: (consumer: (msgType: MessageType, ...args: any[]) => void) => void;
}
var dosInstance

// js-dos builds its AudioContext privately (ScriptProcessor(2048, 0, 1) -> Gain -> destination,
// inside dosInstance.run()) and exposes none of it, so the only way to get the game's sound
// out as a MediaStreamTrack is to keep hold of the one node it creates. This runs before
// elifootMain does, and js-dos touches AudioContext only inside run(), so the wrapper is in
// place in time. The (_, 0, 1) match is deliberate: a no-input, one-output processor is
// js-dos's, and anything else that ever creates one must not be mistaken for it.
var dosAudioNode = null
;(() => {
    for (const Ctx of [window.AudioContext, window.webkitAudioContext]) {
        if (!Ctx || !Ctx.prototype.createScriptProcessor) continue
        const original = Ctx.prototype.createScriptProcessor
        Ctx.prototype.createScriptProcessor = function (...args) {
            const node = original.apply(this, args)
            if (args[1] === 0 && args[2] === 1) dosAudioNode = node
            return node
        }
    }
})()

/** The game's audio node, or null if js-dos has not started (or has closed) its context. */
var getDosAudioNode = () => {
    return dosAudioNode != null && dosAudioNode.context.state !== "closed" ? dosAudioNode : null
}

// How long the boot may go without js-dos writing anything new to its loading text before we
// stop waiting, and the most one wait may last however busy that text keeps. Both are per call
// to elifootMain, so "keep waiting" after a timeout gets a fresh allowance.
//
// The stall window is not the old flat 15 s. That clock started before the 6.7 MB bundle began
// to download and stopped only when run() resolved, so a slow first visit was a failure and the
// caller reloaded it into the same failure. Now the clock restarts on every change of
// .emulator-loading-pre-2, which js-dos rewrites on each XHR progress event ("Downloading bundle
// 43.2%") and each extracted chunk ("Extracting 61% (hdd.img)").
//
// One step is silent by construction: once the download is complete js-dos fetches and compiles
// wdosbox.wasm (1.4 MB raw) before the first "Extracting" line, and it says nothing while it
// does. That step is the same link as the download, so it gets a longer window of its own: with
// the whole page throttled to 40 KB/s the gap after "Downloading bundle 100%" was 43 s, and the
// flat 20 s asked "Continuar esperando?" of a boot that was one download from done.
const BOOT_STALL_MS = 20 * 1000
const BOOT_STALL_AFTER_DOWNLOAD_MS = 60 * 1000
const BOOT_HARD_CAP_MS = 120 * 1000

/** An Error whose `name` the caller can switch on: the message is for the console only. */
const bootError = (name, message, extra) => {
    const error = new Error(message)
    error.name = name
    return Object.assign(error, extra)
}

// The boot of this document: pending while js-dos is still working, "failed" once it threw,
// "ok" once it resolved. It exists so that a timeout is only the end of one *wait*. The
// download is still running behind it, and starting a second Dos() on the same #game-container
// to "retry" would stack a second DOSBox on the first. elifootMain called again while the boot
// is pending, or after it failed, therefore re-attaches to it and reports what it did. So does
// a call after it succeeded if no caller has been told yet (the only one timed out, and the
// boot finished while the user was reading the dialog).
//
// Re-attaching is only right for the page that started the boot. Dos() builds its canvas, mouse
// layer and keyboard inside the element it was given, and GamePage is destroyed and rebuilt
// within one document (browser Back to the landing page, then Jogar), which leaves the boot
// holding a container that is no longer in the DOM: the new page would get a dosCI whose
// picture and input are in a detached tree, or the old failure replayed without a real attempt.
// So a boot is also replaced when #game-container is not the element it was started in.
// The abandoned one is not stopped (stop() cannot cancel a download in flight); that is the
// same ghost the code had before there was a boot to re-attach to.
let elifootBoot = null

/** Whether `elifootMain` may hand a new caller this boot instead of starting another. */
const isAttachable = (boot) => {
    if (boot == null) return false
    const container = document.getElementById("game-container")
    if (container == null || boot.container !== container) return false
    return !(boot.state === "ok" && boot.delivered)
}

/**
 * Watch js-dos's own loading text. It is the only progress js-dos exposes, and it is plain DOM:
 * `setLoadingMessage(t)` is `loaderText.innerHTML = t` on `.emulator-loading-pre-2`.
 * `boot.observing` says whether there was an element to watch; without one the stall window
 * means nothing (a boot nobody can observe is not "stalled"), see waitForBoot.
 */
const watchLoaderText = (boot) => {
    const target = document.querySelector("#game-container .emulator-loading-pre-2")
    if (target == null || typeof MutationObserver === "undefined") return () => {}

    const read = () => (target.textContent || "").trim()
    boot.lastText = read()
    const observer = new MutationObserver(() => {
        const text = read()
        // innerHTML is rewritten with identical text now and then; only a *change* is progress.
        if (text === boot.lastText) return
        boot.lastText = text
        boot.listeners.forEach((listener) => listener(text))
    })
    observer.observe(target, { childList: true, characterData: true, subtree: true })
    boot.observing = true
    return () => observer.disconnect()
}

const startBoot = (pathPrefix, gameBundleURL) => {
    const container = document.getElementById("game-container")
    const boot = { state: "pending", delivered: false, observing: false, lastText: "", listeners: new Set(), container, promise: null }
    boot.promise = (async () => {
        let stopWatching = () => {}
        try {
            emulators.pathPrefix = pathPrefix
            console.log("Carregando js-dos + elifoot")
            // Not awaited: Dos() builds the DOM layers synchronously and returns the instance, and
            // the loading text must be under watch before waitForBoot arms its first timer.
            dosInstance = Dos(container, {
                style: "none"
            })
            stopWatching = watchLoaderText(boot)
            console.log("DOS instance created...")
            console.log("Loading game bundle...")
            const dosCI = await dosInstance.run(gameBundleURL)
            boot.state = "ok"
            return dosCI
        } catch (error) {
            boot.state = "failed"
            // The real error, name and message intact: callers tell a slow boot (JsdosTimeoutError)
            // from a broken one by it. Anything that is not an Error (a string, a plain
            // { name, message } from a worker) is wrapped with what it carries, not lost.
            throw error instanceof Error ? error : bootError(
                typeof (error && error.name) === "string" ? error.name : "Error",
                typeof (error && error.message) === "string" ? error.message : String(error),
                { cause: error })
        } finally {
            stopWatching()
        }
    })()
    // A boot nobody is waiting on any more (the caller timed out) must not become an unhandled
    // rejection; waitForBoot hears about it through its own .then.
    boot.promise.catch(() => {})
    return boot
}

const waitForBoot = (boot, onProgress) => new Promise((resolve, reject) => {
    let finished = false
    let stallTimer = null
    let capTimer = null
    let reported = null

    const report = (text) => {
        if (typeof onProgress !== "function" || !text || text === reported) return
        reported = text
        try {
            onProgress(text)
        } catch (error) {
            console.warn("elifootMain: onProgress threw", error)
        }
    }
    const finish = (settle, value) => {
        if (finished) return
        finished = true
        clearTimeout(stallTimer)
        clearTimeout(capTimer)
        boot.listeners.delete(onText)
        settle(value)
    }
    const timeOut = (message) => {
        finish(reject, bootError("JsdosTimeoutError", message, { lastProgress: boot.lastText }))
    }
    // No element to watch means the stall window cannot tell slow from stuck, so the only
    // honest deadline left is the hard cap.
    const stallWindow = () => {
        if (!boot.observing) return BOOT_HARD_CAP_MS
        return /^Downloading bundle 100(\.0+)?%$/.test(boot.lastText) ? BOOT_STALL_AFTER_DOWNLOAD_MS : BOOT_STALL_MS
    }
    const armStall = () => {
        clearTimeout(stallTimer)
        const limit = stallWindow()
        stallTimer = setTimeout(
            () => timeOut("jsdos wrote no progress for " + limit / 1000 + " seconds"), limit)
    }
    const onText = (text) => {
        armStall()
        report(text)
    }

    boot.listeners.add(onText)
    boot.promise.then((dosCI) => {
        // Only a waiter still waiting is told; one that timed out leaves the result for the next.
        if (!finished) boot.delivered = true
        finish(resolve, dosCI)
    }, (error) => finish(reject, error))
    capTimer = setTimeout(
        () => timeOut("jsdos did not finish within " + BOOT_HARD_CAP_MS / 1000 + " seconds"),
        BOOT_HARD_CAP_MS)
    armStall()
    // Whoever (re)attaches should see the current step at once, not after the next change.
    report(boot.lastText)
})

/**
 * Boot js-dos into #game-container and run the game bundle; resolves with the command interface.
 *
 * `onProgress(text)` receives js-dos's own loading text each time it changes ("Starting...",
 * "Downloading bundle 43.2%", "Extracting 61% (hdd.img)", "Ready"), in English and unparsed.
 * Turning it into something to show is the caller's job.
 *
 * Rejects with the REAL error from Dos() or run() (name and message untouched), or with an
 * Error named "JsdosTimeoutError" (and `lastProgress`, the last loading text) when js-dos goes
 * BOOT_STALL_MS without changing that text (BOOT_STALL_AFTER_DOWNLOAD_MS once the download is
 * complete) or one wait passes BOOT_HARD_CAP_MS. A timeout ends the wait, not the boot: call
 * again to keep waiting for the same one (while #game-container is still the element it was
 * started in; a rebuilt page gets a boot of its own, see elifootBoot).
 *
 * Never hand `gameBundleURL` anything but the bundle's own URL (no blob:, no renamed copy).
 * js-dos keys the saved changes layer by it ("<url>.changes"), and PatchService hardcodes the
 * same key, so a different URL leaves every existing save behind.
 */
var elifootMain = (pathPrefix, gameBundleURL, onProgress) => {
    if (!isAttachable(elifootBoot)) {
        elifootBoot = startBoot(pathPrefix, gameBundleURL)
    }
    return waitForBoot(elifootBoot, onProgress)
}

var saveGameFileSystem = async () => {
    if(dosInstance != null && dosInstance.layers != null && dosInstance.layers.save != null && typeof dosInstance.layers.save === "function") {
        return await dosInstance.layers.save()
    }
} 

var toggleSoftKeyboard = () => {
    let keyboardDiv = document.getElementsByClassName("emulator-keyboard")[0]
    if(keyboardDiv.style.display == "none") {
        keyboardDiv.style.display = "block"
    } else {
        keyboardDiv.style.display = "none"
    }
}

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

var elifootMain = async (pathPrefix, gameBundleURL) => {
    // wait up to 15 seconds for the promise to resolve
    return new Promise(async (resolve, reject) => {
        emulators.pathPrefix = pathPrefix
        console.log("Carregando js-dos + elifoot")
        const timeout = setTimeout(() => {
            reject(new Error("jsdos timed out after 15 seconds"));
        }, 15000);

        dosInstance = await Dos(document.getElementById("game-container"), {
            style: "none"
        })
        console.log("DOS instance created...")
        console.log("Loading game bundle...")
        const dosCI = await dosInstance.run(gameBundleURL);
        clearTimeout(timeout);
        resolve(dosCI)
    });
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

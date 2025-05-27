var dosInstance
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

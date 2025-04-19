var dosInstance
var elifootMain = async (pathPrefix, gameBundleURL) => {
    emulators.pathPrefix = pathPrefix
    console.log("Carregando js-dos + elifoot")

    dosInstance = await Dos(document.getElementById("game-container"), {
        style: "none"
    })
    const dosCI = await dosInstance.run(gameBundleURL);
    
    return dosCI
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

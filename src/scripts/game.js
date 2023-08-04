var dosInstance
var elifootMain = async () => {
    emulators.pathPrefix = "assets/js-dos/"
    console.log("Carregando js-dos + elifoot")

    dosInstance = await Dos(document.getElementById("game-container"), {
        style: "none"
    })
    const dosCI = await dosInstance.run("assets/elifoot/elifoot98.jsdos");
}

var saveGameFileSystem = async () => {
    if(dosInstance != null && dosInstance.layers != null && dosInstance.layers.save != null && typeof dosInstance.layers.save === "function") {
        await dosInstance.layers.save()
    }
} 

var toggleKeyboard = () => {
    let keyboardDiv = document.getElementsByClassName("emulator-keyboard")[0]
    if(keyboardDiv.style.display == "none") {
        keyboardDiv.style.display = "block"
    } else {
        keyboardDiv.style.display = "none"
    }
}

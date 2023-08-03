var dosInstance
var keyboardBtn
var elifootMain = async () => {
    emulators.pathPrefix = "assets/js-dos/";
    console.log("Carregando jsdos + elikg");
    dosInstance = await Dos(document.getElementById("game-container"), {
        style: "none"
    })
    const dosCI = await dosInstance.run("assets/elifoot/elifoot98.jsdos");

    /// save state
    // let dosInstance = await Dos(document.getElementById("game-container"))
    // await dos.layers.save();
    // let dosCI = await dosInstance.run("assets/elifoot/elifoot.jsdos");

    const settingsBtn = document.getElementsByClassName("emulator-options")[0]
    keyboardBtn = settingsBtn.children[1];
}

var saveGameFileSystem = async () => {
    if(dosInstance != null && dosInstance.layers != null && dosInstance.layers.save != null && typeof dosInstance.layers.save === "function") {
        await dosInstance.layers.save();
    }
} 



var toggleKeyboard = () => {
    let mouseEvent = new MouseEvent('mousedown', { button: 0 });
    if(keyboardBtn && keyboardBtn.dispatchEvent) {
        keyboardBtn.dispatchEvent(mouseEvent);
    }
}

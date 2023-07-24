console.log("MaIN")
var dosCI
var contraSenha = "" 
var shouldConsole = true       

var elikgMain = async (senha, tipo) => {
    emulators.pathPrefix = "assets/elikg/js-dos/";
    console.log("Carregando elikg")
    dosCI = await Dos(document.getElementById("jsdos"), {
        style: "none",
    }).run("assets/elikg/elikg2.jsdos");
    console.log("Carregado!")
    
    let sendCmd = (commandStr, withnewLine) => {
        let keyCodes = commandStr.split("").map((char) => { return char.charCodeAt(0) })
        if(withnewLine) {
            keyCodes.push(257) // enter keycode for jsdos
        }
    
        iterateKeys(keyCodes, 0)
    }
    
    let iterateKeys = (keyCodes, i) => {
        if (i < keyCodes.length) {
            let k = keyCodes[i]
            dosCI.simulateKeyPress(keyCodes[i])
            setTimeout(() => {
                iterateKeys(keyCodes, i + 1)
            }, 15)
        }
    }

    return new Promise(async (resolve, reject) => {
        let timeout = setTimeout(() => {
            reject("Timeout")
        }, 15000)

        dosCI.events().onStdout((e) => {
            if(shouldConsole) {
                // console.log(e)
            }

            let str = "" + e
            if(str.startsWith("Contra-senha: ")) {
                shouldConsole = false;
                contraSenha = str.replace("Contra-senha: ", "").trim()
                console.log(`>>>>>>>> Contra-senha: ${contraSenha}`)
                clearTimeout(timeout)
                resolve(contraSenha)
                dosCI.exit()
            }
        })

        setTimeout(() => {
            sendCmd(tipo) // tipo de registro
            setTimeout(() => {
                sendCmd(senha, true) // teste serial
            }, 500)
        }, 1500);
    })
}

var sendCmd = (commandStr, withnewLine) => {
    let keyCodes = commandStr.split("").map((char) => { return char.charCodeAt(0) })
    if(withnewLine) {
        keyCodes.push(257) // enter keycode for jsdos
    }

    iterateKeys(keyCodes, 0)
}

var iterateKeys = (keyCodes, i) => {
    if (i < keyCodes.length) {
        let k = keyCodes[i]
        
        console.log(`sending key: ${String.fromCharCode(k)}(${k})`)
        dosCI.simulateKeyPress(keyCodes[i])
        setTimeout(() => {
            iterateKeys(keyCodes, i + 1)
        }, 50)
    }
}
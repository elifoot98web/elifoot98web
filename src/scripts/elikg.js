var elikgMain = async (senha, tipo) => {
    let initialized = false
    emulators.pathPrefix = "assets/elikg/js-dos/";
    console.log("Carregando jsdos + elikg")
    let dosCI = await Dos(document.getElementById("jsdos"), {
        style: "none",
    }).run("assets/elikg/elikg2.jsdos");
    
    
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
            }, 50)
        }
    }

    return new Promise(async (resolve, reject) => {
        let timeout = setTimeout(() => {
            reject("Timeout")
        }, 15000)

        dosCI.events().onStdout((e) => {
            
            let str = "" + e

            if(str.startsWith("S - Sair")) {
                initialized = true;
                console.log("Carregamento concluído")
            } else if(str.startsWith("Contra-senha: ")) {
                shouldConsole = false;
                let contraSenha = str.replace("Contra-senha: ", "").trim()
                clearTimeout(timeout)
                dosCI.exit()
                resolve(contraSenha)
            }
        })

        let start = (counter) => {
            if(!initialized) {
                console.log(`await jsdos initialization... ${counter}`)
                setTimeout(() => {
                    start(counter+1)
                }, 25);
                return
            }
            sendCmd(tipo) // tipo de registro
            setTimeout(() => {
                sendCmd(senha, true)
            }, 1200)
        }
        start(1)
    })
}

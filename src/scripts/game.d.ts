/**
 * Boot js-dos into #game-container and run the game bundle; resolves with the command
 * interface (`DosCI`, see core/typings/jsdos.d.ts).
 *
 * `onProgress` gets js-dos's own loading text each time it changes ("Downloading bundle 43.2%",
 * "Extracting 61% (hdd.img)", "Ready"...), in English and unparsed: BootProgressHelper turns it
 * into the pt-BR line the page shows.
 *
 * It rejects with the real error that `Dos()` or `run()` threw (name and message untouched), or
 * with an Error whose `name` is `JsdosTimeoutError` and whose `lastProgress` is the last loading
 * text, when js-dos goes 20 s without changing that text (60 s once the download is complete,
 * the one silent step) or one wait passes 120 s. A timeout ends
 * the wait and not the boot: calling again re-attaches to the boot still running, and one that
 * already failed reports the same failure again instead of starting a second DOSBox. That holds
 * while `#game-container` is the element the boot was started in; once the page has been rebuilt
 * (Back, then Jogar) the call starts a boot of its own.
 */
declare function elifootMain(pathPrefix: string, gameBundleURL: string, onProgress?: (loaderText: string) => void): Promise<any>;
declare function saveGameFileSystem(): Promise<void>;
declare var dosInstance: any;
declare function getDosAudioNode(): ScriptProcessorNode | null;

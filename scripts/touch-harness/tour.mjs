// Distinct Elifoot screens at 640x480, as offsets from the frame's centre (so it also holds at 800x600, where the window is
// centred). Each step is real clicks through the touch layer and ends ON the screen to be graded; `after` leaves it again.
// Enter closes the dialogs (their default button); Esc closes a menu.
import { KEY } from './nav.mjs'

const C = { x: 320, y: 240 }
const at = (x, y, wait) => s => s.tapC(x - C.x, y - C.y, wait)

export const STEPS = [
  { name: 'main-jogo', go: async () => undefined },
  { name: 'tab-jogador', go: at(410, 451) },
  { name: 'tab-financas', go: at(481, 451) },
  { name: 'tab-seleccao', go: at(535, 451) },
  { name: 'tab-adversario', go: at(590, 451) },
  { name: 'menu-elifoot', go: at(33, 31), after: s => s.key(KEY.esc) },
  { name: 'menu-campeonato', go: at(317, 31), after: s => s.key(KEY.esc) },
  { name: 'dlg-opcoes', go: async s => { await at(33, 31)(s); await at(50, 50, 1500)(s) }, after: s => s.key(KEY.enter, 1200) },
  { name: 'dlg-estadio', go: async s => { await at(183, 31)(s); await at(200, 50, 1500)(s) }, after: s => s.key(KEY.enter, 1200) },
  { name: 'dlg-historial', go: async s => { await at(183, 31)(s); await at(195, 69, 1500)(s) }, after: s => s.key(KEY.enter, 1200) },
  { name: 'dlg-melhores-marcadores', go: async s => { await at(317, 31)(s); await at(375, 69, 1500)(s) }, after: s => s.key(KEY.enter, 1200) },
  { name: 'dlg-calendario', go: async s => { await at(317, 31)(s); await at(338, 87, 1500)(s) }, after: s => s.key(KEY.enter, 1200) },
]

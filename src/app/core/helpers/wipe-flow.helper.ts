/**
 * The two questions "Apagar todos os dados" asks, and the rule that the second is not answered by a stray tap. The wipe used to be one
 * dialog ("Aviso", Não / Sim) under "Importar jogos salvos" in a popover, and its "Sim" looked like every other one (DANGER-1). Now:
 *
 * 1. **The backup is offered first.** "Baixar backup agora" is the first button, "Continuar" is the second, and the dialog says why: a
 *    wipe cannot be undone, and a copy of the saves is the only thing that can. The backup button leaves the dialog open (it is
 *    one of the things the player does on the way to the next question), so the same dialog answers "now that I have it".
 * 2. **A box has to be ticked.** The last dialog's destructive button does nothing until "Entendo que vou perder meus jogos salvos"
 *    is checked, and says so when it is pressed without. A checkbox and not a typed word on purpose: a soft keyboard is the hardest
 *    thing to use on the device this is for, and a tick is a deliberate act that a thumb's slip does not make.
 *
 * The words live here so that they can be read in one place and checked, and the rule ({@link confirmed}) so that it can be tested.
 * Kept free of Angular so it can be tested on plain values.
 */
export class WipeFlowHelper {

  /** The value of the one checkbox of the last dialog. */
  static readonly CONFIRM_VALUE = 'entendo';

  static first(): { header: string; message: string; backup: string; next: string; cancel: string } {
    return {
      header: 'Antes de apagar',
      message:
        'Apagar remove todos os jogos salvos e as configurações deste navegador, e não dá para desfazer.\n\n' +
        'Baixe uma cópia dos seus jogos agora: é ela que permite recuperar tudo depois.',
      backup: 'Baixar backup agora',
      next: 'Continuar',
      cancel: 'Cancelar',
    };
  }

  static second(): { header: string; message: string; reminder: string; checkbox: string; confirm: string; cancel: string } {
    return {
      header: 'Apagar tudo?',
      message: 'Esta é a última pergunta. Marque a caixa para liberar o botão.',
      reminder: 'Marque a caixa antes de apagar.',
      checkbox: 'Entendo que vou perder meus jogos salvos',
      confirm: 'Apagar tudo',
      cancel: 'Cancelar',
    };
  }

  /** Whether the checkbox group the alert hands to a button's handler has the box ticked. Anything else is a no. */
  static confirmed(values: unknown): boolean {
    return Array.isArray(values) && values.includes(WipeFlowHelper.CONFIRM_VALUE);
  }
}

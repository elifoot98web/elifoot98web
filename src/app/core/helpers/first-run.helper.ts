import { HelpTopic } from './help-topic.helper';

export interface FirstRunCard {
  id: 'tap' | 'type' | 'save';
  /** An ionicon. */
  icon: string;
  title: string;
  /** Short, in the order they are read. Plain text: the coach draws no markup. */
  lines: string[];
  /** Where "Saiba mais" opens the guide. */
  help: HelpTopic;
  /** The icon pulses a ring, the one the touch layer draws where a tap landed: a hint of "touch here", so only the card about touching. */
  pulse?: boolean;
}

/**
 * The first minute of the app: what the player has to know to tap, to type and to keep what they did, in three cards. It replaced a
 * 643-character alert that told people to "learn to play" from a FAQ and a manual that do not teach the game, described a
 * touchpad that is no longer how a phone works, and said nothing about typing or about backups. The cards are written for the
 * device the player has (a finger or a mouse), because "Toque" is the wrong word to a person with a mouse and "Esc solta o mouse"
 * is noise to a person with a finger.
 *
 * Whether the coach is shown is also decided here ({@link FirstRunHelper.due}), so the rule has a spec. It reuses the flag the
 * old alert wrote (`STORAGE_KEY.HIDE_TUTORIAL`): a player who already pressed "Entendi" on the old welcome has answered this one
 * too, and is not shown it again on upgrade. Kept free of Angular so it can be tested on plain values.
 */
export class FirstRunHelper {

  /** The flag is stored as `true` once the coach was answered. An unreadable store counts as answered, see {@link FirstRunHelper.due}. */
  static due(input: {
    /** What `STORAGE_KEY.HIDE_TUTORIAL` held: `true` once answered, anything else (absent, `null`, `false`) when not. */
    stored: unknown;
    /** The store could be read at all. With site data blocked every read rejects; see below. */
    readable: boolean;
    /** The boot saw the game's own screen. Over a screen that never rendered a coach is worse than silence. */
    gameSeen: boolean;
    /** This visit already did what the person came for (`?host=1` and a room that is now on the air): it is not the moment. */
    hostedThisVisit: boolean;
  }): boolean {
    // A coach that cannot remember it was answered would greet the person on every visit: the same rule as the one-time nudges.
    if (!input.readable) return false;
    if (input.stored === true) return false;
    if (!input.gameSeen) return false;
    return !input.hostedThisVisit;
  }

  /** The three cards. `touch` is whether a finger is how this device is used (`(pointer: coarse)`). */
  static cards(input: { touch: boolean }): FirstRunCard[] {
    return [
      input.touch ? FirstRunHelper.tapOnTouch() : FirstRunHelper.clickOnDesktop(),
      input.touch ? FirstRunHelper.typeOnTouch() : FirstRunHelper.typeOnDesktop(),
      FirstRunHelper.saveCard(),
    ];
  }

  /** The line under the last card: the project's promise, which the old alert opened with. */
  static readonly FOOTER = 'Projeto gratuito e de código aberto, sem cobranças nem coleta de dados.';

  /** The card to show after pressing back (-1) or next (+1) on `index`, never outside the deck. */
  static move(index: number, step: -1 | 1, count: number): number {
    return Math.min(Math.max(index + step, 0), Math.max(count - 1, 0));
  }

  private static tapOnTouch(): FirstRunCard {
    return {
      id: 'tap',
      icon: 'hand-left-outline',
      pulse: true,
      title: 'Toque para clicar',
      lines: [
        'O clique acontece onde o seu dedo está. Toque duas vezes para um clique duplo.',
        'Para acertar um botão bem pequeno, segure o dedo parado por meio segundo: o cursor aparece acima do dedo e o clique acontece quando você solta.',
      ],
      help: 'touch',
    };
  }

  private static clickOnDesktop(): FirstRunCard {
    return {
      id: 'tap',
      icon: 'desktop-outline',
      title: 'Clique para jogar',
      lines: [
        'Clique na tela do jogo e use o mouse como sempre. Ele fica preso na janela do jogo.',
        'Aperte Esc para soltar o mouse.',
      ],
      help: 'touch',
    };
  }

  private static typeOnTouch(): FirstRunCard {
    return {
      id: 'type',
      icon: 'keypad-outline',
      title: 'Digite pela aba Texto',
      lines: [
        'O painel de teclas, junto da imagem, tem F1 a F12, as setas, Enter e as outras teclas do jogo.',
        'Para escrever um nome, toque em Texto: o que você digitar vai para o jogo, com acentos.',
      ],
      help: 'typing',
    };
  }

  private static typeOnDesktop(): FirstRunCard {
    return {
      id: 'type',
      icon: 'keypad-outline',
      title: 'Escreva com acentos pelo menu',
      lines: [
        'Você pode digitar normalmente, mas o jogo não entende teclas de acento.',
        'Para nomes como João ou Kaká, use o menu ⋮ > Digitar texto.',
      ],
      help: 'typing',
    };
  }

  private static saveCard(): FirstRunCard {
    return {
      id: 'save',
      icon: 'save-outline',
      title: 'Salve e faça backup',
      lines: [
        'O jogo é salvo no navegador quando o Elifoot grava, e o menu ⋮ mostra quando foi a última vez (Salvar agora).',
        'Se você limpar os dados do navegador, os jogos somem. Faça um backup em menu ⋮ > Dados e avançado > Exportar jogos salvos.',
      ],
      help: 'save',
    };
  }
}

import { EmulatorKeyCode } from './emulator-keycode.enum';

export class EmulatorKeyCodeHelper {
    static getKeyStrokeForCharacter(char: string): EmulatorKeyCode[] {
        const supportedCharsRegex = /^[a-zA-Z0-9!@#$%^&*()_+{}|:"<>?`~\[\]\\;',./\-=\n\r\s]+$/;
        // Check if the character is supported
        if (!supportedCharsRegex.test(char)) {
            console.warn(`Unsupported character: ${char} (${char.charCodeAt(0)} | 0x${char.charCodeAt(0).toString(16)})`);
            return [];
        }

        const keyStroke: EmulatorKeyCode[] = []
        if (char === ' ') {
            keyStroke.push(EmulatorKeyCode.KBD_space);
        } else if (char === '\n') {
            keyStroke.push(EmulatorKeyCode.KBD_enter);
        } else if (char === '\t') {
            keyStroke.push(EmulatorKeyCode.KBD_tab);
        } else if (char === '\b') {
            keyStroke.push(EmulatorKeyCode.KBD_backspace);
        } else if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')) {
            keyStroke.push(EmulatorKeyCode[('KBD_' + char) as keyof typeof EmulatorKeyCode]);
        } else if (char >= 'A' && char <= 'Z') {
            keyStroke.push(EmulatorKeyCode.KBD_leftshift);
            keyStroke.push(EmulatorKeyCode[('KBD_' + char.toLowerCase()) as keyof typeof EmulatorKeyCode]);
        } else if (')!@#$%^&*('.includes(char)) { // Handle special characters above numeric keys
            keyStroke.push(EmulatorKeyCode.KBD_leftshift);
            const index = ')!@#$%^&*('.indexOf(char);
            keyStroke.push(EmulatorKeyCode[('KBD_' + index) as keyof typeof EmulatorKeyCode]);
        } else if ('`-=[]\\;\',./'.includes(char)) {
            switch (char) {
                case '`':
                    keyStroke.push(EmulatorKeyCode.KBD_grave);
                    break;
                case '-':
                    keyStroke.push(EmulatorKeyCode.KBD_minus);
                    break;
                case '=':
                    keyStroke.push(EmulatorKeyCode.KBD_equals);
                    break;
                case '[':
                    keyStroke.push(EmulatorKeyCode.KBD_leftbracket);
                    break;
                case ']':
                    keyStroke.push(EmulatorKeyCode.KBD_rightbracket);
                    break;
                case '\\':
                    keyStroke.push(EmulatorKeyCode.KBD_backslash);
                    break;
                case ';':
                    keyStroke.push(EmulatorKeyCode.KBD_semicolon);
                    break;
                case '\'':
                    keyStroke.push(EmulatorKeyCode.KBD_quote);
                    break;
                case ',':
                    keyStroke.push(EmulatorKeyCode.KBD_comma);
                    break;
                case '.':
                    keyStroke.push(EmulatorKeyCode.KBD_period);
                    break;
                case '/':
                    keyStroke.push(EmulatorKeyCode.KBD_slash);
                    break;
                default:
                    console.warn(`Unsupported character: ${char} (${char.charCodeAt(0)})`);
                    return [];
            }
        } else if ('~_+{}|:"<>?'.includes(char)) { // Handle special characters with shift
            keyStroke.push(EmulatorKeyCode.KBD_leftshift);
            switch (char) {
                case '~':
                    keyStroke.push(EmulatorKeyCode.KBD_grave);
                    break;
                case '_':
                    keyStroke.push(EmulatorKeyCode.KBD_minus);
                    break;
                case '+':
                    keyStroke.push(EmulatorKeyCode.KBD_equals);
                    break;
                case '{':
                    keyStroke.push(EmulatorKeyCode.KBD_leftbracket);
                    break;
                case '}':
                    keyStroke.push(EmulatorKeyCode.KBD_rightbracket);
                    break;
                case '|':
                    keyStroke.push(EmulatorKeyCode.KBD_backslash);
                    break;
                case ':':
                    keyStroke.push(EmulatorKeyCode.KBD_semicolon);
                    break;
                case '"':
                    keyStroke.push(EmulatorKeyCode.KBD_quote);
                    break;
                case '<':
                    keyStroke.push(EmulatorKeyCode.KBD_comma);
                    break;
                case '>':
                    keyStroke.push(EmulatorKeyCode.KBD_period);
                    break;
                case '?':
                    keyStroke.push(EmulatorKeyCode.KBD_slash);
                    break;
                default:
                    console.warn(`Unsupported character: ${char}`);
                    return [];
            }
        }

        return keyStroke;
    }
}
import { defineConfig, globalIgnores } from "eslint/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default defineConfig([globalIgnores(["projects/**/*"]), {
    files: ["src/**/*.ts"],
    ignores: [".angular", "dist", "node_modules", ".github", ".vscode"],
    extends: compat.extends(
        "plugin:@angular-eslint/recommended",
        "plugin:@angular-eslint/template/process-inline-templates",
    ),

    languageOptions: {
        ecmaVersion: 5,
        sourceType: "script",

        parserOptions: {
            project: ["tsconfig.json"],
            createDefaultProgram: true,
        },
    },

    rules: {
        "@angular-eslint/component-class-suffix": ["error", {
            suffixes: ["Page", "Component"],
        }],

        "@angular-eslint/component-selector": ["error", {
            type: "element",
            prefix: "app",
            style: "kebab-case",
        }],

        "@angular-eslint/directive-selector": ["error", {
            type: "attribute",
            prefix: "app",
            style: "camelCase",
        }],
        
        "@angular-eslint/prefer-standalone": "off",

        // `dosCI.simulateKeyPress` stamps the key's release 16 ms in the future, so a second call
        // within 16 ms loses its key and leaves the guest keyboard dead until a reload. The key
        // queue (GuestKeyQueueService) sends raw sendKeyEvent pairs with a gap and is the ONLY
        // sender; js-dos's own on-screen keyboard was the last other caller and is gone, so this
        // is now enforced, not just documented. The typing in core/typings/jsdos.d.ts is a
        // property SIGNATURE, which none of these selectors match; it is how the name stays
        // declared (and @deprecated) without being callable from app code.
        "no-restricted-syntax": ["error",
            {
                selector: "MemberExpression[property.name='simulateKeyPress'], MemberExpression[property.value='simulateKeyPress']",
                message: "Never call dosCI.simulateKeyPress: two calls within 16 ms wedge the guest keyboard. Send keys through GuestKeyQueueService (EmulatorControlService.sendKey / sendString).",
            },
            {
                selector: "Property[key.name='simulateKeyPress'], Property[key.value='simulateKeyPress']",
                message: "Do not provide or destructure simulateKeyPress: it wedges the guest keyboard. Send keys through GuestKeyQueueService.",
            },
        ],
    },
}, {
    files: ["src/**/*.html"],
    extends: compat.extends("plugin:@angular-eslint/template/recommended"),
    rules: {},
}]);
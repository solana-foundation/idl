import solanaConfig from '@solana-config/oxc/oxlint';
import { defineConfig } from 'oxlint';

export default defineConfig({
    extends: [solanaConfig],
    ignorePatterns: [
        // Universal patterns mirroring what was previously ignored in the JSON config.
        // Oxlint already respects `.gitignore`; these remain as a safety net.
        '**/dist/',
        '**/lib/',
        '**/*.json',
        // The Next.js app under `web/` has its own lint setup.
        'web/',
    ],
    options: {
        typeAware: true,
    },
});

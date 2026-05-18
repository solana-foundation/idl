import solanaConfig from '@solana-config/oxc/oxfmt';
import { defineConfig } from 'oxfmt';

export default defineConfig({
    ...solanaConfig,
    ignorePatterns: [
        // Build outputs (also gitignored).
        '**/dist/',
        '**/lib/',
        // The Next.js app under `web/` has its own format setup.
        'web/',
    ],
});

import { defineConfig } from 'tsup';

/**
 * Dual-format build for `@solana/security-txt`, matching the rest of the
 * Solana ecosystem (`@solana/kit`, `@solana-program/*`, `@solana/idl`):
 *
 *   - Library entry (`src/index.ts`) → `dist/index.js` (ESM) + `dist/index.cjs` (CJS)
 *   - CLI entry     (`src/cli.ts`)   → `dist/cli.js`   (ESM, with `#!/usr/bin/env node` shebang)
 *
 * Type declarations are emitted separately by `tsc --emitDeclarationOnly`
 * (see `tsconfig.build.json`) and live alongside the bundles in `dist/`.
 *
 * Runtime deps (`@solana-program/program-metadata`, `commander`) and the
 * `@solana/kit` peer dep are kept external so consumers get a single copy
 * resolved through their own `node_modules`. The CLI's color helpers are
 * inlined in `src/colors.ts` to avoid a dependency on `picocolors`.
 */
export default defineConfig([
    {
        clean: true,
        entry: { index: 'src/index.ts' },
        format: ['esm', 'cjs'],
        outDir: 'dist',
        outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
        platform: 'node',
        sourcemap: true,
        splitting: false,
        target: 'node20',
        treeshake: true,
    },
    {
        clean: false,
        entry: { cli: 'src/cli.ts' },
        format: ['esm'],
        outDir: 'dist',
        platform: 'node',
        sourcemap: true,
        splitting: false,
        target: 'node20',
        treeshake: true,
    },
]);

# @solana/idl

[![npm](https://img.shields.io/npm/v/%40solana%2Fidl.svg)](https://www.npmjs.com/package/@solana/idl)
[![license](https://img.shields.io/npm/l/%40solana%2Fidl.svg)](./LICENSE)

Fetch and reconstruct Solana program IDLs from on-chain accounts. Supports both **Anchor IDL** accounts and the **Solana Program Metadata Program (PMP)** end-to-end, including full historical reconstruction by replaying on-chain transactions.

| Surface                                  | Use case                                                            |
| ---------------------------------------- | ------------------------------------------------------------------- |
| **npm package** `@solana/idl`            | Import in Node services and tools                                   |
| **CLI** `idl`                            | Same logic from the terminal                                        |
| **Web + HTTP API** (`web/` in this repo) | Hosted UI + JSON endpoints; live at https://idl-explorer.vercel.app |

## Install

```bash
npm install @solana/idl @solana/kit
# or
bun add @solana/idl @solana/kit
```

`@solana/kit` is a peer dependency.

## Library

```ts
import { createSolanaRpc, address } from '@solana/kit';
import {
    fetchCurrentIdlPreferPmp,
    reconstructAnchorHistory,
    reconstructPmpHistory,
    buildPmpIdlLookups,
} from '@solana/idl';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const programId = address('BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya');

// Resolve the live IDL: canonical PMP → non-canonical PMP → Anchor.
const current = await fetchCurrentIdlPreferPmp(rpc, programId);
if (current) console.log(current.type, current.idl);

// Full PMP history. Most published IDLs live under the non-canonical fallback
// authority, so try every candidate PDA (canonical + fallback) and keep the
// first non-empty history. Pass an explicit authority to `buildPmpIdlLookups`
// if you uploaded under a custom one.
const lookups = await buildPmpIdlLookups(programId, 'idl');
let pmpHistory: Awaited<ReturnType<typeof reconstructPmpHistory>> = [];
for (const { address: pda } of lookups) {
    pmpHistory = await reconstructPmpHistory(rpc, pda);
    if (pmpHistory.length > 0) break;
}

// Full Anchor history.
const anchorHistory = await reconstructAnchorHistory(rpc, programId);
```

### Exports

| Export                                             | Purpose                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `fetchCurrentIdlPreferPmp`                         | Latest IDL, PMP-first with Anchor fallback                         |
| `fetchCurrentAnchorIdlString`                      | Latest raw Anchor IDL string only                                  |
| `reconstructPmpHistory`                            | Replay PMP transactions into a history of `VirtualState` snapshots |
| `reconstructAnchorHistory`                         | Replay Anchor IDL transactions into a history of snapshots         |
| `findAnchorIdlAddress`, `findPmpMetadataPda`       | PDA derivation helpers                                             |
| `buildPmpIdlLookups`, `fetchPmpIdlContentResolved` | Lower-level PMP resolution                                         |
| `IDL_FALLBACK_PMP_AUTHORITY`                       | Non-canonical PMP authority used by `fetchCurrentIdlPreferPmp`     |

Types: `CurrentIdlResponse`, `CurrentIdlSource`, `SolanaRpcClient`, `VirtualState`, `Snapshot`, `PmpIdlLookup`, `ResolvedPmpIdl`.

## CLI

After installing globally (or via `npx`), the `idl` binary fetches and inspects program IDLs:

```bash
npx @solana/idl <program-address> [options]
```

Options:

| Flag                        | Description                                                         |
| --------------------------- | ------------------------------------------------------------------- |
| `-r, --rpc <url>`           | Solana RPC URL (or set `RPC_URL`)                                   |
| `-t, --type <type>`         | IDL type: `pmp`, `anchor`, or `both` (auto-detected if omitted)     |
| `-s, --seed <seed>`         | PMP metadata seed (default `idl`)                                   |
| `-a, --authority <address>` | Authority for non-canonical PMP metadata                            |
| `-o, --output <dir>`        | Save full state snapshots                                           |
| `--dump-idls <dir>`         | Write each distinct IDL version + `index.json` timeline             |
| `--current`                 | Print only the latest IDL JSON (PMP→Anchor); mirrors `GET /api/idl` |

Examples:

```bash
# Fetch the current IDL only (PMP first, else Anchor).
npx @solana/idl BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya --current

# Dump all distinct Anchor IDL versions.
npx @solana/idl <program> --type anchor --dump-idls ./idls
```

## How history reconstruction works

The history APIs (`reconstructAnchorHistory` / `reconstructPmpHistory`) replay every on-chain transaction that touched the program's IDL metadata account (and related buffer accounts) and apply each relevant instruction to a virtual state.

- **Anchor**: legacy IDL instructions and Anchor 0.30+ instructions — `Create`, `CreateBuffer`, `Write`, `SetBuffer`, `SetAuthority`, `Close`, and the `idl_*` variants. Buffer payloads are reconstructed by replaying writes to those accounts.
- **PMP**: SPL Program Metadata instructions — `Allocate`, `Write`, `Initialize`, `SetData`, `SetAuthority`, `SetImmutable`, `Trim`, `Close`, `Extend`.

The `--current` / `fetchCurrentIdlPreferPmp` paths skip replay and read live chain state, so they are dramatically cheaper than a full history scan.

## IDL resolution order

`fetchCurrentIdlPreferPmp` resolves in this order:

1. **Canonical PMP** with the requested seed (default `idl`).
2. **Non-canonical PMP** using `IDL_FALLBACK_PMP_AUTHORITY` (`fndnu15…`).
3. **Anchor** IDL account.

Returns `null` if none resolves.

## Development

```bash
bun install
bun test           # unit + offline integration
bun run build      # emit dist/ via tsc
bun run typecheck
```

Run the live-RPC integration suite by setting `RPC_URL`:

```bash
RPC_URL=https://api.mainnet-beta.solana.com bun run test:integration
```

A Next.js UI + HTTP API live under `web/` — see `web/README.md` (or the project's `idl-explorer.vercel.app` deployment).

## License

MIT — see [LICENSE](./LICENSE).

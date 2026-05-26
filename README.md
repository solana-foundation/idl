# @solana/idl

[![npm](https://img.shields.io/npm/v/%40solana%2Fidl.svg)](https://www.npmjs.com/package/@solana/idl)
[![license](https://img.shields.io/npm/l/%40solana%2Fidl.svg)](./LICENSE)

Fetch and reconstruct Solana program IDLs from on-chain accounts. Supports both **Anchor IDL** accounts and the **Solana Program Metadata Program (PMP)** end-to-end, including full historical reconstruction by replaying on-chain transactions.

| Surface                                  | Use case                                                            |
| ---------------------------------------- | ------------------------------------------------------------------- |
| **npm package** `@solana/idl`            | Import in Node services and tools                                   |
| **CLI** `idl`                            | Same logic from the terminal — bare IDL, `--latest`, or `--history` |
| **Web + HTTP API** (`web/` in this repo) | Hosted UI + JSON endpoints; live at https://idl-explorer.vercel.app |

## Install

```bash
npm install @solana/idl @solana/kit
# or
pnpm add @solana/idl @solana/kit
```

`@solana/kit` is a peer dependency.

## Library

```ts
import { createSolanaRpc, address } from '@solana/kit';
import { fetchIdl, fetchLatestIdls, fetchAllHistories } from '@solana/idl';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const programId = address('BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya');

// Lean: just the current IDL (canonical PMP → fndn fallback PMP → Anchor).
// Same as GET /api/idl.
const current = await fetchIdl(rpc, programId);
if (current) console.log(current.type, current.idl);

// Rich: PMP + Anchor side-by-side with slot/time/version. Same as GET /api/latest.
const latest = await fetchLatestIdls(rpc, programId);
console.log(latest.pmp[0]?.slot, latest.anchor[0]?.slot);

// Full history of every revision, both PMP and Anchor side-by-side.
// Same as POST /api/history.
const history = await fetchAllHistories(rpc, programId);
console.log(history.pmp.length, 'PMP snapshots');
console.log(history.anchor.length, 'Anchor snapshots');
```

For a single source only, use `reconstructPmpHistory(rpc, programId, opts?)` or `reconstructAnchorHistory(rpc, programId)` directly.

### Exports

| Export                                           | Purpose                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| `fetchIdl`                                       | Live IDL, PMP-first with fndn fallback then Anchor fallback                  |
| `fetchAnchorIdl`                                 | Live Anchor IDL only: `{ content, address }`                                 |
| `fetchPmpIdl`                                    | Live PMP IDL only: `{ content, address, authority }` (canonical then fndn)   |
| `fetchLatestIdls`                                | PMP + Anchor side-by-side with version/slot/time (powers `--latest`)         |
| `fetchAllHistories`                              | Full PMP + Anchor history side-by-side (powers `--history` / `/api/history`) |
| `reconstructPmpHistory`                          | Replay PMP transactions into a history of `VirtualState` snapshots           |
| `reconstructAnchorHistory`                       | Replay Anchor IDL transactions into a history of snapshots                   |
| `findAnchorIdlAddress`, `findPmpMetadataAddress` | PDA derivation helpers                                                       |
| `buildPmpIdlLookups`                             | Enumerate PMP PDAs to try (canonical + every fndn fallback)                  |
| `IDL_FALLBACK_PMP_AUTHORITIES`                   | Array of non-canonical PMP authorities baked into `fetchIdl` / `fetchPmpIdl` |

Types: `Idl`, `IdlSource`, `AnchorIdl`, `PmpIdl`, `PmpIdlLookup`, `LatestIdls`, `LatestIdlVersion`, `AllHistories`, `VirtualState`, `Snapshot`, `SolanaRpcClient`.

## CLI

The `idl` binary mirrors the library and has three modes, each backed by the same core function the API uses:

| Mode                     | Flag        | Output                                                                                           | Backing function                                     | API parity          |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------- |
| **Bare IDL** _(default)_ | _(none)_    | Just the IDL body on stdout — pretty JSON if parsable, otherwise the raw string                  | `fetchIdl`                                           | `GET /api/idl`      |
| **Latest side-by-side**  | `--latest`  | `{programId, pmpAddress, anchorAddress, pmp[], anchor[]}` with version/slot/time for each source | `fetchLatestIdls`                                    | `GET /api/latest`   |
| **Full history**         | `--history` | Pretty timeline of every revision (plus optional `--output` / `--dump-idls`)                     | `reconstructPmpHistory` / `reconstructAnchorHistory` | `POST /api/history` |

Live IDL resolution (default and `--latest`) always follows the same order: **canonical PMP → fndn fallback PMP → Anchor**. History replay (`--history`) auto-detects unless you pin `--type`.

> **Parsed vs. raw IDL.** Bare mode emits the IDL **parsed** as pretty JSON — best when you want to _use_ the IDL (codegen, jq, inspection). `--latest` and `--history` emit the IDL **as a raw string** inside their wrapper — best when you want to _record_ or _compare_ it (hashing, diffing, byte-stable storage). `JSON.parse` ↔ `JSON.stringify` is not guaranteed to be a byte-for-byte round trip, so the indexer-flavored modes preserve the on-chain bytes verbatim.

```bash
npx @solana/idl <program-address> [options]
```

### Options

| Flag                        | Description                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `-r, --rpc <url>`           | Solana RPC URL (or set `RPC_URL` env var)                                                                 |
| `-s, --seed <seed>`         | Metadata seed, PMP only (default `idl`)                                                                   |
| `-a, --authority <address>` | Authority address for non-canonical PMP metadata                                                          |
| `--latest`                  | Print the `{programId, pmpAddress, anchorAddress, pmp[], anchor[]}` payload (same shape as `/api/latest`) |
| `--history`                 | Replay the full IDL version history from on-chain transactions                                            |
| `-t, --type <type>`         | **`--history` only.** IDL type: `pmp`, `anchor`, or `both` (auto-detected if omitted)                     |
| `-o, --output <dir>`        | **`--history` only.** Save full state snapshots to directory                                              |
| `--dump-idls <dir>`         | **`--history` only.** Write each distinct IDL version as JSON + an `index.json` timeline                  |

`--latest` and `--history` are mutually exclusive. The `--type` / `--output` / `--dump-idls` flags are rejected outside `--history`.

### Examples

Bare IDL — just the JSON body, ready to pipe:

```bash
npx @solana/idl BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya \
  --rpc https://api.mainnet-beta.solana.com > idl.json
```

Side-by-side current view with slot + time for each source:

```bash
npx @solana/idl BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya \
  --rpc https://api.mainnet-beta.solana.com --latest
```

Auto-detected full history (timeline on stdout):

```bash
npx @solana/idl BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya \
  --rpc https://api.mainnet-beta.solana.com --history
```

Dump all distinct Anchor IDL versions to a directory:

```bash
npx @solana/idl <program> --history --type anchor --dump-idls ./idls
```

Reconstruct both PMP and Anchor IDL history at once:

```bash
npx @solana/idl <program> --history --type both --dump-idls ./idls
```

When using `--history --type both`, paths for both `--output` and `--dump-idls` are automatically split into `<dir>/pmp/` and `<dir>/anchor/`.

## Web app

A Next.js UI and HTTP API live under `web/`. The UI exposes the same three capabilities as the API: **current IDL** (`GET /api/idl`), **latest PMP + Anchor** (`GET /api/latest`), and **full history** (`POST /api/history`). A cluster switcher (mainnet/devnet) sits in the header and is threaded through every API request. Testnet is intentionally not supported since the Program Metadata program isn't deployed there.

```bash
cd web
cp .env.example .env.local   # set RPC_MAINNET / RPC_DEVNET
npm install
npm run dev                   # http://localhost:3000
```

Deploy to Vercel by setting the project **root directory** to `web` and adding `RPC_MAINNET` and/or `RPC_DEVNET` in the environment. A legacy `RPC_URL` is still honored as a fallback for `mainnet-beta` only.

### API endpoints

All routes accept a **`cluster`** parameter (`mainnet-beta` (default) or `devnet`). For `GET` routes pass it as a query parameter; for `POST /api/history` include it in the JSON body. A request to a cluster whose env var is unset returns `500` naming the missing variable.

**`GET /api/idl?programId=<address>&cluster=<cluster>`** — Returns the **current** IDL (canonical PMP, then non-canonical PMP via the fallback authority, then Anchor):

```json
{
    "programId": "BUYux…",
    "type": "pmp",
    "idl": {}
}
```

`type` is `"pmp"` or `"anchor"`. `idl` is JSON-parsed when possible, otherwise returned as a string. Returns `400` for a missing or invalid `programId` / `cluster`, `404` when neither source has an IDL, `500` when the cluster's RPC env var is unset.

**`GET /api/latest?programId=<address>&cluster=<cluster>`** — Returns **both** current sources side by side (when present): derived `pmpAddress`, `anchorAddress`, and two arrays `pmp` and `anchor`, each with at most one entry including decoded version metadata and the full `content` string for the live IDL.

> `content` is kept as the **raw on-chain string** (not parsed) on this endpoint and on `POST /api/history` — same reasoning as the CLI's `--latest` / `--history` modes (byte-stable hashing and diffing for indexers). `GET /api/idl` is the parsed/usable view.

**`POST /api/history`** — Reconstructs **distinct** IDL versions over time. Body: `{ "programId": "<address>", "cluster": "<cluster>" }` (cluster defaults to `mainnet-beta`).

Each of `pmp` and `anchor` is an array of objects with `type`, `version`, `slot`, `time`, `activeFrom`, `activeTo` (`"current"` or `{ "slot", "time" }`), and the **`content`** string for that revision. Either array may be empty if that format has no on-chain history.

## How history reconstruction works

The history APIs (`reconstructAnchorHistory` / `reconstructPmpHistory`) replay every on-chain transaction that touched the program's IDL metadata account (and related buffer accounts) and apply each relevant instruction to a virtual state.

- **Anchor**: legacy IDL instructions and Anchor 0.30+ instructions — `Create`, `CreateBuffer`, `Write`, `SetBuffer`, `SetAuthority`, `Close`, and the `idl_*` variants. Buffer payloads are reconstructed by replaying writes to those accounts.
- **PMP**: SPL Program Metadata instructions — `Allocate`, `Write`, `Initialize`, `SetData`, `SetAuthority`, `SetImmutable`, `Trim`, `Close`, `Extend`.

The live paths (`fetchIdl` / `fetchLatestIdls`) skip replay and read live chain state, so they are dramatically cheaper than a full history scan.

## IDL resolution order

`fetchIdl` (and the bare CLI mode) resolve in this order:

1. **Canonical PMP** with the requested seed (default `idl`).
2. **Non-canonical PMP** for every entry of `IDL_FALLBACK_PMP_AUTHORITIES` (currently just `fndnu15…`).
3. **Anchor** IDL account.

Returns `null` if none resolves.

## Development

```bash
pnpm install
pnpm test          # unit + offline integration (recorded fixtures, via vitest)
pnpm run build     # dual ESM + CJS bundles via tsup, .d.ts via tsc
pnpm run typecheck
```

The build emits both `dist/index.js` (ESM) and `dist/index.cjs` (CJS) plus type
declarations, matching the rest of the Solana ecosystem (`@solana/kit`,
`@solana-program/*`). Consumers using `require()` (Node CJS, `tsx` in a CJS
project, `ts-jest`, etc.) and `import` (ESM, modern bundlers) both resolve
through the package `exports` map.

Integration tests run against **recorded fixtures** in `__tests__/fixtures/<program>-<cluster>/` — every RPC response the production code paths need is serialized to disk, so the suite is hermetic and offline. To refresh or add fixtures (requires `RPC_MAINNET` / `RPC_DEVNET` or `web/.env.local`):

```bash
pnpm run record:fixtures BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya mainnet-beta
pnpm run record:fixtures TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA  devnet
```

The recorder reuses any fixture already on disk, so reruns only fetch what's missing.

```bash
pnpm run test:integration    # only the integration suite (fixture-backed, offline)
```

## License

MIT — see [LICENSE](./LICENSE).

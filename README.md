# IDL

**`IDL`** is an npm-oriented toolkit for **requesting and inspecting Solana program IDLs** on-chain. It is built so you can **request the latest IDL easily** (Program Metadata first, Anchor when needed), including a **side-by-side readout of both live sources** when that helps. **Additionally**, you can walk **every historical IDL revision**, each **reconstructed directly from the relevant on-chain transactions**. **Anchor IDL accounts** and **Program Metadata (PMP)** are supported end to end.

| Surface | Use case |
|--------|----------|
| **npm package** `idl` | Import in Node or ship in your own services: `fetchCurrentIdlPreferPmp`, full history reconstruction, PDA helpers |
| **CLI** | Same logic from the terminal (`--current`, history, dumps) |
| **Web + HTTP API** | Hosted UI and JSON endpoints for current, latest, and history |

Live demo (mainnet): https://idl-explorer.vercel.app/

## Setup

```bash
npm install
```

From the repository root you can run the CLI with `npx tsx src/cli.ts …` or, after `npm run build`, via the **`idl`** binary from the published package. For local development from this repo:

```bash
npm start -- <program-address> [options]
```

(`npm start` runs `tsx src/cli.ts` as defined in `package.json`.)

## CLI Usage

The CLI is published as the **`idl`** binary and mirrors the library (including `--current` for the same resolution as `GET /api/idl`).

Run these commands from the **repository root** (the directory that contains `src/cli.ts` and the root `package.json`). If your shell is inside `web/`, use `cd ..` first, or invoke the entrypoint explicitly, for example:

```bash
npx tsx ../src/cli.ts <program-address> [options]
```

From the repo root:

```bash
npx tsx src/cli.ts <program-address> [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-r, --rpc <url>` | Solana RPC URL (or set `RPC_URL` env var) |
| `-t, --type <type>` | IDL type: `pmp`, `anchor`, or `both` (auto-detected if omitted) |
| `-s, --seed <seed>` | Metadata seed, PMP only (default: `idl`) |
| `-a, --authority <address>` | Authority address for non-canonical PMP metadata |
| `-o, --output <dir>` | Save full state snapshots to directory |
| `--dump-idls <dir>` | Write each distinct IDL version as JSON + an `index.json` timeline |
| `--current` | Print only the **latest** on-chain IDL as JSON (PMP first, then Anchor); same rules as `GET /api/idl`. Cannot be combined with `--type`, `--output`, or `--dump-idls` |

### Examples

Auto-detect IDL type and display history:

```bash
npx tsx src/cli.ts BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya \
  --rpc https://api.mainnet-beta.solana.com
```

Fetch only the current IDL (PMP preferred, else Anchor), as JSON on stdout:

```bash
npx tsx src/cli.ts BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya \
  --rpc https://api.mainnet-beta.solana.com \
  --current
```

Dump all distinct Anchor IDL versions to a directory:

```bash
npx tsx src/cli.ts BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya \
  --rpc https://api.mainnet-beta.solana.com \
  --type anchor \
  --dump-idls ./idls
```

Reconstruct both PMP and Anchor IDL history at once:

```bash
npx tsx src/cli.ts BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya \
  --rpc https://api.mainnet-beta.solana.com \
  --type both \
  --dump-idls ./idls
```

When using `--type both`, paths for **both** `--output` and `--dump-idls` are automatically split into `<dir>/pmp/` and `<dir>/anchor/` (for example `./out/pmp` and `./out/anchor` if you pass `--output ./out`).

### Using an environment variable for RPC

```bash
export RPC_URL=https://api.mainnet-beta.solana.com
npx tsx src/cli.ts <program-address> --dump-idls ./idls
```

## Web App

A Next.js UI and HTTP API live under `web/`. The UI exposes the same three capabilities as the API: **current IDL** (`GET /api/idl`), **latest PMP + Anchor** (`GET /api/latest`), and **full history** (`POST /api/history`).

```bash
cd web
cp .env.example .env.local   # set RPC_URL (see .env.example)
npm install
npm run dev                   # http://localhost:3000
```

The IDL **CLI** (`src/cli.ts`) lives at the **repository root**, not inside `web/`. After `cd web`, run the CLI from the parent directory (`cd ..`) or use `npx tsx ../src/cli.ts …` so the path resolves correctly.

Deploy the app to Vercel by setting the project **root directory** to `web` and adding `RPC_URL` in the environment.

### API Endpoints

**`GET /api/idl?programId=<address>`** — Returns the **current** IDL the same way the handler resolves on-chain data: tries PMP first (canonical seed `idl`), then Anchor. Response shape:

```json
{
  "programId": "BUYux…",
  "type": "pmp",
  "idl": { }
}
```

`type` is `"pmp"` or `"anchor"`. The `idl` field is **JSON-parsed when possible**; if parsing fails, it is returned as a **string** (raw IDL text). Returns `400` for a missing or invalid `programId`, `404` when neither source has an IDL, `500` when `RPC_URL` is unset on the server, or `500` on unexpected errors.

**`GET /api/latest?programId=<address>`** — Returns **both** current sources side by side (when present): derived `pmpAddress`, `anchorAddress`, and two arrays `pmp` and `anchor`, each with at most one entry including decoded version metadata and **full `content` string** for the live IDL. Useful when a program has migrated or you want to compare PMP vs Anchor without choosing a single winner.

**`POST /api/history`** — Reconstructs **distinct** IDL versions over time. Body: `{ "programId": "<address>" }`.

Response (200):

```json
{
  "programId": "…",
  "pmpAddress": "…",
  "anchorAddress": "…",
  "pmp": [],
  "anchor": []
}
```

Each of `pmp` and `anchor` is an array of objects with `type`, `version`, `slot`, `time`, `activeFrom`, `activeTo` (`"current"` or `{ "slot", "time" }`), and **`content`** (full IDL JSON string for that revision). Either array may be empty if that format has no on-chain history. Same status codes as above for bad input, missing RPC, or server errors.

## Library Usage

Install from npm when published (`npm install idl`), or depend on this repository and build. Exports live under `dist/` after `npm run build`.

```bash
npm run build
```

```typescript
import { createSolanaRpc } from '@solana/kit';
import {
  reconstructPmpHistory,
  reconstructAnchorHistory,
  findPmpMetadataPda,
  findAnchorIdlAddress,
  fetchCurrentIdlPreferPmp,
} from 'idl';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');

// Latest IDL only (PMP first, then Anchor), same as GET /api/idl
const current = await fetchCurrentIdlPreferPmp(rpc, programAddress);
if (current) console.log(current.type, current.idl);

// Anchor IDL history
const snapshots = await reconstructAnchorHistory(rpc, programAddress);

// PMP IDL history
const pda = await findPmpMetadataPda(programAddress, 'idl');
const pmpSnapshots = await reconstructPmpHistory(rpc, pda);
```

## How history reconstruction works

When you call **history** APIs or `reconstructAnchorHistory` / `reconstructPmpHistory`, the library replays on-chain transactions that touched the program’s IDL metadata account (and related buffer accounts), reconstructing state after each relevant instruction. For **Anchor**, this includes legacy IDL instructions and Anchor 0.30+ style IDL instructions (`Create` / buffer flows, `Write`, `SetBuffer`, `SetAuthority`, `Close`, and the corresponding `idl_*` variants). For **PMP** (SPL Program Metadata), it includes instructions such as `Allocate`, `Write`, `Initialize`, `SetData`, `SetAuthority`, `SetImmutable`, `Trim`, `Close`, and `Extend`. Buffer account payloads are rebuilt by replaying writes to those accounts as well.

**Current** and **latest** paths do not replay history: they read the live chain state (and use the Program Metadata client where appropriate), so they are much cheaper than a full history scan.

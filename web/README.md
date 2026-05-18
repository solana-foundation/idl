# IDL Explorer

Reconstruct the full version history of Solana program IDLs from on-chain transactions. Supports both **Anchor IDL** and **Program Metadata (PMP)** formats.

The app and api is also live for mainnet here: 
https://idl-explorer.vercel.app/ 

## Setup

```bash
npm install
```

## CLI Usage

```bash
npx tsx src/cli.ts <program-address> [options]
```

Three modes, mirroring the HTTP API one-to-one:

| Mode | Flag | Output | API parity |
|------|------|--------|------------|
| **Bare IDL** *(default)* | *(none)* | Just the IDL body — pretty JSON if parsable, otherwise the raw string | the `idl` field of `GET /api/idl` |
| **Latest side-by-side** | `--latest` | `{programId, pmpAddress, anchorAddress, pmp[], anchor[]}` with version/slot/time | `GET /api/latest` |
| **Full history** | `--history` | Pretty timeline of every revision | `POST /api/history` |

Live resolution (default and `--latest`) always follows **canonical PMP → fndn fallback PMP → Anchor**.

### Options

| Flag | Description |
|------|-------------|
| `-r, --rpc <url>` | Solana RPC URL (or set `RPC_URL` env var) |
| `-s, --seed <seed>` | Metadata seed, PMP only (default: `idl`) |
| `-a, --authority <address>` | Authority address for non-canonical PMP metadata |
| `--latest` | Print the `{programId, pmpAddress, anchorAddress, pmp[], anchor[]}` payload |
| `--history` | Replay the full IDL version history from on-chain transactions |
| `-t, --type <type>` | **`--history` only.** IDL type: `pmp`, `anchor`, or `both` |
| `-o, --output <dir>` | **`--history` only.** Save full state snapshots to directory |
| `--dump-idls <dir>` | **`--history` only.** Write each distinct IDL version as JSON + an `index.json` timeline |

### Examples

Bare IDL (default — pipe straight into a file):

```bash
npx tsx src/cli.ts BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya \
  --rpc https://api.mainnet-beta.solana.com > idl.json
```

Auto-detected full history:

```bash
npx tsx src/cli.ts BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya \
  --rpc https://api.mainnet-beta.solana.com \
  --history
```

Dump all distinct Anchor IDL versions to a directory:

```bash
npx tsx src/cli.ts BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya \
  --rpc https://api.mainnet-beta.solana.com \
  --history --type anchor --dump-idls ./idls
```

Reconstruct both PMP and Anchor IDL history at once:

```bash
npx tsx src/cli.ts BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya \
  --rpc https://api.mainnet-beta.solana.com \
  --history --type both --dump-idls ./idls
```

When using `--history --type both`, output is automatically namespaced into `<dir>/pmp/` and `<dir>/anchor/`.

### Using an environment variable for RPC

```bash
export RPC_URL=https://api.mainnet-beta.solana.com
npx tsx src/cli.ts <program-address> --history --dump-idls ./idls
```

## Web App

A Next.js web interface is included in the `web/` directory. The header has a cluster switcher (mainnet/devnet) that is sent through to every API request. Testnet is intentionally not supported since the Program Metadata program isn't deployed there.

```bash
cd web
cp .env.example .env.local   # set RPC_MAINNET / RPC_DEVNET
npm install
npm run dev                   # http://localhost:3000
```

Deploy to Vercel by setting the root directory to `web` and adding `RPC_MAINNET` and/or `RPC_DEVNET` in the environment. A legacy `RPC_URL` is still accepted as a fallback for `mainnet-beta` only.

### API Endpoints

All endpoints accept a `cluster` parameter (`mainnet-beta` (default) or `devnet`) — query string on `GET`, JSON body on `POST`. A request to a cluster whose RPC env var is unset returns `500` with the missing var name.

**`GET /api/idl?programId=<address>&cluster=<cluster>`** -- Returns the current IDL for a program. Checks PMP first (canonical, then every `IDL_FALLBACK_PMP_AUTHORITIES` non-canonical authority), falls back to Anchor.

```json
{
  "programId": "BUYux...",
  "type": "pmp",
  "idl": { ... }
}
```

Returns `404` if no IDL is found for either format.

**`POST /api/history`** -- Reconstructs the full IDL version history (all past versions with slot ranges). Send `{ "programId": "...", "cluster": "..." }` as JSON body.

## Library Usage

The core reconstruction logic can also be used as a library:

```typescript
import { createSolanaRpc } from '@solana/kit';
import {
  reconstructPmpHistory,
  reconstructAnchorHistory,
  findAnchorIdlAddress,
} from '@solana/idl';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');

// Anchor IDL history
const snapshots = await reconstructAnchorHistory(rpc, programAddress);

// PMP IDL history (defaults to canonical authority + seed 'idl')
const pmpSnapshots = await reconstructPmpHistory(rpc, programAddress);
```

## How It Works

The tool replays all on-chain transactions that touched a program's IDL account, reconstructing the state at each point in time. For Anchor programs, it handles `Create`, `Write`, `SetBuffer`, `SetAuthority`, and `Close` instructions. For PMP, it handles `Allocate`, `Write`, `Initialize`, `SetData`, and related instructions. Buffer account data is reconstructed by replaying writes to those accounts as well.

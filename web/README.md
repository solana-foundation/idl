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

### Options

| Flag | Description |
|------|-------------|
| `-r, --rpc <url>` | Solana RPC URL (or set `RPC_URL` env var) |
| `-t, --type <type>` | IDL type: `pmp`, `anchor`, or `both` (auto-detected if omitted) |
| `-s, --seed <seed>` | Metadata seed, PMP only (default: `idl`) |
| `-a, --authority <address>` | Authority address for non-canonical PMP metadata |
| `-o, --output <dir>` | Save full state snapshots to directory |
| `--dump-idls <dir>` | Write each distinct IDL version as JSON + an `index.json` timeline |

### Examples

Auto-detect IDL type and display history:

```bash
npx tsx src/cli.ts BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya \
  --rpc https://api.mainnet-beta.solana.com
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

When using `--type both`, output is automatically namespaced into `<dir>/pmp/` and `<dir>/anchor/`.

### Using an environment variable for RPC

```bash
export RPC_URL=https://api.mainnet-beta.solana.com
npx tsx src/cli.ts <program-address> --dump-idls ./idls
```

## Web App

A Next.js web interface is included in the `web/` directory.

```bash
cd web
cp .env.example .env.local   # edit with your RPC URL
npm install
npm run dev                   # http://localhost:3000
```

Deploy to Vercel by setting the root directory to `web` and adding `RPC_URL` as an environment variable.

### API Endpoints

**`GET /api/idl?programId=<address>`** -- Returns the current IDL for a program. Checks PMP first, falls back to Anchor.

```json
{
  "programId": "BUYux...",
  "type": "pmp",
  "idl": { ... }
}
```

Returns `404` if no IDL is found for either format.

**`POST /api/history`** -- Reconstructs the full IDL version history (all past versions with slot ranges). Send `{ "programId": "..." }` as JSON body.

## Library Usage

The core reconstruction logic can also be used as a library:

```typescript
import { createSolanaRpc } from '@solana/kit';
import {
  reconstructPmpHistory,
  reconstructAnchorHistory,
  findPmpMetadataPda,
  findAnchorIdlAddress,
} from 'idl';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');

// Anchor IDL history
const snapshots = await reconstructAnchorHistory(rpc, programAddress);

// PMP IDL history
const pda = await findPmpMetadataPda(programAddress, 'idl');
const pmpSnapshots = await reconstructPmpHistory(rpc, pda);
```

## How It Works

The tool replays all on-chain transactions that touched a program's IDL account, reconstructing the state at each point in time. For Anchor programs, it handles `Create`, `Write`, `SetBuffer`, `SetAuthority`, and `Close` instructions. For PMP, it handles `Allocate`, `Write`, `Initialize`, `SetData`, and related instructions. Buffer account data is reconstructed by replaying writes to those accounts as well.

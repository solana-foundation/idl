# @solana/idl

[![npm](https://img.shields.io/npm/v/%40solana%2Fidl.svg)](https://www.npmjs.com/package/@solana/idl)
[![license](https://img.shields.io/npm/l/%40solana%2Fidl.svg)](./LICENSE)

Fetch and reconstruct Solana program IDLs from on-chain accounts. Supports both **Anchor IDL** accounts and the **Solana Program Metadata Program (PMP)** end-to-end, including full historical reconstruction by replaying on-chain transactions.

> **Publishing** an IDL is out of scope for this package — use the official [`@solana-program/program-metadata`](https://github.com/solana-program/program-metadata) CLI: `npx @solana-program/program-metadata@latest write idl <program-id> ./idl.json`. This package then reads what that wrote.

| Surface                                  | Use case                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| **npm package** `@solana/idl`            | Import in Node services and tools                                               |
| **CLI** `idl`                            | Same logic from the terminal — bare IDL, `--latest`, `--history`, or `--buffer` |
| **Web + HTTP API** (`web/` in this repo) | Hosted UI + JSON endpoints; live at https://idl-one.vercel.app                  |

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
import {
    fetchIdl,
    fetchIdlWrapped,
    unwrapIdl,
    fetchLatestIdls,
    fetchAllHistories,
    fetchIdlFromBuffer,
} from '@solana/idl';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const programId = address('BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya');

// Headline: the parsed IDL object (canonical PMP → fndn fallback PMP → Anchor),
// or null. Pass your own type for a typed result. Same as GET /api/idl.
const idl = await fetchIdl(rpc, programId); // unknown | null  (fetchIdl<MyIdl> → MyIdl | null)
if (idl) console.log(idl); // ready to use, no parse step

// Need source/address, or to tell "no IDL" (absent) from "undecodable" (corrupt)?
// fetchIdlWrapped returns the full outcome — throws ONLY if the RPC call fails.
const res = await fetchIdlWrapped(rpc, programId);
switch (res.status) {
    case 'ok':
        console.log(res.source, res.content);
        break; // byte-exact raw content
    case 'absent':
        break; // no IDL published
    case 'corrupt':
        console.log(res.source, res.reason);
        break; // present but undecodable bytes
}
// …or collapse it to the parsed Idl (+ source/address), or null:
const withMeta = unwrapIdl(await fetchIdlWrapped(rpc, programId)); // Idl | null
if (withMeta) console.log(withMeta.source, withMeta.idl);

// Rich: PMP + Anchor side-by-side with parsed version + raw content.
// Same as GET /api/latest.
const latest = await fetchLatestIdls(rpc, programId);
console.log(latest.pmp[0]?.version, latest.anchor[0]?.version);

// Full history of every revision, both PMP and Anchor side-by-side.
// Same as GET/POST /api/history.
const history = await fetchAllHistories(rpc, programId);
console.log(history.pmp.length, 'PMP snapshots');
console.log(history.anchor.length, 'Anchor snapshots');

// Decode an IDL staged in a buffer account that hasn't been committed yet
// (e.g. uploaded via `anchor idl write-buffer` waiting on a multisig).
// Auto-detects Anchor vs PMP from the account owner; returns an IdlResult.
const buffer = await fetchIdlFromBuffer(rpc, address('Buf...'));
if (buffer.status === 'ok') console.log(buffer.source, buffer.content);
```

Every fetch **throws if and only if the RPC call fails** — every data outcome (`absent`, `corrupt`, `ok`) is a value. The per-source fetchers (`fetchAnchorIdl`, `fetchPmpIdl`) and `fetchIdlWrapped` return a discriminated `*Result`; `unwrapIdl` / `unwrapIdlOrThrow` collapse it to `Idl | null`, and `fetchIdl` is the shortcut straight to the parsed object.

For a single source only, use `reconstructPmpHistory(rpc, programId, opts?)` or `reconstructAnchorHistory(rpc, programId)` directly. For type-specific buffer decoding use `fetchAnchorIdlFromBuffer` or `fetchPmpIdlFromBuffer`.

### Result-handling patterns

The rule is one line: **a fetch throws if and only if the RPC call fails; every data outcome is a value.** So `try/catch` is only ever for RPC failure — everything inside it is `absent`, `corrupt`, or `ok`. Reusing `rpc` / `programId` from above:

```ts
import {
    fetchAnchorIdl,
    fetchPmpIdl,
    fetchIdlWrapped,
    unwrapIdl,
    unwrapIdlOrThrow,
    parseIdl,
    classifyRpcError,
} from '@solana/idl';

// Full outcome → HTTP: distinguish "no IDL" (404) from "undecodable bytes" (422).
// (This is exactly what GET /api/idl does, in a route handler.)
const res = await fetchIdlWrapped(rpc, programId);
switch (res.status) {
    case 'ok':
        return Response.json(res); // raw content + source
    case 'absent':
        return Response.json({ error: 'No IDL published' }, { status: 404 });
    case 'corrupt':
        return Response.json({ error: 'IDL undecodable', source: res.source, reason: res.reason }, { status: 422 });
}

// Per-source diagnostic — tell absent from corrupt. `ok` carries the raw,
// byte-exact `content` (parse it yourself, or unwrapIdl it — see below).
const r = await fetchAnchorIdl(rpc, programId);
switch (r.status) {
    case 'ok':
        console.log(r.content); // byte-exact, e.g. for hashing
        break;
    case 'corrupt':
        console.error(`${r.reason} at ${r.address}`, r.cause);
        break;
    case 'absent':
        break;
}

// Collapse a result without a switch — lenient (null on anything unusable) or
// strict (throws on present-but-unusable; only `absent` stays null).
const lenient = unwrapIdl(await fetchAnchorIdl(rpc, programId)); // Idl | null
const strict = unwrapIdlOrThrow(await fetchAnchorIdl(rpc, programId)); // throws IdlDecodeError / IdlValidationError

// RPC failure is the ONLY throw — one try/catch, classify in the catch.
try {
    const pmp = await fetchPmpIdl(rpc, programId);
    // pmp.status here is always a data outcome (ok / absent / corrupt), never an RPC error.
    void pmp;
} catch (e) {
    if (classifyRpcError(e) === 'transient') {
        /* retry, or surface as a 5xx */
    } else throw e;
}

// Why was it null? Get the validation reason as a value (no throw).
const wrapped = await fetchIdlWrapped(rpc, programId);
if (wrapped.status === 'ok') {
    const parsed = parseIdl(wrapped.content);
    if (parsed.ok) console.log(parsed.idl);
    else console.error(`IDL at ${wrapped.address} not usable:`, parsed.reason); // 'json' | 'shape'
}
```

`corrupt` is byte-level (`reason: 'framing' | 'payload'` — the container won't parse vs. its payload won't decode; the underlying error is on `cause`); content that decoded but isn't a JSON object is an `ok` result whose `parseIdl` / `unwrapIdlOrThrow` reports a **validation** failure (`reason: 'json' | 'shape'`) — never a `corrupt`. `unwrapIdlOrThrow` throws `IdlDecodeError` on the former and `IdlValidationError` on the latter; only `absent` returns `null`.

Every result — **including `absent`** — carries the `address` it queried (the derived PDA, or the buffer address you passed), so you can log or retry without re-deriving it. `absent` has no `source`, though: when an auto-detect buffer or the PMP→Anchor orchestrator finds nothing, there's no honest single source to report.

### Exports

| Export                                           | Purpose                                                                                                                                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchIdl`                                       | Headline shortcut: the **parsed IDL object** (`T \| null`), PMP-first with fndn fallback then Anchor. `null` folds absent / corrupt / invalid                                                                                    |
| `fetchIdlWrapped`                                | Same resolution, full outcome: `FetchIdlResult` (`ok` with byte-exact `content` + `source` / `absent` / `corrupt`)                                                                                                               |
| `fetchAnchorIdl`                                 | Live Anchor IDL only as `IdlResult<'anchor'>` (`ok` / `corrupt` / `absent`); never throws on data, only on RPC failure                                                                                                           |
| `fetchPmpIdl`                                    | Live PMP IDL only as `PmpIdlResult` (adds the matched `authority`); canonical then fndn                                                                                                                                          |
| `fetchIdlFromBuffer`                             | Decode a staging buffer account directly → `IdlResult`, auto-detecting Anchor vs PMP                                                                                                                                             |
| `fetchAnchorIdlFromBuffer`                       | Decode an Anchor `IdlAccount` (canonical PDA or buffer) by address → `IdlResult<'anchor'>`                                                                                                                                       |
| `fetchPmpIdlFromBuffer`                          | Decode a PMP `Buffer` account by address → `IdlResult<'pmp'>` (zlib+utf8 by default; `opts.format` to force one)                                                                                                                 |
| `unwrapIdl`, `unwrapIdlOrThrow`                  | Collapse any `*Result` to `Idl \| null` — lenient (invalid/corrupt/absent → `null`) or throwing (`IdlDecodeError` / `IdlValidationError`; only `absent` → `null`)                                                                |
| `parseIdl`                                       | Value-returning parse + validate of an `ok` result's `content` → `{ ok, idl }` or `{ ok: false, reason }` (`'json'` / `'shape'`)                                                                                                 |
| `fetchLatestIdls`                                | PMP + Anchor side-by-side with parsed version + raw content (powers `--latest`)                                                                                                                                                  |
| `fetchAllHistories`                              | Full PMP + Anchor history side-by-side (powers `--history` / `/api/history`)                                                                                                                                                     |
| `reconstructPmpHistory`                          | Replay PMP transactions into a history of `VirtualState` snapshots                                                                                                                                                               |
| `reconstructAnchorHistory`                       | Replay Anchor IDL transactions into a history of snapshots                                                                                                                                                                       |
| `findAnchorIdlAddress`, `findPmpMetadataAddress` | PDA derivation helpers                                                                                                                                                                                                           |
| `buildPmpIdlLookups`                             | Enumerate PMP PDAs to try (canonical + every fndn fallback)                                                                                                                                                                      |
| `IDL_FALLBACK_PMP_AUTHORITIES`                   | Array of non-canonical PMP authorities baked into `fetchIdl` / `fetchPmpIdl`                                                                                                                                                     |
| `classifyRpcError`, `isTransientRpcError`        | Classify an RPC failure as `transient` (retry / 5xx) vs `misconfig`; `null` if not a `SolanaError`                                                                                                                               |
| `IdlDecodeError`                                 | A present account whose **bytes** can't be decoded (`reason: 'framing' \| 'payload'` — container won't parse vs. payload won't decode, with the underlying error on `cause`). Thrown by `unwrapIdlOrThrow` on a `corrupt` result |
| `IdlValidationError`                             | Decoded **content** that isn't a usable IDL — not JSON, or not a JSON object (`reason: 'json' \| 'shape'`, with the raw `content`). Thrown by `unwrapIdlOrThrow`                                                                 |

Types: `Idl<T>`, `IdlSource`, `IdlResult<S>`, `PmpIdlResult`, `FetchIdlResult`, `PmpIdlLookup`, `PmpDecodeFormat`, `LatestIdls`, `LatestIdlVersion`, `AllHistories`, `VirtualState`, `Snapshot`, `SolanaRpcClient`, `RpcErrorClass`, `IdlDecodeReason`, `IdlValidationReason`.

## Browser usage

`@solana/idl` is isomorphic — it runs in the browser, Node ≥ 18, and Bun with no
polyfills. Production bundlers (`vite build`, `webpack --mode production`,
`bun build --production`) just work. esbuild is the only one that needs a define:

```jsonc
// esbuild
{ "define": { "process.env.NODE_ENV": "\"production\"" } }
```

## CLI

The `idl` binary mirrors the library and has four modes, each backed by the same core function the API uses:

| Mode                     | Flag        | Output                                                                                      | Backing function                                     | API parity          |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------- |
| **Bare IDL** _(default)_ | _(none)_    | Just the IDL body on stdout — pretty JSON if parsable, otherwise the raw string             | `fetchIdlWrapped`                                    | `GET /api/idl`      |
| **Latest side-by-side**  | `--latest`  | `{programId, pmpAddress, anchorAddress, pmp[], anchor[]}` with parsed version + raw content | `fetchLatestIdls`                                    | `GET /api/latest`   |
| **Full history**         | `--history` | Pretty timeline of every revision (plus optional `--output` / `--dump-idls`)                | `reconstructPmpHistory` / `reconstructAnchorHistory` | `POST /api/history` |
| **Buffer**               | `--buffer`  | The IDL body from a buffer account, auto-detecting Anchor vs PMP                            | `fetchIdlFromBuffer`                                 | _(library only)_    |

Live IDL resolution (default and `--latest`) always follows the same order: **canonical PMP → fndn fallback PMP → Anchor**. History replay (`--history`) auto-detects unless you pin `--type`. `--buffer` takes the address of a staging account (e.g. the one printed by `anchor idl write-buffer` or `program-metadata create-buffer`) and decodes its bytes directly — one RPC call, no history walk.

> **Parsed vs. raw IDL.** Bare mode emits the IDL **parsed** as pretty JSON — best when you want to _use_ the IDL (codegen, jq, inspection). `--latest` and `--history` emit the IDL **as a raw string** inside their wrapper — best when you want to _record_ or _compare_ it (hashing, diffing, byte-stable storage). `JSON.parse` ↔ `JSON.stringify` is not guaranteed to be a byte-for-byte round trip, so the indexer-flavored modes preserve the on-chain bytes verbatim.

```bash
npx @solana/idl <address> [options]
```

The positional argument is a program address in default / `--latest` / `--history` modes, and a buffer account address in `--buffer` mode.

### Options

| Flag                        | Description                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `-r, --rpc <url>`           | Solana RPC URL (or set `RPC_URL` env var; defaults to public mainnet with a stderr warning if unset)      |
| `-s, --seed <seed>`         | Metadata seed, PMP only (default `idl`)                                                                   |
| `-a, --authority <address>` | Authority address for non-canonical PMP metadata                                                          |
| `--latest`                  | Print the `{programId, pmpAddress, anchorAddress, pmp[], anchor[]}` payload (same shape as `/api/latest`) |
| `--history`                 | Replay the full IDL version history from on-chain transactions                                            |
| `--buffer`                  | Decode the IDL bytes from a buffer account (auto-detects Anchor vs PMP from the account owner)            |
| `-t, --type <type>`         | **`--history` only.** IDL type: `pmp`, `anchor`, or `both` (auto-detected if omitted)                     |
| `-o, --output <dir>`        | **`--history` only.** Save full state snapshots to directory                                              |
| `--dump-idls <dir>`         | **`--history` only.** Write each distinct IDL version as JSON + an `index.json` timeline                  |

`--latest`, `--history`, and `--buffer` are mutually exclusive. The `--type` / `--output` / `--dump-idls` flags are rejected outside `--history`.

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

Decode a staging buffer (e.g. inspect an IDL upload before the multisig executes `set-buffer`):

```bash
npx @solana/idl <buffer-address> --buffer \
  --rpc https://api.mainnet-beta.solana.com > staged-idl.json
```

## Web app

A Next.js UI and HTTP API live under `web/`. The UI exposes the same three capabilities as the API: **current IDL** (`GET /api/idl`), **latest PMP + Anchor** (`GET /api/latest`), and **full history** (`POST /api/history`). A cluster switcher (mainnet/devnet) sits in the header and is threaded through every API request. Testnet is intentionally not supported since the Program Metadata program isn't deployed there.

```bash
cd web
cp .env.example .env.local   # set RPC_MAINNET / RPC_DEVNET
pnpm install
pnpm run dev                  # http://localhost:3000
```

Deploy to Vercel by setting the project **root directory** to `web` and adding `RPC_MAINNET` and/or `RPC_DEVNET` in the environment. A legacy `RPC_URL` is still honored as a fallback for `mainnet-beta` only.

### API endpoints

All routes accept a **`cluster`** parameter (`mainnet-beta` (default) or `devnet`). `GET` routes take it as a query parameter; `POST /api/history` accepts it in the JSON body. A request to a cluster whose env var is unset returns `500` naming the missing variable.

`/api/idl` and `/api/latest` are quick reads. `/api/history` is the heavy one — it reconstructs every revision from on-chain transactions and is configured with a `300s` function timeout (capped by your Vercel plan: 60s on Hobby, 300s on Pro). For very long deploy histories, the CLI against a private RPC is the more reliable path.

**`GET /api/idl?programId=<address>&cluster=<cluster>`** — Returns the **current** IDL (canonical PMP, then non-canonical PMP via the fallback authority, then Anchor):

```json
{
    "programId": "BUYux…",
    "type": "pmp",
    "idl": {}
}
```

`type` is `"pmp"` or `"anchor"`. `idl` is JSON-parsed when possible, otherwise returned as a string. Returns `400` for a missing or invalid `programId` / `cluster`, `404` when neither source has an IDL, `422` when an IDL account is present but its bytes can't be decoded (`{ error, source, reason }`), `500` when the cluster's RPC env var is unset.

**`GET /api/latest?programId=<address>&cluster=<cluster>`** — Returns **both** current sources side by side (when present): derived `pmpAddress`, `anchorAddress`, and two arrays `pmp` and `anchor`, each with at most one entry including decoded version metadata and the full `content` string for the live IDL.

> `content` is kept as the **raw on-chain string** (not parsed) on this endpoint and on `/api/history` — same reasoning as the CLI's `--latest` / `--history` modes (byte-stable hashing and diffing for indexers). `GET /api/idl` is the parsed/usable view.

**`GET /api/history?programId=<address>&cluster=<cluster>`** _and_ **`POST /api/history`** — Reconstructs **distinct** IDL versions over time. Both methods accept the same inputs and return the same shape; pick whichever fits your client. `POST` takes a JSON body `{ "programId": "<address>", "cluster": "<cluster>" }`. Responses are sent with `Cache-Control: no-store`.

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

Buffer-account fixtures (for `fetchIdlFromBuffer`) are seeded by a one-shot script that publishes the IDL into a real PMP buffer on devnet via the upstream `program-metadata create-buffer` CLI and snapshots the on-chain bytes. Requires a Solana CLI config pointed at devnet with a funded keypair:

```bash
pnpm run seed:pmp-buffer idl.json
```

## License

MIT — see [LICENSE](./LICENSE).

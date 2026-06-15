# @solana/security-txt

[![npm](https://img.shields.io/npm/v/@solana/security-txt.svg)](https://www.npmjs.com/package/@solana/security-txt)

Fetch a Solana program's [security.txt](https://github.com/neodyme-labs/solana-security-txt) from on-chain. Mirrors `@solana/idl`'s shape and resolution philosophy:

| Source           | How                                                                                                                                                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PMP (new)**    | A [Program Metadata](https://github.com/solana-program/program-metadata) account with seed `security` (per the SPL PMP convention — not `security.txt`), looked up canonical-first then via fallback authorities.                                                                                   |
| **ELF (legacy)** | A `.security.txt` ELF section embedded in the program's BPF binary at build time, per [neodyme-labs/solana-security-txt](https://github.com/neodyme-labs/solana-security-txt). Read straight off chain (no local binary required) — traverses the Upgradeable Loader's `ProgramData` automatically. |

`fetchSecurityTxt` tries PMP first and falls back to ELF, returning `{ programId, type: 'pmp' | 'elf', content, fields }`.

## Install

```bash
pnpm add @solana/security-txt @solana/kit
```

## Usage

```ts
import { address, createSolanaRpc } from '@solana/kit';
import { fetchSecurityTxt } from '@solana/security-txt';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const result = await fetchSecurityTxt(rpc, address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'));

if (result) {
    console.log(`source: ${result.type}`); // 'pmp' or 'elf'
    console.log(`contacts: ${result.fields.contacts ?? '(none)'}`);
    console.log(`policy:   ${result.fields.policy ?? '(none)'}`);
}
```

For source-specific calls (skip the fallback chain):

```ts
import { fetchElfSecurityTxt, fetchPmpSecurityTxt } from '@solana/security-txt';

const elf = await fetchElfSecurityTxt(rpc, programId);
const pmp = await fetchPmpSecurityTxt(rpc, programId);
```

## CLI

Installing the package also drops a `security-txt` binary that wraps the same fetchers:

```bash
# Resolved security.txt (PMP first, then ELF) as colored text
security-txt Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH \
  --rpc https://api.mainnet-beta.solana.com

# Same thing as structured JSON, for piping into jq or other tooling
security-txt <program-id> --format json

# Force a specific source (skips the fallback chain)
security-txt <program-id> --source pmp
security-txt <program-id> --source elf

# Show both sources side-by-side (useful for sanity checks)
security-txt <program-id> --source both

# Pipe the raw on-chain payload somewhere
security-txt <program-id> --source pmp --raw > security.json

# Non-canonical PMP authority (third-party uploaders)
security-txt <program-id> --authority <auth-pubkey>
```

`--rpc` accepts any RPC URL, or set `RPC_URL` in the environment. If neither is provided the CLI falls back to the public mainnet endpoint (with a stderr warning — it'll rate-limit on large ELF programs, so set a private RPC for serious use). Exit code is `0` on a hit, `1` when nothing was found (or on argument errors).

Run `security-txt --help` for the full option list.

## Exports

| Export                                  | Purpose                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `fetchSecurityTxt`                      | Headline. PMP-first → ELF fallback. Returns `{ programId, type, content, fields } \| null`.          |
| `fetchPmpSecurityTxt`                   | Live PMP security.txt only: `{ address, authority, content, fields } \| null`.                       |
| `fetchElfSecurityTxt`                   | Live ELF-embedded security.txt only: `{ address, content, fields } \| null`.                         |
| `findPmpSecurityTxtAddress`             | PDA derivation helper (pins seed to `'security'`).                                                   |
| `SECURITY_TXT_PMP_SEED`                 | The seed constant (`'security'`).                                                                    |
| `SECURITY_TXT_FALLBACK_PMP_AUTHORITIES` | Array of non-canonical PMP authorities tried after canonical (empty today; kept for forward compat). |

Types: `SecurityTxt`, `SecurityTxtSource`, `SecurityTxtFields`, `PmpSecurityTxt`, `ElfSecurityTxt`, `SolanaRpcClient`.

## What "fields" contains

The union of keys recognised by every on-chain security.txt convention this package supports — 17 in total:

- **Neodyme `.security.txt` spec** (12 keys; what the `security_txt!` Rust macro emits into the ELF section):
    - Required: `name`, `project_url`, `contacts`, `policy`
    - Optional: `preferred_languages`, `encryption`, `source_code`, `source_release`, `source_revision`, `auditors`, `acknowledgements`, `expiry`

- **SPL Program Metadata extensions** (5 extra keys; commonly carried by PMP `metadata.json` uploads — see the [solana-developers/idl-program](https://github.com/solana-developers/idl-program#metadata) docs):
    - `logo`, `description`, `notification`, `sdk`, `version`

ELF-sourced security.txts won't populate the PMP-extended keys (the macro doesn't emit them); PMP-sourced ones may populate all 17. Every field is optional.

Unknown keys (outside this set) are dropped from `fields` to keep the typed surface stable. The raw bytes are always preserved on `content` (UTF-8 decoded — with `\0` separators for the ELF/NUL format) so callers that need byte-stable storage or non-standard keys can parse it themselves.

## ELF loader support

| Loader                                        | Supported | Notes                                                                                                                                      |
| --------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `BPFLoaderUpgradeab1e11111111111111111111111` | ✅        | Traverses `Program → ProgramData → ELF`.                                                                                                   |
| `BPFLoader2111111111111111111111111111111111` | ✅        | Account data is the ELF directly.                                                                                                          |
| `CoreBPFLoaderV41111111111111111111111111111` | ❌ (yet)  | Single-account layout with a 48-byte header (no separate ProgramData). Will be added as v4 deployments roll out — see `src/elf-loader.ts`. |

If the program isn't owned by a recognized loader, `fetchElfSecurityTxt` returns `null`.

## License

MIT — see [LICENSE](./LICENSE).

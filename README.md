# solana-foundation/idl

Monorepo for fetching on-chain Solana metadata. Two libraries sharing one home, plus the hosted explorer.

| Package                                            | npm                                                        | Purpose                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`packages/idl`](./packages/idl)                   | [`@solana/idl`](https://www.npmjs.com/package/@solana/idl) | Fetch and reconstruct program IDLs from on-chain Anchor and Program Metadata (PMP) accounts |
| [`packages/security-txt`](./packages/security-txt) | `@solana/security-txt` _(scaffolded, not yet published)_   | Fetch a program's `security.txt` from PMP (new) or the legacy ELF-embedded section          |
| [`web`](./web)                                     | _internal_                                                 | Next.js UI + HTTP API hosted at https://idl-one.vercel.app                                  |

Both libraries follow the same shape: a `fetch<Thing>` headline that tries PMP first and falls back to the legacy source, plus per-source escape hatches (`fetchPmp<Thing>`, `fetchAnchor<Thing>` / `fetchElf<Thing>`) for callers that need fine control. See each package's README for details.

## Repo layout

```
.
├── packages/
│   ├── idl/           # @solana/idl (lib + CLI)
│   └── security-txt/  # @solana/security-txt (scaffolded)
├── web/               # Next.js explorer & JSON API
├── pnpm-workspace.yaml
├── tsconfig.base.json # shared TS compiler options
├── oxfmt.config.ts    # shared format config
└── oxlint.config.ts   # shared lint config
```

## Development

Requires Node ≥ 20 and pnpm 10.

```bash
pnpm install                 # install everything, including workspace links
pnpm run lint                # oxlint + oxfmt across the whole repo
pnpm run typecheck           # tsc --noEmit for every package
pnpm run test                # vitest run in every package
pnpm run build               # tsup + dts for every package
```

Run scripts in a single package with the standard pnpm filter:

```bash
pnpm --filter @solana/idl run dev
pnpm --filter @solana/idl run test:integration
pnpm --filter @solana/security-txt run typecheck
pnpm --filter idl-web run dev
```

## Publishing

`@solana/idl` is published via the `Publish @solana/idl` GitHub Actions workflow (manual dispatch, OIDC trusted publishing). The workflow builds and packs only the `packages/idl/` directory and tags the release as `v<version>` matching `packages/idl/package.json`.

`@solana/security-txt` is still `private: true` and is **not** published yet. It will get its own publish workflow once the implementations land.

## License

MIT — see [LICENSE](./LICENSE).

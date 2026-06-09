# solana-foundation/idl

Monorepo for fetching on-chain Solana metadata. Two libraries sharing one home, plus the hosted explorer.

| Package                                            | npm                                                        | Purpose                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`packages/idl`](./packages/idl)                   | [`@solana/idl`](https://www.npmjs.com/package/@solana/idl) | Fetch and reconstruct program IDLs from on-chain Anchor and Program Metadata (PMP) accounts |
| [`packages/security-txt`](./packages/security-txt) | `@solana/security-txt` _(scaffolded, not yet published)_   | Fetch a program's `security.txt` from PMP (new) or the legacy ELF-embedded section          |
| [`web`](./web)                                     | _standalone Next.js app_                                   | Next.js UI + HTTP API hosted at https://idl-one.vercel.app                                  |

Both libraries follow the same shape: a `fetch<Thing>` headline that tries PMP first and falls back to the legacy source, plus per-source escape hatches (`fetchPmp<Thing>`, `fetchAnchor<Thing>` / `fetchElf<Thing>`) for callers that need fine control. See each package's README for details.

## Repo layout

```
.
├── packages/                # pnpm workspace members
│   ├── idl/                 # @solana/idl (lib + CLI)
│   └── security-txt/        # @solana/security-txt (scaffolded)
├── web/                     # Next.js explorer & JSON API — its own project,
│                            # consumes the published @solana/idl from npm
├── pnpm-workspace.yaml      # only lists packages/* on purpose
├── tsconfig.base.json       # shared TS compiler options for packages/*
├── oxfmt.config.ts          # shared format config
└── oxlint.config.ts         # shared lint config
```

`web/` is intentionally **not** a workspace member: it depends on the published `@solana/idl@^0.1.2` from npm, has its own `pnpm-lock.yaml`, and ships from Vercel with `Root Directory = web/`. Library changes only land in the web app after a new `@solana/idl` release.

## Development

Requires Node ≥ 20 and pnpm 10.

### Library work (packages/)

```bash
pnpm install                 # install workspace deps (packages/* only)
pnpm run lint                # oxlint + oxfmt across the workspace
pnpm run typecheck           # tsc --noEmit for every workspace package
pnpm run test                # vitest run in every workspace package
pnpm run build               # tsup + dts for every workspace package
```

Run scripts in a single package with the standard pnpm filter:

```bash
pnpm --filter @solana/idl run dev
pnpm --filter @solana/idl run test:integration
pnpm --filter @solana/security-txt run typecheck
```

### Web work

The web app is decoupled: install and run it on its own.

```bash
cd web
pnpm install                 # uses web/pnpm-lock.yaml, fetches @solana/idl from npm
pnpm dev                     # http://localhost:3000
pnpm build && pnpm start
```

To exercise unreleased library changes locally, either publish a prerelease (`npm install @solana/idl@beta` inside `web/`) or temporarily point the web `@solana/idl` dependency at a tarball / git URL.

## Publishing

`@solana/idl` (and, once unblocked, `@solana/security-txt`) is published via the **Publish packages** GitHub Actions workflow (manual dispatch, OIDC trusted publishing). Choose `package = all | idl | security-txt` to publish either selectively or together; each package keeps its own version and gets its own `<pkg>-v<version>` tag plus a per-package GitHub release.

`@solana/security-txt` is still `private: true` and is gracefully skipped by the workflow until the implementation lands and `private` is flipped off.

## License

MIT — see [LICENSE](./LICENSE).

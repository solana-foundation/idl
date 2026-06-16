import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Docs · IDL Explorer',
  description:
    'API and CLI quickstart for @solana/idl — fetch on-chain Solana program IDLs (Program Metadata Program + Anchor).',
};

const BASE = 'https://idl-one.vercel.app';
const PROGRAM = 'BUYuxRfhCMWavaUWxhGtPP3ksKEDZxCD5gzknk3JfAya';

export default function DocsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight hover:text-zinc-300 transition-colors"
          >
            IDL Explorer
          </Link>
          <span className="text-xs text-zinc-500 border border-zinc-800 rounded px-1.5 py-0.5">
            Solana
          </span>
          <a
            href="https://github.com/solana-foundation/idl"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View source on GitHub"
            title="View source on GitHub"
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.1c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.35.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.93 10.93 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.63 1.59.24 2.76.12 3.05.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.05.78 2.12v3.14c0 .3.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
            </svg>
          </a>
          <nav className="ml-auto flex items-center gap-4">
            <Link
              href="/"
              className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Explorer
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-12 space-y-16">
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">Docs</h1>
            <nav className="flex gap-3 text-xs text-zinc-500">
              <a href="#publish" className="hover:text-zinc-300 transition-colors">
                Publish
              </a>
              <a href="#api" className="hover:text-zinc-300 transition-colors">
                API
              </a>
              <a href="#cli" className="hover:text-zinc-300 transition-colors">
                CLI
              </a>
              <a href="#library" className="hover:text-zinc-300 transition-colors">
                Library
              </a>
            </nav>
          </div>
          <p className="text-zinc-400 text-sm leading-relaxed max-w-2xl">
            Programmatic access to on-chain Solana program IDLs. Same engine that powers the
            explorer, available as an HTTP API, a CLI (<Inline>@solana/idl</Inline>), and a Node
            library. Resolves <Strong>canonical PMP</Strong> → <Strong>fndn fallback PMP</Strong> →{' '}
            <Strong>Anchor</Strong>.
          </p>
          <p className="text-zinc-500 text-xs">
            Full reference, exports, and architecture in the{' '}
            <ExtLink href="https://github.com/solana-foundation/idl#readme">
              GitHub README
            </ExtLink>
            .
          </p>
        </section>

        {/* Publish */}
        <section id="publish" className="space-y-8 scroll-mt-20">
          <header className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">Publish your own</h2>
            <p className="text-zinc-400 text-sm leading-relaxed max-w-2xl">
              This explorer <Strong>reads</Strong> on-chain metadata. To <Strong>write</Strong>{' '}
              it — both IDLs and <Inline>security.txt</Inline> — use the official{' '}
              <ExtLink href="https://github.com/solana-program/program-metadata">
                <Inline>@solana-program/program-metadata</Inline>
              </ExtLink>{' '}
              CLI. Same seed-based PMP account that this site fetches from: <Inline>idl</Inline>{' '}
              for IDLs, <Inline>security</Inline> for security.txt.
            </p>
          </header>

          <article className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-300">Upload an IDL</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Run as the program's upgrade authority to publish a <Strong>canonical</Strong>{' '}
              IDL (the one this explorer surfaces by default):
            </p>
            <Code>{`npx @solana-program/program-metadata@latest write idl <program-id> ./idl.json`}</Code>
          </article>

          <article className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-300">
              Upload a <Inline>security.txt</Inline>
            </h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Same command, swap the seed. Use the SPL JSON shape — the full 17 keys (Neodyme
              spec + PMP extensions like <Inline>logo</Inline> / <Inline>description</Inline> /{' '}
              <Inline>version</Inline>) are documented{' '}
              <ExtLink href="https://github.com/solana-program/program-metadata#securitytxt-file-format">
                upstream
              </ExtLink>
              .
            </p>
            <Code>{`npx @solana-program/program-metadata@latest write security <program-id> ./security.json`}</Code>
            <Code>{`{
  "name": "MyProgram",
  "project_url": "https://example.com",
  "contacts": ["email:security@example.com", "discord:MyProgram#1234"],
  "policy": "https://example.com/security-policy",
  "source_code": "https://github.com/example/program",
  "auditors": ["Audit Firm A", "Security Researcher B"],
  "description": "Short description of what the program does",
  "version": "0.1.0"
}`}</Code>
          </article>

          <article className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-300">
              Canonical vs. third-party uploads
            </h3>
            <ul className="text-sm text-zinc-400 space-y-1 pl-5 list-disc leading-relaxed">
              <li>
                <Strong>Canonical</Strong> — signed by the program's upgrade authority. Default
                when you run <Inline>write</Inline> with that keypair. One per (program, seed)
                pair. This is what the explorer shows first.
              </li>
              <li>
                <Strong>Third-party (non-canonical)</Strong> — anyone can publish with{' '}
                <Inline>--non-canonical &lt;your-pubkey&gt;</Inline>. Useful for frozen programs
                that no longer have an active upgrade authority, or for community-maintained
                IDLs. Looked up via the <Inline>?authority=&lt;pubkey&gt;</Inline> query param
                on this site's API.
              </li>
            </ul>
            <p className="text-zinc-500 text-xs">
              Multisig (Squads) and buffered uploads are also supported — see the{' '}
              <ExtLink href="https://github.com/solana-program/program-metadata#usage">
                upstream README
              </ExtLink>{' '}
              for the full command surface.
            </p>
          </article>

          <article className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-300">Anchor IDLs (legacy)</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Programs that publish via <Inline>anchor idl init</Inline> /{' '}
              <Inline>anchor idl upgrade</Inline> still work — this site falls back to the
              Anchor IDL account when no PMP IDL is found. New programs should prefer PMP since
              it's the path the Solana Explorer and Codama tooling are aligning on.
            </p>
          </article>
        </section>

        {/* HTTP API */}
        <section id="api" className="space-y-8 scroll-mt-20">
          <header className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">HTTP API</h2>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Base URL: <Inline>{BASE}</Inline>. All endpoints accept a <Inline>cluster</Inline>{' '}
              parameter: <Inline>mainnet-beta</Inline> (default) or <Inline>devnet</Inline>.
              Testnet is intentionally unsupported (PMP isn't deployed there).
            </p>
          </header>

          <article className="space-y-3">
            <h3 className="text-base font-semibold">
              <MethodTag method="GET" />
              <Inline className="text-sm py-0.5">/api/idl</Inline>
            </h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Current IDL for a program, resolved PMP-first with fndn fallback then Anchor.
              Returns <Inline>404</Inline> if no IDL exists.
            </p>
            <Code>{`curl "${BASE}/api/idl?programId=${PROGRAM}"`}</Code>
            <Code>{`{
  "type": "pmp",
  "content": "{\\"version\\":\\"0.1.0\\", ... }",
  "address": "EwUbzv8sP8h8Q4...",
  "authority": "fndnu15..."
}`}</Code>
          </article>

          <article className="space-y-3">
            <h3 className="text-base font-semibold">
              <MethodTag method="GET" />
              <Inline className="text-sm py-0.5">/api/latest</Inline>
            </h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              PMP and Anchor side-by-side with version, slot, and timestamp. Each source returns at
              most one entry (the live revision). Either array can be empty if that source has no
              IDL.
            </p>
            <Code>{`curl "${BASE}/api/latest?programId=${PROGRAM}&cluster=mainnet-beta"`}</Code>
          </article>

          <article className="space-y-3">
            <h3 className="text-base font-semibold flex flex-wrap items-center gap-x-1">
              <MethodTag method="GET" />
              <span className="text-zinc-500 text-xs mr-2 align-middle">/</span>
              <MethodTag method="POST" />
              <Inline className="text-sm py-0.5">/api/history</Inline>
            </h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Full version history reconstructed from every PMP and Anchor transaction touching the
              program's metadata. One entry per distinct revision with slot/time ranges. Both{' '}
              <Inline>GET</Inline> and <Inline>POST</Inline> are supported — same inputs, same
              response shape.
            </p>
            <div className="px-3 py-2 bg-amber-950/30 border border-amber-900/40 rounded-lg text-amber-300/90 text-xs flex items-start gap-2">
              <svg viewBox="0 0 20 20" className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M8.485 2.495c.66-1.146 2.367-1.146 3.029 0l6.28 10.875c.66 1.144-.165 2.58-1.515 2.58H3.72c-1.35 0-2.175-1.436-1.514-2.58L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 8a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
              <span>
                Heavy endpoint. Function timeout is set to <Inline>300s</Inline> (Vercel Pro max;
                Hobby caps to 60s). Programs with many upgrades may still hit the limit on hosted
                infra — the CLI against a private RPC is the reliable path. Response is sent with{' '}
                <Inline>Cache-Control: no-store</Inline>.
              </span>
            </div>
            <Code>{`# GET (preferred — shareable URL, auto-retried on transient errors)
curl "${BASE}/api/history?programId=${PROGRAM}&cluster=mainnet-beta"`}</Code>
            <Code>{`# POST (backward compatible)
curl -X POST "${BASE}/api/history" \\
  -H 'Content-Type: application/json' \\
  -d '{ "programId": "${PROGRAM}", "cluster": "mainnet-beta" }'`}</Code>
          </article>

          <article className="space-y-3">
            <h3 className="text-base font-semibold">
              <MethodTag method="GET" />
              <Inline className="text-sm py-0.5">/api/security-txt</Inline>
            </h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Program <Inline>security.txt</Inline> — contacts, policy, auditors, and so on
              — resolved <Strong>PMP-first</Strong> (seed <Inline>security</Inline>) with{' '}
              <Strong>ELF fallback</Strong> (
              <ExtLink href="https://github.com/neodyme-labs/solana-security-txt">
                neodyme macro
              </ExtLink>
              ). Returns the parsed{' '}
              <Inline>{`{ programId, type: 'pmp' | 'elf', content, fields }`}</Inline>{' '}
              shape that mirrors <Inline>/api/idl</Inline>. <Inline>404</Inline> if neither
              source has one. Powered by{' '}
              <ExtLink href="https://github.com/solana-foundation/idl/tree/main/packages/security-txt">
                <Inline>@solana/security-txt</Inline>
              </ExtLink>
              .
            </p>
            <Code>{`curl "${BASE}/api/security-txt?programId=Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH"`}</Code>
            <Code>{`{
  "programId": "Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH",
  "type": "pmp",
  "content": "{\\"name\\":\\"SPL Memo\\", ... }",
  "fields": {
    "name": "SPL Memo",
    "project_url": "https://github.com/solana-program/memo",
    "contacts": "link:...,email:security@anza.xyz",
    "policy": "https://github.com/solana-program/memo/blob/main/SECURITY.md",
    "description": "Solana Program Library Memo",
    "version": "4.0.0"
  }
}`}</Code>
            <p className="text-zinc-500 text-xs">
              Optional <Inline>?source=pmp</Inline> / <Inline>?source=elf</Inline> forces
              one source (returns that source's full shape, with <Inline>address</Inline>{' '}
              and — for PMP — <Inline>authority</Inline>).{' '}
              <Inline>?source=both</Inline> returns{' '}
              <Inline>{`{ pmp, elf }`}</Inline> with <Inline>null</Inline> for whichever
              missed. <Inline>?authority=&lt;pubkey&gt;</Inline> pins a non-canonical PMP
              authority.
            </p>
          </article>

          <article className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-300">Status codes</h3>
            <ul className="text-sm text-zinc-400 space-y-1 pl-5 list-disc">
              <li>
                <Inline>200</Inline> — success
              </li>
              <li>
                <Inline>400</Inline> — invalid <Inline>programId</Inline> or{' '}
                <Inline>cluster</Inline>
              </li>
              <li>
                <Inline>404</Inline> — (<Inline>/api/idl</Inline> only) program has no IDL on
                either source
              </li>
              <li>
                <Inline>500</Inline> — server-side RPC failure or missing{' '}
                <Inline>RPC_MAINNET</Inline> / <Inline>RPC_DEVNET</Inline> env on the deployment
              </li>
            </ul>
          </article>
        </section>

        {/* CLI */}
        <section id="cli" className="space-y-8 scroll-mt-20">
          <header className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">CLI</h2>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Run anywhere with <Inline>npx</Inline>, or install globally. Same three modes as the
              API.
            </p>
          </header>

          <article className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-300">Install (optional)</h3>
            <Code>{`# one-off
npx @solana/idl <program-id> --rpc <url>

# or install globally
npm install -g @solana/idl
idl <program-id> --rpc <url>`}</Code>
          </article>

          <article className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-300">Bare IDL (default)</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Prints just the IDL body — pretty JSON if parsable, otherwise the raw string. Pipe
              to a file.
            </p>
            <Code>{`npx @solana/idl ${PROGRAM} \\
  --rpc https://api.mainnet-beta.solana.com > idl.json`}</Code>
          </article>

          <article className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-300">Side-by-side latest</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Same payload as <Inline>GET /api/latest</Inline>.
            </p>
            <Code>{`npx @solana/idl ${PROGRAM} \\
  --rpc https://api.mainnet-beta.solana.com --latest`}</Code>
          </article>

          <article className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-300">Full history</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Replay every revision from on-chain transactions. Auto-detects whether the program
              has PMP, Anchor, or both.
            </p>
            <Code>{`npx @solana/idl ${PROGRAM} \\
  --rpc https://api.mainnet-beta.solana.com --history`}</Code>
            <p className="text-zinc-500 text-xs">
              Add <Inline>--dump-idls ./idls</Inline> to write each distinct version as a JSON
              file. Full options:{' '}
              <ExtLink href="https://github.com/solana-foundation/idl#options">
                README → CLI options
              </ExtLink>
              .
            </p>
          </article>
        </section>

        {/* Library */}
        <section id="library" className="space-y-4 scroll-mt-20">
          <header className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">Library</h2>
            <p className="text-zinc-400 text-sm leading-relaxed">
              For Node services and tools, import the underlying functions directly. Dual ESM +
              CJS build, with <Inline>@solana/kit</Inline> as a peer dep.
            </p>
          </header>
          <Code>{`pnpm add @solana/idl @solana/kit`}</Code>
          <Code>{`import { createSolanaRpc, address } from '@solana/kit';
import { fetchIdl, fetchLatestIdls, fetchAllHistories } from '@solana/idl';

const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
const programId = address('${PROGRAM}');

const current = await fetchIdl(rpc, programId);
const latest  = await fetchLatestIdls(rpc, programId);
const history = await fetchAllHistories(rpc, programId);`}</Code>
          <p className="text-zinc-500 text-xs">
            Full exports + types:{' '}
            <ExtLink href="https://github.com/solana-foundation/idl#exports">
              README → Exports
            </ExtLink>
            .
          </p>
        </section>
      </main>

      <footer className="border-t border-zinc-800 py-5 text-center text-zinc-600 text-xs">
        <div className="text-zinc-500">
          <ExtLink href="https://github.com/solana-foundation/idl-spec">IDL spec</ExtLink>
          <span className="mx-2 text-zinc-700">·</span>
          <ExtLink href="https://github.com/solana-foundation/idl">solana-foundation/idl</ExtLink>
          <span className="mx-2 text-zinc-700">·</span>
          <ExtLink href="https://github.com/codama-idl/codama">Codama</ExtLink>
          <span className="text-zinc-600"> (client generation)</span>
        </div>
      </footer>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-xs font-mono overflow-x-auto text-zinc-300 leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

function Inline({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <code
      className={`font-mono text-xs bg-zinc-900 px-1.5 py-0.5 rounded text-zinc-300 ${className}`}
    >
      {children}
    </code>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="text-zinc-300 font-medium">{children}</strong>;
}

function MethodTag({ method }: { method: 'GET' | 'POST' }) {
  const color = method === 'GET' ? 'text-emerald-400' : 'text-amber-400';
  return <span className={`${color} font-mono text-xs mr-2 align-middle`}>{method}</span>;
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-zinc-400 hover:text-zinc-200 underline underline-offset-2 transition-colors"
    >
      {children}
    </a>
  );
}

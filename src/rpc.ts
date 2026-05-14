import {
    Address,
    getBase58Decoder,
    getBase58Encoder,
    Rpc,
    SolanaRpcApi,
} from '@solana/kit';

// ─── Shared types ────────────────────────────────────────────────────────────

export type Snapshot = {
    slot: bigint;
    blockTime: bigint | null;
    signature: string;
    instruction: string;
    /** Source-specific state (PMP VirtualState or null for Anchor). */
    state: unknown;
    decodedContent: string | null;
};

export type SigInfo = {
    signature: string;
    slot: bigint;
    blockTime: bigint | null;
    err: unknown;
};

export type CompiledInstruction = {
    programIdIndex: number;
    accounts: number[];
    data: string;
};

export type InnerInstructionGroup = {
    index: number;
    instructions: CompiledInstruction[];
};

export type ParsedTx = {
    slot: bigint;
    blockTime: bigint | null;
    transaction: {
        message: {
            accountKeys: string[];
            instructions: CompiledInstruction[];
        };
    };
    meta: {
        err: unknown;
        innerInstructions?: InnerInstructionGroup[] | null;
        loadedAddresses?: {
            writable?: string[];
            readonly?: string[];
        } | null;
    } | null;
};

// ─── Low-level helpers ───────────────────────────────────────────────────────

export function fromBase58(b58: string): Uint8Array<ArrayBuffer> {
    try {
        return new Uint8Array(getBase58Encoder().encode(b58));
    } catch {
        return new Uint8Array(0);
    }
}

export function readU32LE(bytes: Uint8Array, offset: number): number {
    return (
        (bytes[offset] |
            (bytes[offset + 1] << 8) |
            (bytes[offset + 2] << 16) |
            ((bytes[offset + 3] << 24) >>> 0)) >>>
        0
    );
}

export function rawBytesToAddress(bytes: Uint8Array<ArrayBuffer>, offset: number): Address {
    const slice = bytes.slice(offset, offset + 32);
    return getBase58Decoder().decode(slice) as Address;
}

export function writeChunk(
    buf: Uint8Array<ArrayBuffer>,
    chunk: Uint8Array<ArrayBuffer>,
    dstOffset: number,
): Uint8Array<ArrayBuffer> {
    const needed = dstOffset + chunk.length;
    if (needed > buf.length) {
        const grown = new Uint8Array(needed);
        grown.set(buf);
        buf = grown;
    }
    buf.set(chunk, dstOffset);
    return buf;
}

/**
 * Merge static account keys with ALT-resolved addresses so that inner
 * instruction account indices resolve correctly for v0 transactions.
 */
export function resolveAccountKeys(tx: ParsedTx): string[] {
    const keys = [...tx.transaction.message.accountKeys];
    const loaded = tx.meta?.loadedAddresses;
    if (loaded) {
        keys.push(...(loaded.writable ?? []));
        keys.push(...(loaded.readonly ?? []));
    }
    return keys;
}

export function flattenInstructions(tx: ParsedTx): CompiledInstruction[] {
    const result: CompiledInstruction[] = [];
    const innerByOuterIdx = new Map<number, CompiledInstruction[]>();

    for (const group of tx.meta?.innerInstructions ?? []) {
        innerByOuterIdx.set(group.index, group.instructions);
    }

    tx.transaction.message.instructions.forEach((outerIx, idx) => {
        result.push(outerIx);
        const inner = innerByOuterIdx.get(idx);
        if (inner) result.push(...inner);
    });

    return result;
}

// ─── RPC helpers with retry ──────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err: unknown) {
            lastErr = err;
            const is429 =
                err instanceof Error &&
                (err.message.includes('429') || err.message.includes('Too Many Requests'));
            if (!is429 || attempt === maxRetries) throw err;
            const backoff = Math.min(1000 * 2 ** attempt, 15_000);
            await sleep(backoff);
        }
    }
    throw lastErr;
}

export async function fetchAllSignatures(rpc: Rpc<SolanaRpcApi>, addr: Address): Promise<SigInfo[]> {
    const all: SigInfo[] = [];
    let before: string | undefined;

    for (;;) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const batch = await withRetry(async () =>
            (await (rpc as any)
                .getSignaturesForAddress(addr, {
                    limit: 1000,
                    ...(before ? { before } : {}),
                })
                .send()) as SigInfo[],
        );

        if (!batch || batch.length === 0) break;
        all.push(...batch);
        before = batch[batch.length - 1].signature;
        if (batch.length < 1000) break;
    }

    return all.reverse();
}

export async function fetchTx(rpc: Rpc<SolanaRpcApi>, sig: string): Promise<ParsedTx | null> {
    return withRetry(async () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rpc as any)
            .getTransaction(sig, {
                maxSupportedTransactionVersion: 0,
                encoding: 'json',
            })
            .send() as Promise<ParsedTx | null>,
    );
}

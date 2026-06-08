import {
    findMetadataPda,
    PROGRAM_METADATA_PROGRAM_ADDRESS,
    type Compression,
    type Encoding,
    type Seed,
    unpackDirectData as pmpUnpackDirectData,
} from '@solana-program/program-metadata';
import { Address } from '@solana/kit';

import {
    fromBase58,
    readU32LE,
    rawBytesToAddress,
    writeChunk,
    resolveAccountKeys,
    flattenInstructions,
    fetchAllSignatures,
    fetchTx,
    type Snapshot,
    type SolanaRpcClient,
    type ParsedTx,
    type CompiledInstruction,
} from './rpc.js';

// ─── Re-exports from PMP package ─────────────────────────────────────────────

export { PROGRAM_METADATA_PROGRAM_ADDRESS };
export type { Compression, Encoding, Seed };

export const FORMAT_NAME = ['none', 'json', 'yaml', 'toml'];
export const ENCODING_NAME = ['none', 'utf8', 'base58', 'base64'];
export const COMPRESSION_NAME = ['none', 'gzip', 'zlib'];
export const DISC_LABEL = ['Empty', 'Buffer', 'Metadata'];

const DISC = {
    Allocate: 7,
    Close: 6,
    Extend: 8,
    Initialize: 1,
    SetAuthority: 2,
    SetData: 3,
    SetImmutable: 4,
    Trim: 5,
    Write: 0,
} as const;

const DISC_NAME: Record<number, string> = {
    0: 'Write',
    1: 'Initialize',
    2: 'SetAuthority',
    3: 'SetData',
    4: 'SetImmutable',
    5: 'Trim',
    6: 'Close',
    7: 'Allocate',
    8: 'Extend',
};

// ─── Types ───────────────────────────────────────────────────────────────────

export type VirtualState = {
    /** 0 = Empty, 1 = Buffer, 2 = Metadata */
    discriminator: 0 | 1 | 2;
    authority: Address | null;
    mutable: boolean;
    canonical: boolean;
    seed: Uint8Array<ArrayBuffer>;
    encoding: number;
    compression: number;
    format: number;
    /** 0 = Direct, 1 = Url, 2 = External */
    dataSource: number;
    dataLength: number;
    data: Uint8Array<ArrayBuffer>;
};

// ─── PDA derivation ──────────────────────────────────────────────────────────

export async function findPmpMetadataAddress(
    programAddress: Address,
    seed: Seed,
    authority?: Address | null,
): Promise<Address> {
    const [pda] = await findMetadataPda({
        authority: authority ?? null,
        program: programAddress,
        seed,
    });
    return pda;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function cloneState(s: VirtualState): VirtualState {
    return {
        ...s,
        data: new Uint8Array(s.data) as Uint8Array<ArrayBuffer>,
        seed: new Uint8Array(s.seed) as Uint8Array<ArrayBuffer>,
    };
}

function emptyState(): VirtualState {
    return {
        authority: null,
        canonical: false,
        compression: 0,
        data: new Uint8Array(0),
        dataLength: 0,
        dataSource: 0,
        discriminator: 0,
        encoding: 0,
        format: 0,
        mutable: true,
        seed: new Uint8Array(16),
    };
}

// ─── Buffer reconstruction ───────────────────────────────────────────────────

async function reconstructBufferData(rpc: SolanaRpcClient, bufferAddr: Address): Promise<Uint8Array<ArrayBuffer>> {
    let data: Uint8Array<ArrayBuffer> = new Uint8Array(0);

    const sigs = await fetchAllSignatures(rpc, bufferAddr);

    for (const sigInfo of sigs) {
        if (sigInfo.err) continue;

        const tx = await fetchTx(rpc, sigInfo.signature);
        if (!tx?.transaction?.message) continue;

        const keys = resolveAccountKeys(tx);
        const targetIdx = keys.indexOf(bufferAddr as string);
        if (targetIdx === -1) continue;

        for (const ix of flattenInstructions(tx)) {
            if (keys[ix.programIdIndex] !== (PROGRAM_METADATA_PROGRAM_ADDRESS as string)) continue;
            if (ix.accounts[0] !== targetIdx) continue;

            const bytes = fromBase58(ix.data);
            if (bytes.length === 0) continue;
            const disc = bytes[0];

            if (disc === DISC.Allocate) {
                data = new Uint8Array(0);
            } else if (disc === DISC.Write && bytes.length >= 5) {
                const offset = readU32LE(bytes, 1);
                const chunk = bytes.slice(5);
                if (chunk.length > 0) {
                    data = writeChunk(data, chunk, offset);
                }
            }
        }
    }

    return data;
}

// ─── State machine ───────────────────────────────────────────────────────────

async function applyInstruction(
    state: VirtualState,
    ix: CompiledInstruction,
    keys: string[],
    rpc: SolanaRpcClient,
): Promise<{ next: VirtualState; closed: boolean; name: string }> {
    const bytes = fromBase58(ix.data);
    if (bytes.length === 0) return { closed: false, name: 'Unknown', next: state };

    const disc = bytes[0];
    const name = DISC_NAME[disc] ?? `Unknown(${disc})`;
    const next = cloneState(state);

    switch (disc) {
        case DISC.Allocate: {
            next.discriminator = 1;
            next.data = new Uint8Array(0);
            next.dataLength = 0;
            if (bytes.length >= 17) next.seed = bytes.slice(1, 17);
            if (ix.accounts.length >= 2) next.authority = keys[ix.accounts[1]] as Address;
            next.canonical = ix.accounts.length >= 3;
            break;
        }

        case DISC.Write: {
            if (bytes.length < 5) break;
            const offset = readU32LE(bytes, 1);
            const inline = bytes.slice(5);

            if (inline.length > 0) {
                next.data = writeChunk(next.data, inline, offset);
            } else if (ix.accounts.length >= 3) {
                const srcAddr = keys[ix.accounts[2]] as Address;
                const srcData = await reconstructBufferData(rpc, srcAddr);
                next.data = writeChunk(next.data, srcData, offset);
            }
            break;
        }

        case DISC.Initialize: {
            if (bytes.length < 21) break;
            next.seed = bytes.slice(1, 17);
            next.encoding = bytes[17];
            next.compression = bytes[18];
            next.format = bytes[19];
            next.dataSource = bytes[20];
            if (ix.accounts.length >= 2) next.authority = keys[ix.accounts[1]] as Address;
            next.canonical = ix.accounts.length >= 3;

            if (next.discriminator === 1) {
                next.discriminator = 2;
                next.dataLength = next.data.length;
            } else {
                next.discriminator = 2;
                const inline = bytes.slice(21);
                next.data = inline;
                next.dataLength = inline.length;
            }
            break;
        }

        case DISC.SetData: {
            if (bytes.length < 4) break;
            next.encoding = bytes[1];
            next.compression = bytes[2];
            next.format = bytes[3];

            if (bytes.length >= 5) {
                next.dataSource = bytes[4];

                if (bytes.length > 5) {
                    const inline = bytes.slice(5);
                    next.data = inline;
                    next.dataLength = inline.length;
                } else if (ix.accounts.length >= 3) {
                    const bufAddr = keys[ix.accounts[2]] as Address;
                    const bufData = await reconstructBufferData(rpc, bufAddr);
                    next.data = bufData;
                    next.dataLength = bufData.length;
                }
            } else if (ix.accounts.length >= 3) {
                next.dataSource = 0;
                const bufAddr = keys[ix.accounts[2]] as Address;
                const bufData = await reconstructBufferData(rpc, bufAddr);
                next.data = bufData;
                next.dataLength = bufData.length;
            }
            break;
        }

        case DISC.SetAuthority: {
            if (bytes.length >= 33) {
                const allZero = bytes.slice(1, 33).every(b => b === 0);
                next.authority = allZero ? null : rawBytesToAddress(bytes, 1);
            } else {
                next.authority = null;
            }
            break;
        }

        case DISC.SetImmutable: {
            next.mutable = false;
            break;
        }

        case DISC.Close: {
            return { closed: true, name, next };
        }

        case DISC.Trim:
        case DISC.Extend:
            break;
    }

    return { closed: false, name, next };
}

// ─── Decoding ────────────────────────────────────────────────────────────────

function tryDecode(state: VirtualState): string | null {
    if (state.discriminator !== 2) return null;
    if (state.dataSource !== 0) return null;
    if (state.dataLength === 0) return null;

    try {
        return pmpUnpackDirectData({
            compression: state.compression as Compression,
            data: state.data.slice(0, state.dataLength),
            encoding: state.encoding as Encoding,
        });
    } catch {
        return null;
    }
}

// ─── History reconstruction ──────────────────────────────────────────────────

/**
 * Replay the full PMP write history for one metadata account derived from
 * `(programId, seed, authority)`. Defaults match {@link fetchIdl}: `seed='idl'`,
 * `authority=null` (canonical). Pass `authority: IDL_FALLBACK_PMP_AUTHORITIES[0]` to
 * walk the non-canonical fndn-fallback history. To enumerate every authority
 * known to this library at once, iterate {@link buildPmpIdlLookups} and call
 * this once per lookup.
 */
export async function reconstructPmpHistory(
    rpc: SolanaRpcClient,
    programId: Address,
    options?: { seed?: Seed; authority?: Address | null },
): Promise<Snapshot[]> {
    const seed: Seed = options?.seed ?? 'idl';
    const [metadataAddr] = await findMetadataPda({
        authority: options?.authority ?? null,
        program: programId,
        seed,
    });

    const sigs = await fetchAllSignatures(rpc, metadataAddr);
    const snapshots: Snapshot[] = [];
    let state = emptyState();

    for (const sigInfo of sigs) {
        if (sigInfo.err) continue;

        let tx: ParsedTx | null;
        try {
            tx = await fetchTx(rpc, sigInfo.signature);
        } catch {
            continue;
        }
        if (!tx?.transaction?.message) continue;
        if (tx.meta?.err) continue;

        const keys = resolveAccountKeys(tx);
        const targetIdx = keys.indexOf(metadataAddr as string);
        if (targetIdx === -1) continue;

        const relevant = flattenInstructions(tx).filter(
            ix =>
                keys[ix.programIdIndex] === (PROGRAM_METADATA_PROGRAM_ADDRESS as string) &&
                ix.accounts[0] === targetIdx,
        );
        if (relevant.length === 0) continue;

        let lastName = 'Unknown';
        let closed = false;

        for (const ix of relevant) {
            const result = await applyInstruction(state, ix, keys, rpc);
            state = result.next;
            lastName = result.name;
            if (result.closed) {
                closed = true;
                break;
            }
        }

        snapshots.push({
            blockTime: sigInfo.blockTime,
            decodedContent: closed ? null : tryDecode(state),
            instruction: lastName,
            signature: sigInfo.signature,
            slot: sigInfo.slot,
            state: closed ? null : cloneState(state),
        });

        if (closed) break;
    }

    return snapshots;
}

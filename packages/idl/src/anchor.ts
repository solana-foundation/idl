import { Address, createAddressWithSeed, getProgramDerivedAddress } from '@solana/kit';

import { inflate } from './decompress.js';
import {
    fromBase58,
    readU32LE,
    writeChunk,
    resolveAccountKeys,
    flattenInstructions,
    fetchAllSignatures,
    fetchTx,
    type Snapshot,
    type SolanaRpcClient,
    type ParsedTx,
} from './rpc.js';

// ─── Instruction discriminators ──────────────────────────────────────────────

/**
 * SHA-256 via the WHATWG WebCrypto digest (`crypto.subtle`), available in
 * Node >= 18, browsers, and Bun — the same primitive `@solana/kit` uses for PDA
 * derivation. Deriving the discriminators from their instruction names at
 * runtime (the way Anchor does) keeps this module free of `node:crypto` while
 * staying self-documenting.
 */
async function sha256(input: string): Promise<Uint8Array> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return new Uint8Array(digest);
}

/**
 * First 8 bytes of `sha256("global:<name>")` — an Anchor >=0.30 instruction
 * discriminator. Uses `.slice` (not `.subarray`) so each discriminator is a
 * standalone 8-byte buffer rather than a view over the 32-byte digest — keeps
 * `.buffer`/`DataView` access correct and matches `idlIxTag`.
 */
async function anchorGlobalDisc(name: string): Promise<Uint8Array> {
    return (await sha256(`global:${name}`)).slice(0, 8);
}

type GlobalDiscName =
    | 'close'
    | 'createBuffer'
    | 'idlClose'
    | 'idlCreateBuffer'
    | 'idlSetAuthority'
    | 'idlSetBuffer'
    | 'idlWrite'
    | 'setAuthority'
    | 'setBuffer'
    | 'write';

type Discriminators = {
    /**
     * `sha256("anchor:idl")[:8]`, reversed to little-endian. In Anchor's Rust
     * code this is a u64 constant serialized via Borsh (LE), so the on-chain
     * bytes are the reverse of the raw SHA256 output.
     */
    idlIxTag: Uint8Array;
    /** New-style (Anchor >=0.30) per-instruction global discriminators. */
    global: Record<GlobalDiscName, Uint8Array>;
};

/**
 * The discriminators are deterministic, so derive them once and memoize.
 * Hashing is async (WebCrypto), so callers `await getDiscriminators()` before
 * walking instruction data; every later call resolves instantly from the
 * cached promise.
 */
let discriminatorsPromise: Promise<Discriminators> | null = null;

export function getDiscriminators(): Promise<Discriminators> {
    discriminatorsPromise ??= (async (): Promise<Discriminators> => {
        const [
            idlIxTagHash,
            close,
            createBuffer,
            idlClose,
            idlCreateBuffer,
            idlSetAuthority,
            idlSetBuffer,
            idlWrite,
            setAuthority,
            setBuffer,
            write,
        ] = await Promise.all([
            sha256('anchor:idl'),
            anchorGlobalDisc('close'),
            anchorGlobalDisc('create_buffer'),
            anchorGlobalDisc('idl_close'),
            anchorGlobalDisc('idl_create_buffer'),
            anchorGlobalDisc('idl_set_authority'),
            anchorGlobalDisc('idl_set_buffer'),
            anchorGlobalDisc('idl_write'),
            anchorGlobalDisc('set_authority'),
            anchorGlobalDisc('set_buffer'),
            anchorGlobalDisc('write'),
        ]);

        // Freeze the memoized snapshot so a consumer can't swap out a
        // discriminator and corrupt matching for the lifetime of the process.
        return Object.freeze({
            global: Object.freeze({
                close,
                createBuffer,
                idlClose,
                idlCreateBuffer,
                idlSetAuthority,
                idlSetBuffer,
                idlWrite,
                setAuthority,
                setBuffer,
                write,
            }),
            idlIxTag: idlIxTagHash.slice(0, 8).reverse(),
        });
    })().catch(err => {
        discriminatorsPromise = null;
        throw err;
    });
    return discriminatorsPromise;
}

function matchDisc(data: Uint8Array, disc: Uint8Array): boolean {
    if (data.length < 8) return false;
    for (let i = 0; i < 8; i++) {
        if (data[i] !== disc[i]) return false;
    }
    return true;
}

function isLegacyIdlIx(data: Uint8Array, idlIxTag: Uint8Array): boolean {
    if (data.length < 8) return false;
    for (let i = 0; i < 8; i++) {
        if (data[i] !== idlIxTag[i]) return false;
    }
    return true;
}

/**
 * Legacy Anchor IDL instruction format (pre-0.30):
 *   [8 bytes] IDL_IX_TAG
 *   [1 byte]  Borsh enum variant index
 *   [...]     variant payload
 *
 * Variants (matching Anchor's Borsh enum order in anchor-lang <=0.29):
 *   0=Create, 1=CreateBuffer, 2=Write, 3=SetBuffer, 4=SetAuthority
 *
 * New-style (>=0.30): each instruction has its own 8-byte global discriminator.
 */
type IdlIxName = 'Create' | 'CreateBuffer' | 'Write' | 'SetAuthority' | 'SetBuffer' | 'Close';

const LEGACY_VARIANT: Record<number, IdlIxName> = {
    0: 'Create',
    1: 'CreateBuffer',
    2: 'Write',
    3: 'SetBuffer',
    4: 'SetAuthority',
};

function identifyInstruction(data: Uint8Array, discs: Discriminators): { name: IdlIxName; legacy: boolean } | null {
    if (data.length < 8) return null;

    const g = discs.global;
    if (matchDisc(data, g.createBuffer) || matchDisc(data, g.idlCreateBuffer))
        return { legacy: false, name: 'CreateBuffer' };
    if (matchDisc(data, g.write) || matchDisc(data, g.idlWrite)) return { legacy: false, name: 'Write' };
    if (matchDisc(data, g.setBuffer) || matchDisc(data, g.idlSetBuffer)) return { legacy: false, name: 'SetBuffer' };
    if (matchDisc(data, g.setAuthority) || matchDisc(data, g.idlSetAuthority))
        return { legacy: false, name: 'SetAuthority' };
    if (matchDisc(data, g.close) || matchDisc(data, g.idlClose)) return { legacy: false, name: 'Close' };

    if (isLegacyIdlIx(data, discs.idlIxTag) && data.length >= 9) {
        const variant = data[8];
        const name = LEGACY_VARIANT[variant];
        if (name) return { legacy: true, name };
    }

    return null;
}

// ─── IDL address derivation ──────────────────────────────────────────────────

export async function findAnchorIdlAddress(programId: Address): Promise<Address> {
    const [base] = await getProgramDerivedAddress({
        programAddress: programId,
        seeds: [],
    });

    return await createAddressWithSeed({
        baseAddress: base,
        programAddress: programId,
        seed: 'anchor:idl',
    });
}

// ─── Write payload extraction ────────────────────────────────────────────────

/**
 * Extract the data bytes from a Write instruction.
 *
 * Legacy format: [8 IDL_IX_TAG][1 variant=2][4 vec_len][vec_len bytes]
 * New format:    [8 disc]                   [4 vec_len][vec_len bytes]
 */
function extractWriteData(bytes: Uint8Array, legacy: boolean): Uint8Array<ArrayBuffer> | null {
    const vecStart = legacy ? 9 : 8;
    if (bytes.length < vecStart + 4) return null;

    const vecLen = readU32LE(bytes, vecStart);
    const dataStart = vecStart + 4;
    if (bytes.length < dataStart + vecLen) return null;

    return bytes.slice(dataStart, dataStart + vecLen) as Uint8Array<ArrayBuffer>;
}

// ─── Buffer reconstruction (Anchor) ─────────────────────────────────────────

async function reconstructAnchorBufferData(
    rpc: SolanaRpcClient,
    bufferAddr: Address,
    programId: Address,
    discs: Discriminators,
): Promise<Uint8Array<ArrayBuffer>> {
    let data: Uint8Array<ArrayBuffer> = new Uint8Array(0);
    let writeOffset = 0;

    const sigs = await fetchAllSignatures(rpc, bufferAddr);

    for (const sigInfo of sigs) {
        if (sigInfo.err) continue;

        const tx = await fetchTx(rpc, sigInfo.signature);
        if (!tx?.transaction?.message) continue;

        const keys = resolveAccountKeys(tx);
        const targetIdx = keys.indexOf(bufferAddr as string);
        if (targetIdx === -1) continue;

        for (const ix of flattenInstructions(tx)) {
            if (keys[ix.programIdIndex] !== (programId as string)) continue;
            if (!ix.accounts.includes(targetIdx)) continue;

            const bytes = fromBase58(ix.data);
            const info = identifyInstruction(bytes, discs);
            if (!info) continue;

            if (info.name === 'CreateBuffer') {
                data = new Uint8Array(0);
                writeOffset = 0;
            } else if (info.name === 'Write') {
                const chunk = extractWriteData(bytes, info.legacy);
                if (chunk && chunk.length > 0) {
                    data = writeChunk(data, chunk, writeOffset);
                    writeOffset += chunk.length;
                }
            }
        }
    }

    return data;
}

// ─── IDL decoding ────────────────────────────────────────────────────────────

/**
 * Decode accumulated IDL data. The accumulated write data represents the raw
 * bytes of the on-chain IdlAccount data region, which is zlib-compressed JSON.
 *
 * We try to decompress directly (if writes represent just the compressed payload)
 * or skip the account header (8 disc + 32 authority + 4 len = 44 bytes) if the
 * data includes the full account layout.
 */
async function decodeIdlData(data: Uint8Array): Promise<string | null> {
    if (data.length === 0) return null;

    // Try direct decompression first (data is raw compressed IDL)
    try {
        const decompressed = await inflate(data);
        return new TextDecoder().decode(decompressed);
    } catch {
        // Not raw compressed data
    }

    // Try skipping a 4-byte length prefix (some formats prepend the data length)
    if (data.length > 4) {
        const dataLen = readU32LE(data, 0);
        if (dataLen > 0 && dataLen <= data.length - 4) {
            try {
                const decompressed = await inflate(data.slice(4, 4 + dataLen));
                return new TextDecoder().decode(decompressed);
            } catch {
                // Not this format
            }
        }
    }

    // Try skipping the full account header (8 + 32 + 4 = 44 bytes)
    if (data.length > 44) {
        const dataLen = readU32LE(data, 40);
        if (dataLen > 0 && dataLen <= data.length - 44) {
            try {
                const decompressed = await inflate(data.slice(44, 44 + dataLen));
                return new TextDecoder().decode(decompressed);
            } catch {
                // Not this format
            }
        }
    }

    return null;
}

// ─── State machine ───────────────────────────────────────────────────────────

type AnchorIdlState = {
    data: Uint8Array<ArrayBuffer>;
    writeOffset: number;
    authority: string | null;
    closed: boolean;
};

function emptyAnchorState(): AnchorIdlState {
    return { authority: null, closed: false, data: new Uint8Array(0), writeOffset: 0 };
}

function cloneAnchorState(s: AnchorIdlState): AnchorIdlState {
    return { ...s, data: new Uint8Array(s.data) as Uint8Array<ArrayBuffer> };
}

// ─── History reconstruction ──────────────────────────────────────────────────

export async function reconstructAnchorHistory(rpc: SolanaRpcClient, programId: Address): Promise<Snapshot[]> {
    const idlAddr = await findAnchorIdlAddress(programId);
    const discs = await getDiscriminators();

    const sigs = await fetchAllSignatures(rpc, idlAddr);
    const snapshots: Snapshot[] = [];
    let state = emptyAnchorState();

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
        const targetIdx = keys.indexOf(idlAddr as string);
        if (targetIdx === -1) continue;

        const relevant = flattenInstructions(tx).filter(
            ix => keys[ix.programIdIndex] === (programId as string) && ix.accounts.includes(targetIdx),
        );
        if (relevant.length === 0) continue;

        let lastName = 'Unknown';
        let closed = false;

        for (const ix of relevant) {
            const bytes = fromBase58(ix.data);
            const info = identifyInstruction(bytes, discs);
            if (!info) continue;
            lastName = info.name;

            const next = cloneAnchorState(state);

            switch (info.name) {
                case 'Create': {
                    next.data = new Uint8Array(0);
                    next.writeOffset = 0;
                    break;
                }

                case 'CreateBuffer': {
                    next.data = new Uint8Array(0);
                    next.writeOffset = 0;
                    break;
                }

                case 'Write': {
                    const chunk = extractWriteData(bytes, info.legacy);
                    if (chunk && chunk.length > 0) {
                        next.data = writeChunk(next.data, chunk, next.writeOffset);
                        next.writeOffset += chunk.length;
                    }
                    break;
                }

                case 'SetBuffer': {
                    // Anchor IdlSetBuffer accounts: [buffer, idl, authority]
                    // The buffer is always the first account in the instruction.
                    const bufferAccIdx = ix.accounts[0];
                    const bufferAddr = keys[bufferAccIdx] as Address | undefined;
                    if (bufferAddr && bufferAccIdx !== targetIdx) {
                        const bufData = await reconstructAnchorBufferData(rpc, bufferAddr, programId, discs);
                        next.data = bufData;
                        next.writeOffset = bufData.length;
                    }
                    break;
                }

                case 'SetAuthority': {
                    break;
                }

                case 'Close': {
                    closed = true;
                    next.data = new Uint8Array(0);
                    next.writeOffset = 0;
                    break;
                }
            }

            state = next;
            if (closed) break;
        }

        let decodedContent: string | null = null;
        if (!closed && state.data.length > 0) {
            decodedContent = await decodeIdlData(state.data);
        }

        snapshots.push({
            blockTime: sigInfo.blockTime,
            decodedContent,
            instruction: lastName,
            signature: sigInfo.signature,
            slot: sigInfo.slot,
            state: closed ? null : cloneAnchorState(state),
        });

        if (closed) break;
    }

    return snapshots;
}

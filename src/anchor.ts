import {
    Address,
    createAddressWithSeed,
    getProgramDerivedAddress,
    Rpc,
    SolanaRpcApi,
} from '@solana/kit';
import { createHash } from 'node:crypto';
import { inflate } from 'node:zlib';
import { promisify } from 'node:util';

import {
    fromBase58,
    readU32LE,
    writeChunk,
    resolveAccountKeys,
    flattenInstructions,
    fetchAllSignatures,
    fetchTx,
    type Snapshot,
    type ParsedTx,
} from './rpc.js';

const zlibInflate = promisify(inflate);

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * sha256("anchor:idl") first 8 bytes, reversed to little-endian.
 * In Anchor's Rust code this is a u64 constant serialized via Borsh (LE),
 * so the on-chain bytes are the reverse of the raw SHA256 output.
 */
const IDL_IX_TAG = Buffer.from(
    createHash('sha256').update('anchor:idl').digest().subarray(0, 8),
).reverse();

function anchorGlobalDisc(name: string): Buffer {
    return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

/** New-style (Anchor >=0.30) per-instruction discriminators. */
const GLOBAL_DISCS = {
    createBuffer: anchorGlobalDisc('create_buffer'),
    write: anchorGlobalDisc('write'),
    setBuffer: anchorGlobalDisc('set_buffer'),
    setAuthority: anchorGlobalDisc('set_authority'),
    close: anchorGlobalDisc('close'),
    idlCreateBuffer: anchorGlobalDisc('idl_create_buffer'),
    idlWrite: anchorGlobalDisc('idl_write'),
    idlSetBuffer: anchorGlobalDisc('idl_set_buffer'),
    idlSetAuthority: anchorGlobalDisc('idl_set_authority'),
    idlClose: anchorGlobalDisc('idl_close'),
} as const;

function matchDisc(data: Uint8Array, disc: Buffer): boolean {
    if (data.length < 8) return false;
    for (let i = 0; i < 8; i++) {
        if (data[i] !== disc[i]) return false;
    }
    return true;
}

function isLegacyIdlIx(data: Uint8Array): boolean {
    if (data.length < 8) return false;
    for (let i = 0; i < 8; i++) {
        if (data[i] !== IDL_IX_TAG[i]) return false;
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

function identifyInstruction(data: Uint8Array): { name: IdlIxName; legacy: boolean } | null {
    if (data.length < 8) return null;

    if (matchDisc(data, GLOBAL_DISCS.createBuffer) || matchDisc(data, GLOBAL_DISCS.idlCreateBuffer))
        return { name: 'CreateBuffer', legacy: false };
    if (matchDisc(data, GLOBAL_DISCS.write) || matchDisc(data, GLOBAL_DISCS.idlWrite))
        return { name: 'Write', legacy: false };
    if (matchDisc(data, GLOBAL_DISCS.setBuffer) || matchDisc(data, GLOBAL_DISCS.idlSetBuffer))
        return { name: 'SetBuffer', legacy: false };
    if (matchDisc(data, GLOBAL_DISCS.setAuthority) || matchDisc(data, GLOBAL_DISCS.idlSetAuthority))
        return { name: 'SetAuthority', legacy: false };
    if (matchDisc(data, GLOBAL_DISCS.close) || matchDisc(data, GLOBAL_DISCS.idlClose))
        return { name: 'Close', legacy: false };

    if (isLegacyIdlIx(data) && data.length >= 9) {
        const variant = data[8];
        const name = LEGACY_VARIANT[variant];
        if (name) return { name, legacy: true };
    }

    return null;
}

// ─── IDL address derivation ──────────────────────────────────────────────────

export async function findAnchorIdlAddress(programId: Address): Promise<Address> {
    const [base] = await getProgramDerivedAddress({
        programAddress: programId,
        seeds: [],
    });

    return createAddressWithSeed({
        baseAddress: base,
        seed: 'anchor:idl',
        programAddress: programId,
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
    rpc: Rpc<SolanaRpcApi>,
    bufferAddr: Address,
    programId: Address,
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
            const info = identifyInstruction(bytes);
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
        const decompressed = await zlibInflate(data);
        return new TextDecoder().decode(decompressed);
    } catch {
        // Not raw compressed data
    }

    // Try skipping a 4-byte length prefix (some formats prepend the data length)
    if (data.length > 4) {
        const dataLen = readU32LE(data, 0);
        if (dataLen > 0 && dataLen <= data.length - 4) {
            try {
                const decompressed = await zlibInflate(data.slice(4, 4 + dataLen));
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
                const decompressed = await zlibInflate(data.slice(44, 44 + dataLen));
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
    return { data: new Uint8Array(0), writeOffset: 0, authority: null, closed: false };
}

function cloneAnchorState(s: AnchorIdlState): AnchorIdlState {
    return { ...s, data: new Uint8Array(s.data) as Uint8Array<ArrayBuffer> };
}

// ─── History reconstruction ──────────────────────────────────────────────────

export async function reconstructAnchorHistory(
    rpc: Rpc<SolanaRpcApi>,
    programId: Address,
): Promise<Snapshot[]> {
    const idlAddr = await findAnchorIdlAddress(programId);

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
            (ix) =>
                keys[ix.programIdIndex] === (programId as string) &&
                ix.accounts.includes(targetIdx),
        );
        if (relevant.length === 0) continue;

        let lastName = 'Unknown';
        let closed = false;

        for (const ix of relevant) {
            const bytes = fromBase58(ix.data);
            const info = identifyInstruction(bytes);
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
                        const bufData = await reconstructAnchorBufferData(rpc, bufferAddr, programId);
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
            slot: sigInfo.slot,
            blockTime: sigInfo.blockTime,
            signature: sigInfo.signature,
            instruction: lastName,
            state: closed ? null : cloneAnchorState(state),
            decodedContent,
        });

        if (closed) break;
    }

    return snapshots;
}

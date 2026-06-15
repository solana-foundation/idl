import { createSolanaRpc } from '@solana/kit';

/** RPC handle from `createSolanaRpc` (mainnet or devnet URLs; PMP isn't deployed on testnet). */
export type SolanaRpcClient = ReturnType<typeof createSolanaRpc>;

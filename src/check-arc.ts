import { erc20Abi } from 'viem';
import { ArcReader } from './adapters/arc.ts';
import { USDC, CHAIN_ID } from './domain.ts';

// Public read-only network check. No wallet, secret, signature or transfer.
try {
  const arc = new ArcReader(); await arc.network();
  const [block, decimals] = await Promise.all([arc.client.getBlockNumber(), arc.client.readContract({ address: USDC, abi: erc20Abi, functionName: 'decimals' })]);
  if (decimals !== 6) throw new Error('UNEXPECTED_DECIMALS');
  console.log(JSON.stringify({ chainId: CHAIN_ID, block: block.toString(), usdcDecimals: decimals, readOnly: true }));
} catch { console.error('ARC_READ_CHECK_FAILED'); process.exitCode = 1; }

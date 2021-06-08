import fs from 'fs';
import process from 'process';
import { SIGINT } from './process';
import { Node } from '@gxchain2/core';
import { RpcServer } from '@gxchain2/rpc';
import { setLevel, logger } from '@gxchain2/utils';

export async function startNode(opts: { [key: string]: any }): Promise<[Node, undefined | RpcServer]> {
  setLevel(opts.verbosity);
  if (!fs.existsSync(opts.datadir)) {
    fs.mkdirSync(opts.datadir);
  }
  const p2pOptions = {
    tcpPort: opts.p2pTcpPort ? Number(opts.p2pTcpPort) : undefined,
    wsPort: opts.p2pWsPort ? Number(opts.p2pWsPort) : undefined,
    bootnodes: Array.isArray(opts.bootnodes) ? opts.bootnodes : undefined
  };
  const mineOptions = opts.mine
    ? {
        coinbase: opts.coinbase,
        gasLimit: opts.blockGasLimit
      }
    : undefined;
  const node = new Node({
    databasePath: opts.datadir,
    chain: opts.chain,
    mine: mineOptions,
    p2p: p2pOptions
  });
  await node.init();
  SIGINT(node);
  let server: undefined | RpcServer;
  if (opts.rpc) {
    server = new RpcServer(Number(opts.rpcPort), opts.rpcHost, opts.rpcApi, node);
    await server.start();
  }
  return [node, server];
}

export function installStartAction(program: any) {
  program.action(async () => {
    try {
      await startNode(program.opts());
    } catch (err) {
      logger.error('Start error:', err);
      process.exit(1);
    }
  });
}

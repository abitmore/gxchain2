import ipc from 'node-ipc';
import { TopicsData, CallData, Client } from '@rei-network/api';
import { ipcId } from './constants';

/**
 * Convert command line commands to json message
 * @param method - method name
 * @param args - args for method use
 * @returns Json message
 */
function passMessageToJsonAndEmit(method: string, ...args) {
  ipc.of[ipcId].emit(
    'message',
    JSON.stringify({
      method: method,
      params: args
    })
  );
}

export const adminModule = {
  rpcRunning() {
    passMessageToJsonAndEmit('rpcRunning');
  },
  startRpc(host?: string, port?: number) {
    passMessageToJsonAndEmit('startRpc', host, port);
  },
  stopRpc() {
    passMessageToJsonAndEmit('stopRpc');
  },
  addPeer(enrTxt: string) {
    passMessageToJsonAndEmit('addPeer', enrTxt);
  },
  removePeer(enrTxt: string) {
    passMessageToJsonAndEmit('removePeer', enrTxt);
  },
  addTrustedPeer(enrTxt: string) {
    passMessageToJsonAndEmit('addTrustedPeer', enrTxt);
  },
  removeTrutedPeer(enrTxt: string) {
    passMessageToJsonAndEmit('removeTrutedPeer', enrTxt);
  },
  peers() {
    passMessageToJsonAndEmit('peers');
  },
  nodeInfo() {
    passMessageToJsonAndEmit('nodeInfo');
  },
  isTrusted(enrTxt: string) {
    passMessageToJsonAndEmit('isTrusted', enrTxt);
  }
};

export const debugModule = {
  traceBlock(blockRlp: string, options: any) {
    passMessageToJsonAndEmit('traceBlock', blockRlp, options);
  },
  traceBlockByNumber(tag: string, options: any) {
    passMessageToJsonAndEmit('traceBlockByNumber', tag, options);
  },
  traceBlockByHash(hash: string, options: any) {
    passMessageToJsonAndEmit('traceBlockByHash', hash, options);
  },
  traceTransaction(hash: string, options: any) {
    passMessageToJsonAndEmit('traceTransaction', hash, options);
  },
  traceCall(data: CallData, tag: string, options: any) {
    passMessageToJsonAndEmit('traceCall', data, tag, options);
  }
};

export const ethModule = {
  protocolVersion() {
    passMessageToJsonAndEmit('protocolVersion');
  },
  syncing() {
    passMessageToJsonAndEmit('syncing');
  },
  chainId() {
    passMessageToJsonAndEmit('chainId');
  },
  coinbase() {
    passMessageToJsonAndEmit('coinbase');
  },
  mining() {
    passMessageToJsonAndEmit('mining');
  },
  hashrate() {
    passMessageToJsonAndEmit('hashrate');
  },
  gasPrice() {
    passMessageToJsonAndEmit('gasPrice');
  },
  accounts() {
    passMessageToJsonAndEmit('accounts');
  },
  blockNumber() {
    passMessageToJsonAndEmit('blockNumber');
  },
  getBalance(address: string, tag: any) {
    passMessageToJsonAndEmit('getBalance', address, tag);
  },
  getStorageAt(address: string, key: string, tag: any) {
    passMessageToJsonAndEmit('getStorageAt', address, key, tag);
  },
  getTransactionCount(address: string, tag: any) {
    passMessageToJsonAndEmit('getTransactionCount', address, tag);
  },
  getBlockTransactionCountByHash(hash: string) {
    passMessageToJsonAndEmit('getBlockTransactionCountByHash', hash);
  },
  getBlockTransactionCountByNumber(tag: any) {
    passMessageToJsonAndEmit('getBlockTransactionCountByNumber', tag);
  },
  getUncleCountByBlockHash(hash: string) {
    passMessageToJsonAndEmit('getUncleCountByBlockHash', hash);
  },
  getUncleCountByBlockNumber(tag: any) {
    passMessageToJsonAndEmit('getUncleCountByBlockNumber', tag);
  },
  getCode(address: string, tag: any) {
    passMessageToJsonAndEmit('getCode', address, tag);
  },
  sign(address: string, data: string) {
    passMessageToJsonAndEmit('sign', address, data);
  },
  signTransaction(data: CallData) {
    passMessageToJsonAndEmit('signTransaction', data);
  },
  sendTransaction(data: CallData) {
    passMessageToJsonAndEmit('sendTransaction', data);
  },
  sendRawTransaction(rawtx: string) {
    passMessageToJsonAndEmit('sendRawTransaction', rawtx);
  },
  call(data: CallData, tag: any) {
    passMessageToJsonAndEmit('call', data, tag);
  },
  estimateGas(data: CallData, tag: any) {
    passMessageToJsonAndEmit('estimateGas', data, tag);
  },
  getBlockByHash(hash: string, fullTransactions: boolean) {
    passMessageToJsonAndEmit('getBlockByHash', hash, fullTransactions);
  },
  getBlockByNumber(tag: any, fullTransactions: boolean) {
    passMessageToJsonAndEmit('getBlockByNumber', tag, fullTransactions);
  },
  getTransactionByHash(hash: string) {
    passMessageToJsonAndEmit('getTransactionByHash', hash);
  },
  getTransactionByBlockHashAndIndex(hash: string, index: string) {
    passMessageToJsonAndEmit('getTransactionByBlockHashAndIndex', hash, index);
  },
  getTransactionByBlockNumberAndIndex(tag: any, index: string) {
    passMessageToJsonAndEmit('getTransactionByBlockNumberAndIndex', tag, index);
  },
  getTransactionReceipt(hash: string) {
    passMessageToJsonAndEmit('getTransactionReceipt', hash);
  },
  getUncleByBlockHashAndIndex() {
    passMessageToJsonAndEmit('getUncleByBlockHashAndIndex');
  },
  getUncleByBlockNumberAndIndex() {
    passMessageToJsonAndEmit('getUncleByBlockNumberAndIndex');
  },
  getCompilers() {
    passMessageToJsonAndEmit('getCompilers');
  },
  compileSolidity() {
    passMessageToJsonAndEmit('compileSolidity');
  },
  compileLLL() {
    passMessageToJsonAndEmit('compileLLL');
  },
  compileSerpent() {
    passMessageToJsonAndEmit('compileSerpent');
  },
  newFilter(fromBlock?: string, toBlock?: string, _addresses?: string | string[], topics?: TopicsData) {
    passMessageToJsonAndEmit('newFilter', { fromBlock, toBlock, address: _addresses, topics: topics });
  },
  eth_newBlockFilter() {
    passMessageToJsonAndEmit('eth_newBlockFilter');
  },
  eth_newPendingTransactionFilter() {
    passMessageToJsonAndEmit('eth_newPendingTransactionFilter');
  },
  eth_uninstallFilter(id: string) {
    passMessageToJsonAndEmit('eth_uninstallFilter', id);
  },
  eth_getFilterChanges(id: string) {
    passMessageToJsonAndEmit('eth_getFilterChanges', id);
  },
  eth_getFilterLogs(id: string) {
    passMessageToJsonAndEmit('eth_getFilterLogs', id);
  },
  eth_getLogs(fromBlock?: string, toBlock?: string, address?: string | string[], topics?: TopicsData, blockhash?: string) {
    passMessageToJsonAndEmit('eth_getLogs', { fromBlock, toBlock, address: address, topics: topics, blockhash });
  },
  eth_getWork() {
    passMessageToJsonAndEmit('eth_getWork');
  },
  eth_submitWork() {
    passMessageToJsonAndEmit('eth_submitWork');
  },
  eth_submitHashrate() {
    passMessageToJsonAndEmit('eth_submitHashrate');
  },
  eth_unsubscribe(id: string) {
    passMessageToJsonAndEmit('eth_unsubscribe', id);
  },
  eth_subscribe(type: string, options: undefined | { address?: string | string[]; topics?: TopicsData }, client?: Client) {
    passMessageToJsonAndEmit('eth_subscribe', type, options, client);
  }
};

export const netModule = {
  version() {
    passMessageToJsonAndEmit('version');
  },
  listenging() {
    passMessageToJsonAndEmit('listenging');
  },
  peerCount() {
    passMessageToJsonAndEmit('peerCount');
  }
};

export const reiModule = {
  getCrude(address: string, tag: any) {
    passMessageToJsonAndEmit('getCrude', address, tag);
  },
  getUsedCrude(address: string, tag: any) {
    passMessageToJsonAndEmit('getUsedCrude', address, tag);
  },
  getTotalAmount(address: string, tag: any) {
    passMessageToJsonAndEmit('getTotalAmount', address, tag);
  },
  getDailyFee(tag: string) {
    passMessageToJsonAndEmit('getDailyFee', tag);
  },
  getMinerRewardFactor(tag: string) {
    passMessageToJsonAndEmit('getMinerRewardFactor', tag);
  }
};

export const txpoolModule = {
  content() {
    passMessageToJsonAndEmit('content');
  }
};

export const web3Module = {
  clientVersion() {
    passMessageToJsonAndEmit('clientVersion');
  },
  sha3(data: string) {
    passMessageToJsonAndEmit('sha3', data);
  }
};

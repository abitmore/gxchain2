import { hexStringToBN, hexStringToBuffer } from '@gxchain2/utils';
import { Worker } from './worker';
import { Loop } from './loop';
import { Node } from '../node';
import { Address, BN, bufferToHex } from 'ethereumjs-util';

export interface MinerOptions {
  coinbase: string;
  mineInterval: number;
  gasLimit: string;
}

export class Miner extends Loop {
  public readonly worker: Worker;
  private _coinbase: Buffer;
  private _gasLimit: BN;
  private readonly node: Node;
  private readonly initPromise: Promise<void>;
  private readonly options?: MinerOptions;

  constructor(node: Node, options?: MinerOptions) {
    super(options?.mineInterval || 5000);
    this.node = node;
    this.options = options;
    this._coinbase = this?.options?.coinbase ? hexStringToBuffer(this.options.coinbase) : Address.zero().buf;
    this._gasLimit = this?.options?.gasLimit ? hexStringToBN(this.options.gasLimit) : hexStringToBN('0xbe5c8b');
    this.worker = new Worker(node, this);
    this.initPromise = this.init();
    node.sync.on('start synchronize', async () => {
      await this.worker.stopLoop();
      await this.stopLoop();
    });
    node.sync.on('synchronized', async () => {
      await this.worker.startLoop();
      await this.startLoop();
    });
    node.sync.on('synchronize failed', async () => {
      await this.worker.startLoop();
      await this.startLoop();
    });
  }

  get isMining() {
    return !!this.options;
  }

  get coinbase() {
    return this._coinbase;
  }

  get gasLimit() {
    return this._gasLimit;
  }

  async setCoinbase(coinbase: string | Buffer) {
    this._coinbase = typeof coinbase === 'string' ? hexStringToBuffer(coinbase) : coinbase;
    await this.worker.newBlock(this.node.blockchain.latestBlock);
  }

  async setGasLimit(gasLimit: string | BN) {
    this._gasLimit = typeof gasLimit === 'string' ? hexStringToBN(gasLimit) : gasLimit;
    await this.worker.newBlock(this.node.blockchain.latestBlock);
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    await this.worker.init();
  }

  async startLoop() {
    if (this.isMining) {
      await this.init();
      await super.startLoop();
    }
  }

  async mineBlock() {
    const block = await this.worker.getPendingBlock();
    if (block.header.number.eq(this.node.blockchain.latestBlock.header.number.addn(1)) && block.header.parentHash.equals(this.node.blockchain.latestBlock.hash())) {
      await this.node.newBlock(await this.node.processBlock(block));
    } else {
      console.warn('Miner, process, unkonw error, invalid pending block:', bufferToHex(block.hash()), 'latest:', bufferToHex(this.node.blockchain.latestBlock.hash()));
    }
  }

  protected async process() {
    try {
      await this.mineBlock();
    } catch (err) {
      console.error('Miner, process, error:', err);
    }
  }
}

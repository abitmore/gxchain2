import { BN, Address, bufferToHex } from 'ethereumjs-util';
import Heap from 'qheap';
import { FunctionalMap, createBufferFunctionalMap, FunctionalSet, createBufferFunctionalSet, Aborter, logger } from '@gxchain2/utils';
import { Transaction, WrappedTransaction } from '@gxchain2/tx';
import { StateManager } from '@gxchain2/state-manager';
import { Blockchain } from '@gxchain2/blockchain';
import { BlockHeader, Block, BlockBodyBuffer } from '@gxchain2/block';
import { Database } from '@gxchain2/database';
import { Common } from '@gxchain2/common';
import { TxSortedMap } from './txmap';
import { PendingTxMap } from './pendingmap';
import { TxPricedList } from './txpricedlist';
import { Journal } from './jonunal';

export interface INode {
  db: Database;
  common: Common;
  blockchain: Blockchain;
  getStateManager(root: Buffer): Promise<StateManager>;
  addPendingTxs: (txs: Transaction[]) => Promise<boolean[]>;
  miner: {
    gasLimit: BN;
  };
}

export function txSlots(tx: Transaction) {
  return Math.ceil(new WrappedTransaction(tx).size / 32768);
}

export function txCost(tx: Transaction) {
  return tx.value.add(tx.gasPrice.mul(tx.gasLimit));
}

export function checkTxIntrinsicGas(tx: Transaction) {
  const gas = tx.toCreationAddress() ? new BN(53000) : new BN(21000);
  const nz = new BN(0);
  const z = new BN(0);
  for (const b of tx.data) {
    (b !== 0 ? nz : z).iaddn(1);
  }
  gas.iadd(nz.muln(16));
  gas.iadd(z.muln(4));
  return gas.lte(uint64Max) && gas.lte(tx.gasLimit);
}

const uint64Max = new BN(Buffer.from('ffffffffffffffff', 'hex'));

export interface TxPoolOptions {
  txMaxSize?: number;

  priceLimit?: BN;
  priceBump?: number;

  accountSlots?: number;
  globalSlots?: number;
  accountQueue?: number;
  globalQueue?: number;

  node: INode;

  journal?: string;
  lifetime?: number;
  timeoutInterval?: number;
  rejournalInterval?: number;
}

class TxPoolAccount {
  private readonly getNonce: () => Promise<BN>;
  private _pending?: TxSortedMap;
  private _queue?: TxSortedMap;
  private _pendingNonce?: BN;
  timestamp: number = 0;

  constructor(getNonce: () => Promise<BN>) {
    this.getNonce = getNonce;
  }

  get pending() {
    return this._pending ? this._pending : (this._pending = new TxSortedMap(true));
  }

  get queue() {
    return this._queue ? this._queue : (this._queue = new TxSortedMap(false));
  }

  hasPending() {
    return this._pending && this._pending.size > 0;
  }

  hasQueue() {
    return this._queue && this._queue.size > 0;
  }

  async getPendingNonce() {
    if (!this._pendingNonce) {
      this._pendingNonce = await this.getNonce();
    }
    return this._pendingNonce.clone();
  }

  updatePendingNonce(nonce: BN, lower: boolean = false) {
    if (!this._pendingNonce || (lower ? this._pendingNonce.gt(nonce) : this._pendingNonce.lt(nonce))) {
      this._pendingNonce = nonce.clone();
    }
  }
}

export class TxPool {
  private aborter = new Aborter();

  private readonly accounts: FunctionalMap<Buffer, TxPoolAccount>;
  private readonly locals: FunctionalSet<Buffer>;
  private readonly txs: FunctionalMap<Buffer, Transaction>;
  private readonly node: INode;
  private readonly initPromise: Promise<void>;

  private currentHeader!: BlockHeader;
  private currentStateManager!: StateManager;

  private txMaxSize: number;

  private priceLimit: BN;
  private priceBump: number;

  private accountSlots: number;
  private globalSlots: number;
  private accountQueue: number;
  private globalQueue: number;
  private globalAllSlots: number;

  private priced: TxPricedList;
  private journal?: Journal;
  private lifetime: number;
  private timeoutInterval: number;
  private rejournalInterval: number;

  constructor(options: TxPoolOptions) {
    this.txMaxSize = options.txMaxSize || 32768 * 4;
    this.priceLimit = options.priceLimit || new BN(1);
    this.priceBump = options.priceBump || 10;
    this.accountSlots = options.accountSlots || 16;
    this.globalSlots = options.globalSlots || 4096;
    this.accountQueue = options.accountQueue || 64;
    this.globalQueue = options.globalQueue || 1024;
    this.globalAllSlots = 0;
    this.lifetime = options.lifetime || 60000;
    this.timeoutInterval = options.timeoutInterval || 10000;
    this.rejournalInterval = options.rejournalInterval || 60000 * 60;

    this.node = options.node;
    this.accounts = createBufferFunctionalMap<TxPoolAccount>();
    this.txs = createBufferFunctionalMap<Transaction>();
    this.locals = createBufferFunctionalSet();
    this.priced = new TxPricedList(this.txs);

    this.initPromise = this.init();

    this.timeoutLoop();
    if (options.journal) {
      this.journal = new Journal(options.journal, this.node);
      this.rejournalLoop();
    }
  }

  async abort() {
    await this.aborter.abort();
  }

  private local(): Map<Buffer, Transaction[]> {
    let txs = createBufferFunctionalMap<Transaction[]>();
    for (const addrBuf of this.locals) {
      let account = this.accounts.get(addrBuf);
      if (account?.hasPending()) {
        let transactions = txs.get(addrBuf);
        if (transactions) {
          const listtxs = account.pending.toList();
          for (const tx of listtxs) {
            transactions.push(tx);
          }
        } else {
          txs.set(addrBuf, account.pending.toList());
        }
      }
      if (account?.hasQueue()) {
        let transactions = txs.get(addrBuf);
        if (transactions) {
          const listtxs = account.queue.toList();
          for (const tx of listtxs) {
            transactions.push(tx);
          }
        } else {
          txs.set(addrBuf, account.queue.toList());
        }
      }
    }
    return txs;
  }

  private async timeoutLoop() {
    await this.initPromise;
    while (!this.aborter.isAborted) {
      await this.aborter.abortablePromise(new Promise((r) => setTimeout(r, this.timeoutInterval)));
      if (this.aborter.isAborted) {
        break;
      }
      for (const [addr, account] of this.accounts) {
        if (account.hasQueue() && Date.now() - account.timestamp > this.lifetime) {
          const queue = account.queue.clear();
          this.removeTxFromGlobal(queue);
        }
      }
    }
  }

  private async rejournalLoop() {
    await this.initPromise;
    while (!this.aborter.isAborted) {
      await this.aborter.abortablePromise(new Promise((r) => setTimeout(r, this.rejournalInterval)));
      if (this.aborter.isAborted) {
        break;
      }
      await this.journal!.rotate(this.local());
    }
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    this.currentHeader = this.node.blockchain.latestBlock.header;
    this.currentStateManager = await this.node.getStateManager(this.currentHeader.stateRoot);
    if (this.journal) {
      await this.journal.load(async (txs: Transaction[]) => {
        let news: Transaction[] = [];
        for (const tx of txs) {
          if (this.txs.has(tx.hash())) {
            continue;
          }
          if (!tx.isSigned()) {
            continue;
          }
          news.push(tx);
        }
        if (news.length == 0) {
          return;
        }
        await this.node.addPendingTxs(news);
      });
    }
  }

  private getAccount(addr: Address): TxPoolAccount {
    const sender = addr.buf;
    let account = this.accounts.get(sender);
    if (!account) {
      account = new TxPoolAccount(async () => {
        return (await this.currentStateManager.getAccount(addr)).nonce;
      });
      this.accounts.set(sender, account);
    }
    return account;
  }

  async newBlock(newBlock: Block) {
    await this.initPromise;
    try {
      const getBlock = async (hash: Buffer, number: BN) => {
        const header = await this.node.db.getHeader(hash, number);
        let bodyBuffer: BlockBodyBuffer | undefined;
        try {
          bodyBuffer = await this.node.db.getBody(hash, number);
        } catch (err) {
          if (err.type !== 'NotFoundError') {
            throw err;
          }
        }

        return Block.fromBlockData(
          {
            header: header,
            transactions: bodyBuffer ? bodyBuffer[0].map((rawTx) => Transaction.fromValuesArray(rawTx, { common: this.node.common })) : []
          },
          { common: this.node.common }
        );
      };

      const originalNewBlock = newBlock;
      let oldBlock = await getBlock(this.currentHeader.hash(), this.currentHeader.number);
      let discarded: Transaction[] = [];
      const included = createBufferFunctionalSet();
      while (oldBlock.header.number.gt(newBlock.header.number)) {
        discarded = discarded.concat(oldBlock.transactions);
        oldBlock = await getBlock(oldBlock.header.parentHash, oldBlock.header.number.subn(1));
      }
      while (newBlock.header.number.gt(oldBlock.header.number)) {
        for (const tx of newBlock.transactions) {
          included.add(tx.hash());
        }
        newBlock = await getBlock(newBlock.header.parentHash, newBlock.header.number.subn(1));
      }
      while (!oldBlock.hash().equals(newBlock.hash())) {
        discarded = discarded.concat(oldBlock.transactions);
        oldBlock = await getBlock(oldBlock.header.parentHash, oldBlock.header.number.subn(1));
        for (const tx of newBlock.transactions) {
          included.add(tx.hash());
        }
        newBlock = await getBlock(newBlock.header.parentHash, newBlock.header.number.subn(1));
      }
      const reinject: Transaction[] = [];
      for (const tx of discarded) {
        if (!included.has(tx.hash())) {
          reinject.push(tx);
        }
      }
      this.currentHeader = originalNewBlock.header;
      this.currentStateManager = await this.node.getStateManager(this.currentHeader.stateRoot);
      await this._addTxs(reinject, true);
      await this.demoteUnexecutables();
      this.truncatePending();
      this.truncateQueue();
    } catch (err) {
      logger.error('TxPool::newBlockLoop, catch error:', err);
    }
  }

  async addTxs(txs: Transaction | Transaction[]) {
    await this.initPromise;
    txs = txs instanceof Transaction ? [txs] : txs;
    try {
      const result = await this._addTxs(txs, false);
      this.truncatePending();
      this.truncateQueue();
      return result;
    } catch (err) {
      logger.error('TxPool::addTxsLoop, catch error:', err);
      return { results: new Array<boolean>(txs.length).fill(false) };
    }
  }

  getPendingMap() {
    const pendingMap = new PendingTxMap();
    for (const [sender, account] of this.accounts) {
      if (!account.hasPending()) {
        continue;
      }
      pendingMap.push(sender, account.pending.toList());
    }
    return pendingMap;
  }

  getPooledTransactionHashes() {
    let hashes: Buffer[] = [];
    for (const [sender, account] of this.accounts) {
      if (!account.hasPending()) {
        continue;
      }
      hashes = hashes.concat(account.pending.toList().map((tx) => tx.hash()));
    }
    return hashes;
  }

  getTransaction(hash: Buffer) {
    return this.txs.get(hash);
  }

  private async _addTxs(txs: Transaction[], force: boolean): Promise<{ results: boolean[]; readies?: Map<Buffer, Transaction[]> }> {
    const dirtyAddrs: Address[] = [];
    const results: boolean[] = [];
    for (const tx of txs) {
      if (this.txs.has(tx.hash())) {
        results.push(false);
        continue;
      }
      const addr = tx.getSenderAddress();
      if (!(await this.validateTx(tx))) {
        results.push(false);
        continue;
      }
      // drop tx if pool is full
      if (txSlots(tx) + this.txs.size > this.globalSlots + this.globalQueue) {
        if (this.priced.underpriced(tx)) {
          results.push(false);
          continue;
        }
        const [drop, success] = this.priced.discard(this.globalAllSlots - (this.globalSlots + this.globalQueue), true);
        if (!success) {
          results.push(false);
          continue;
        }
        if (drop) {
          for (const tx of drop) {
            this.removeTxFromGlobal(tx);
            const account = this.accounts.get(addr.buf);
            if (account?.hasPending()) {
              account.pending.delete(tx.nonce);
            }
            if (account?.hasQueue()) {
              account.queue.delete(tx.nonce);
            }
          }
        }
      }
      const account = this.getAccount(addr);
      if (account.hasPending() && account.pending.has(tx.nonce)) {
        this.promoteTx(tx);
      } else {
        if (this.enqueueTx(tx)) {
          dirtyAddrs.push(addr);
        }
      }
      this.globalAllSlots += txSlots(tx);
      // journalTx
      if (this.journal) {
        await this.journal.insert(tx);
      }
      results.push(true);
    }
    const flag = results.reduce((a, b) => a || b, false);
    if (flag && !force && dirtyAddrs.length > 0) {
      return { results, readies: await this.promoteExecutables(dirtyAddrs) };
    } else if (force) {
      return { results, readies: await this.promoteExecutables() };
    } else {
      return { results };
    }
  }

  private removeTxFromGlobal(key: Transaction | Transaction[]) {
    if (Array.isArray(key)) {
      for (const tx of key) {
        this.txs.delete(tx.hash());
      }
    } else {
      this.txs.delete(key.hash());
    }
  }

  private async validateTx(tx: Transaction): Promise<boolean> {
    // TODO: report error.
    try {
      const txSize = new WrappedTransaction(tx).size;
      if (txSize > this.txMaxSize) {
        logger.warn('Txpool drop tx', bufferToHex(tx.hash()), 'size too large:', txSize, 'max:', this.txMaxSize);
        return false;
      }
      if (!tx.isSigned()) {
        logger.warn('Txpool drop tx', bufferToHex(tx.hash()), 'is not signed');
        return false;
      }
      if (this.node.miner.gasLimit.lt(tx.gasLimit)) {
        logger.warn('Txpool drop tx', bufferToHex(tx.hash()), 'reach block gasLimit:', tx.gasLimit.toString(), 'limit:', this.node.miner.gasLimit.toString());
        return false;
      }
      const senderAddr = tx.getSenderAddress();
      const sender = senderAddr.buf;
      if (!this.locals.has(sender) && tx.gasPrice.lt(this.priceLimit)) {
        logger.warn('Txpool drop tx', bufferToHex(tx.hash()), 'gasPrice too low:', tx.gasPrice.toString(), 'limit:', this.priceLimit.toString());
        return false;
      }
      const accountInDB = await this.currentStateManager.getAccount(senderAddr);
      if (accountInDB.nonce.gt(tx.nonce)) {
        logger.warn('Txpool drop tx', bufferToHex(tx.hash()), 'nonce too low:', tx.nonce.toString(), 'account:', accountInDB.nonce.toString());
        return false;
      }
      if (accountInDB.balance.lt(txCost(tx))) {
        logger.warn('Txpool drop tx', bufferToHex(tx.hash()), 'balance not enough:', txCost(tx).toString(), 'account:', accountInDB.balance.toString());
        return false;
      }
      if (!checkTxIntrinsicGas(tx)) {
        logger.warn('Txpool drop tx', bufferToHex(tx.hash()), 'checkTxIntrinsicGas failed');
        return false;
      }
      return true;
    } catch (err) {
      logger.warn('Txpool drop tx', bufferToHex(tx.hash()), 'validateTx failed:', err);
      return false;
    }
  }

  private enqueueTx(tx: Transaction): boolean {
    const account = this.getAccount(tx.getSenderAddress());
    const { inserted, old } = account.queue.push(tx, this.priceBump);
    if (inserted) {
      this.txs.set(tx.hash(), tx);
    }
    if (old) {
      this.removeTxFromGlobal(old);
    }
    account.timestamp = Date.now();
    return inserted;
  }

  private promoteTx(tx: Transaction): boolean {
    const account = this.getAccount(tx.getSenderAddress());
    const { inserted, old } = account.pending.push(tx, this.priceBump);
    if (inserted) {
      this.txs.set(tx.hash(), tx);
    }
    if (old) {
      this.removeTxFromGlobal(old);
    }
    account.updatePendingNonce(tx.nonce.addn(1));
    account.timestamp = Date.now();
    return inserted;
  }

  private async promoteExecutables(dirtyAddrs?: Address[]): Promise<Map<Buffer, Transaction[]>> {
    const promoteAccount = async (sender: Buffer, account: TxPoolAccount): Promise<Transaction[]> => {
      let readies: Transaction[] = [];
      if (!account.hasQueue()) {
        return readies;
      }
      const queue = account.queue;
      const accountInDB = await this.currentStateManager.getAccount(new Address(sender));
      const forwards = queue.forward(accountInDB.nonce);
      this.removeTxFromGlobal(forwards);
      const { removed: drops } = queue.filter(accountInDB.balance, this.currentHeader.gasLimit);
      this.removeTxFromGlobal(drops);
      const totalReadies = queue.ready(await account.getPendingNonce());
      for (const tx of totalReadies) {
        if (this.promoteTx(tx)) {
          readies.push(tx);
        }
      }
      let resizesNumber = 0;
      if (!this.locals.has(sender)) {
        const resizes = queue.resize(this.accountQueue);
        resizesNumber = resizes.length;
        this.removeTxFromGlobal(resizes);
      }
      // resize priced
      this.priced.removed(forwards.length + drops.length + resizesNumber);
      if (!account.hasQueue() && !account.hasPending()) {
        this.accounts.delete(sender);
      }
      return readies;
    };

    const txs = createBufferFunctionalMap<Transaction[]>();
    if (dirtyAddrs) {
      for (const addr of dirtyAddrs) {
        const account = this.getAccount(addr);
        const readies = await promoteAccount(addr.buf, account);
        if (readies.length > 0) {
          txs.set(addr.buf, readies);
        }
      }
    } else {
      for (const [sender, account] of this.accounts) {
        const readies = await promoteAccount(sender, account);
        if (readies.length > 0) {
          txs.set(sender, readies);
        }
      }
    }
    return txs;
  }

  private async demoteUnexecutables() {
    for (const [sender, account] of this.accounts) {
      if (!account.hasPending()) {
        continue;
      }
      const pending = account.pending;
      const accountInDB = await this.currentStateManager.getAccount(new Address(sender));
      const forwards = pending.forward(accountInDB.nonce);
      this.removeTxFromGlobal(forwards);
      const { removed: drops, invalids } = pending.filter(accountInDB.balance, this.currentHeader.gasLimit);
      this.removeTxFromGlobal(drops);
      // resize priced
      this.priced.removed(forwards.length + drops.length);
      for (const tx of invalids) {
        this.enqueueTx(tx);
      }
      if (!pending.has(accountInDB.nonce) && pending.size > 0) {
        const resizes = pending.resize(0);
        for (const tx of resizes) {
          this.enqueueTx(tx);
        }
      }
      if (!account.hasPending() && !account.hasQueue()) {
        this.accounts.delete(sender);
      }
    }
  }

  private truncatePending() {
    let pendingSlots = 0;
    for (const [sender, account] of this.accounts) {
      if (account.hasPending()) {
        pendingSlots += account.pending.slots;
      }
    }
    if (pendingSlots <= this.globalSlots) {
      return;
    }

    const heap = new Heap({ comparBefore: (a: TxPoolAccount, b: TxPoolAccount) => a.pending.slots > b.pending.slots });
    for (const [sender, account] of this.accounts) {
      if (account.hasPending() && account.pending.slots > this.accountSlots) {
        heap.push(account);
      }
    }

    const removeSingleTx = (account: TxPoolAccount) => {
      const pending = account.pending;
      const [tx] = pending.resize(pending.size - 1);
      this.removeTxFromGlobal(tx);
      account.updatePendingNonce(tx.nonce, true);
      // resize priced
      this.priced.removed([tx].length);
      pendingSlots -= txSlots(tx);
    };

    const offenders: TxPoolAccount[] = [];
    while (pendingSlots > this.globalSlots && heap.length > 0) {
      const offender: TxPoolAccount = heap.remove();
      offenders.push(offender);
      if (offenders.length > 1) {
        const threshold = offender.pending.slots;
        while (pendingSlots > this.globalSlots && offenders[offenders.length - 2].pending.slots > threshold) {
          for (let i = 0; i < offenders.length - 1; i++) {
            removeSingleTx(offenders[i]);
          }
        }
      }
    }

    if (pendingSlots > this.globalSlots && offenders.length > 0) {
      while (pendingSlots > this.globalSlots && offenders[offenders.length - 1].pending.slots > this.accountSlots) {
        for (const offender of offenders) {
          removeSingleTx(offender);
        }
      }
    }
  }

  private truncateQueue() {
    let queueSlots = 0;
    for (const [sender, account] of this.accounts) {
      if (account.hasQueue()) {
        queueSlots += account.queue.slots;
      }
    }
    if (queueSlots <= this.globalQueue) {
      return;
    }

    const heap = new Heap({ comparBefore: (a: TxPoolAccount, b: TxPoolAccount) => a.timestamp < b.timestamp });
    for (const [sender, account] of this.accounts) {
      if (!this.locals.has(sender) && account.hasQueue()) {
        heap.push(account);
      }
    }

    let account: TxPoolAccount = heap.remove();
    while (queueSlots > this.globalQueue && account) {
      const queue = account.queue;
      if (queueSlots - queue.slots >= this.globalQueue) {
        queueSlots -= queue.slots;
        // resize priced
        const resizes = queue.clear();
        this.removeTxFromGlobal(resizes);
        this.priced.removed(resizes.length);
      } else {
        while (queueSlots > this.globalQueue) {
          const [tx] = queue.resize(queue.size - 1);
          this.removeTxFromGlobal(tx);
          // resize priced
          this.priced.removed(1);
          queueSlots -= txSlots(tx);
        }
        break;
      }
      account = heap.remove();
    }
  }

  async ls() {
    const info = (map: TxSortedMap, description: string) => {
      logger.info(`${description} size:`, map.size, '| slots:', map.slots);
      map.ls();
    };
    for (const [sender, account] of this.accounts) {
      logger.info('==========');
      logger.info('address: 0x' + sender.toString('hex'), '| timestamp:', account.timestamp, '| pendingNonce:', (await account.getPendingNonce()).toString());
      if (account.hasPending()) {
        info(account.pending, 'pending');
      }
      if (account.hasQueue()) {
        info(account.queue, 'queue');
      }
    }
  }
}

export { PendingTxMap, TxSortedMap };

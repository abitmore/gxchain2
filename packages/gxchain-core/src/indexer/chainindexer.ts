import { BlockHeader } from '@gxchain2/block';
import { BN } from 'ethereumjs-util';
import { LevelUp } from 'levelup';
import { AsyncChannel, logger } from '@gxchain2/utils';
import { Node } from '../node';

export interface ChainIndexerBackend {
  reset(section: BN): void;

  process(header: BlockHeader): void;

  commit(): Promise<void>;

  prune(section: BN): Promise<void>;

  reversePrune(section: BN): Promise<void>;
}

export interface ChainIndexerOptions {
  node: Node;
  sectionSize: number;
  confirmsBlockNumber: number;
  backend: ChainIndexerBackend;
}

async function getStoredSectionCount(rawdb: LevelUp) {
  return new BN(await rawdb.get('scount'));
}

async function setStoredSectionCount(rawdb: LevelUp, section: BN) {
  await rawdb.put('scount', section.toString());
}

export class ChainIndexer {
  private readonly sectionSize: number;
  private readonly confirmsBlockNumber: number;
  private readonly backend: ChainIndexerBackend;
  private readonly node: Node;
  private readonly initPromise: Promise<void>;
  // TODO: get a aborter from node.
  private readonly headerQueue = new AsyncChannel<BlockHeader>({ max: 1, isAbort: () => false });

  private storedSections!: BN;

  constructor(options: ChainIndexerOptions) {
    this.sectionSize = options.sectionSize;
    this.confirmsBlockNumber = options.confirmsBlockNumber;
    this.backend = options.backend;
    this.node = options.node;
    this.initPromise = this.init();
  }

  async init() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    this.storedSections = await getStoredSectionCount(this.node.rawdb);
    this.processHeaderLoop();
  }

  async newBlockHeader(header: BlockHeader) {
    await this.initPromise;
    this.headerQueue.push(header);
  }

  private async processHeaderLoop() {
    await this.initPromise;
    let preHeader: BlockHeader | undefined;
    for await (const header of this.headerQueue.generator()) {
      try {
        if (preHeader !== undefined && !header.parentHash.equals(preHeader.hash())) {
          const ancestor = await this.node.db.findCommonAncestor(header, preHeader);
          await this.newHeader(ancestor.number, true);
        }
        await this.newHeader(header.number, false);
        preHeader = header;
      } catch (err) {
        logger.error('ChainIndexer::processHeaderLoop, catch error:', err);
      }
    }
  }

  private async newHeader(number: BN, reorg: boolean) {
    if (reorg) {
      const sections = number.divn(this.sectionSize);
      if (!sections.eq(this.storedSections)) {
        await this.backend.reversePrune(sections);
        this.storedSections = sections.clone();
        await setStoredSectionCount(this.node.rawdb, this.storedSections);
      }
      return;
    }
    const confirmedSections = number.gtn(this.confirmsBlockNumber) ? number.subn(this.confirmsBlockNumber).divn(this.sectionSize) : new BN(0);
    while (confirmedSections.gt(this.storedSections)) {
      // store new sections.
      const currentSections = this.storedSections;
      this.backend.reset(currentSections);
      let lastHeader = currentSections.gtn(0) ? await this.node.db.getCanonicalHeader(currentSections.muln(this.sectionSize).subn(1)) : undefined;
      // the first header number of the next section.
      const maxNum = currentSections.addn(1).muln(this.sectionSize);
      for (const num = currentSections.muln(this.sectionSize); num.lt(maxNum); num.iaddn(1)) {
        const header = await this.node.db.getCanonicalHeader(num);
        if (lastHeader !== undefined && !header.parentHash.equals(lastHeader.hash())) {
          throw new Error(`parentHash is'not match, last: ${lastHeader.number.toString()}, current: ${header.number.toString()}`);
        }
        await this.backend.process(header);
        lastHeader = header;
      }
      await this.backend.commit();
      this.storedSections.iaddn(1);
      // save stored section count.
      await setStoredSectionCount(this.node.rawdb, this.storedSections);
    }
  }
}

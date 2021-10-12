import { Address, bufferToHex, BN, KECCAK256_RLP_ARRAY } from 'ethereumjs-util';
import { Block, BlockHeader, HeaderData, preHF1CalcCliqueDifficulty, CLIQUE_DIFF_NOTURN } from '@gxchain2/structure';
import { logger, nowTimestamp, getRandomIntInclusive } from '@gxchain2/utils';
import { ConsensusEngine } from '../consensusEngine';
import { EMPTY_ADDRESS } from '../utils';
import { ConsensusEngineBase } from '../consensusEngineBase';

const NoTurnSignerDelay = 500;

export class CliqueConsensusEngine extends ConsensusEngineBase implements ConsensusEngine {
  private nextTd?: BN;
  private timeout?: NodeJS.Timeout;

  /////////////////////////////////

  /**
   * {@link ConsensusEngine.BlockHeader_miner}
   */
  BlockHeader_miner(header: BlockHeader): Address {
    return header.cliqueSigner();
  }

  /**
   * {@link ConsensusEngine.Block_miner}
   */
  Block_miner(block: Block) {
    return block.header.cliqueSigner();
  }

  /**
   * {@link ConsensusEngine.getEmptyPendingBlockHeader}
   */
  getPendingBlockHeader({ parentHash, number, timestamp }: HeaderData) {
    if (number === undefined || !(number instanceof BN)) {
      throw new Error('invalid header data');
    }

    let difficulty: BN;
    const activeSigners = this.node.blockchain.cliqueActiveSignersByBlockNumber(number);
    if (this.isValidSigner(activeSigners)) {
      difficulty = preHF1CalcCliqueDifficulty(activeSigners, this.coinbase, number)[1];
    } else {
      difficulty = CLIQUE_DIFF_NOTURN.clone();
    }

    const common = this.node.getCommon(number);
    return BlockHeader.fromHeaderData(
      {
        parentHash,
        uncleHash: KECCAK256_RLP_ARRAY,
        coinbase: EMPTY_ADDRESS,
        number,
        timestamp,
        difficulty,
        gasLimit: this.getGasLimitByCommon(common)
      },
      { common, cliqueSigner: this.cliqueSigner() }
    );
  }

  /////////////////////////////////

  protected _start() {}

  protected _abort() {
    return Promise.resolve();
  }

  /**
   * Process a new block header, try to mint a block after this block
   * @param header - New block header
   */
  protected async _newBlockHeader(header: BlockHeader) {
    if (!this.enable || this.node.sync.isSyncing) {
      return;
    }

    const parentHash = header.hash();
    const parentTD = await this.node.db.getTotalDifficulty(parentHash, header.number);
    // return if cancel failed
    if (!this.cancel(parentTD)) {
      return;
    }

    // check valid signer and recently sign
    const activeSigners = this.node.blockchain.cliqueActiveSignersByBlockNumber(header.number);
    const recentlyCheck = this.node.blockchain.cliqueCheckNextRecentlySigned(header, this.coinbase);
    if (!this.isValidSigner(activeSigners) || recentlyCheck) {
      return;
    }

    // create a new pending block through worker
    await this.worker.newBlockHeader(header);
    let pendingBlock = this.worker.directlyGetPendingBlockByParentHash(parentHash);
    if (!pendingBlock) {
      throw new Error('missing pending block');
    }
    if (!this.enable || this.node.sync.isSyncing) {
      return;
    }

    if (this.timeout === undefined && this.nextTd === undefined) {
      // calculate timeout duration for next block
      const duration = this.calcTimeout(pendingBlock.header.timestamp.toNumber(), !pendingBlock.header.difficulty.eq(CLIQUE_DIFF_NOTURN), activeSigners.length);
      this.nextTd = parentTD.add(pendingBlock.header.difficulty);
      this.timeout = setTimeout(async () => {
        this.nextTd = undefined;
        this.timeout = undefined;

        try {
          // get pending block by parent block hash again,
          // because the newest pending block may contain the newest transaction
          pendingBlock = await this.worker.getPendingBlockByParentHash(parentHash);

          const { reorged, block } = await this.node.processBlock(pendingBlock, {
            generate: true,
            broadcast: true
          });
          if (reorged) {
            logger.info('⛏️  Mine block, height:', block.header.number.toString(), 'hash:', bufferToHex(block.hash()));
            // try to continue minting
            if (this.enable && !this.node.sync.isSyncing) {
              this.newBlockHeader(this.node.blockchain.latestBlock.header);
            }
          }
        } catch (err) {
          logger.error('CliqueConsensusEngine::newBlockHeader, processBlock, catch error:', err);
        }
      }, duration);
    }
  }

  // cancel the timer if the total difficulty is greater than `this.nextTD`
  private cancel(nextTd: BN) {
    if (!this.nextTd) {
      return true;
    }
    if (this.nextTd.lte(nextTd)) {
      this.nextTd = undefined;
      if (this.timeout) {
        clearTimeout(this.timeout);
        this.timeout = undefined;
      }
      return true;
    }
    return false;
  }

  // calculate sleep duration
  private calcTimeout(nextBlockTimestamp: number, inTurn: boolean, activeSignerCount: number) {
    const now = nowTimestamp();
    let timeout = now > nextBlockTimestamp ? 0 : nextBlockTimestamp - now;
    timeout *= 1000;
    if (!inTurn) {
      timeout += getRandomIntInclusive(1, activeSignerCount + 1) * NoTurnSignerDelay;
    }
    return timeout;
  }

  // check if the local signer is included in `activeSigners`
  private isValidSigner(activeSigners: Address[]) {
    return activeSigners.filter((s) => s.equals(this.coinbase)).length > 0;
  }

  // try to get clique signer's private key,
  // return undefined if it is disable
  private cliqueSigner() {
    return this.enable ? this.node.accMngr.getPrivateKey(this.coinbase) : undefined;
  }
}

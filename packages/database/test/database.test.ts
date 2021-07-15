import fs from 'fs';
import path from 'path';
import { expect, assert } from 'chai';
import { LevelUp } from 'levelup';
import { generateAddress } from 'ethereumjs-util';
import { hexStringToBN, hexStringToBuffer } from '@gxchain2/utils';
import { Common } from '@gxchain2/common';
import { Block, Receipt, Log } from '@gxchain2/structure';
import { Database, createEncodingLevelDB, DBSaveTxLookup, DBSetBlockOrHeader, DBSetHashToNumber, DBSaveLookups, DBSetTD, DBSaveReceipts } from '../src';

describe('Database', () => {
  let database: Database;
  let testdb: LevelUp;
  let testdir: string;
  let testblock: Block;
  let testreceipts: Receipt[];

  before(async () => {
    testdir = path.join(__dirname, '/test-dir');
    if (!fs.existsSync(testdir)) {
      fs.mkdirSync(testdir, { recursive: true });
    }
    testdb = createEncodingLevelDB(testdir);
    const common = Common.createChainStartCommon('gxc2-testnet');
    database = new Database(testdb, common);

    const testdata = JSON.parse(fs.readFileSync(path.join(__dirname, '/test-data.json')).toString());
    testblock = Block.fromBlockData(testdata, { common, hardforkByBlockNumber: true });
    testreceipts = (testdata.receipts as { cumulativeGasUsed: string; bitvector: string; logs: any[]; status: string }[]).map((r) => {
      const logs = (r.logs as { address: string; data: string; topics: string[] }[]).map((l) => {
        return new Log(
          hexStringToBuffer(l.address),
          l.topics.map((t) => hexStringToBuffer(t)),
          hexStringToBuffer(l.data)
        );
      });
      return new Receipt(hexStringToBuffer(r.cumulativeGasUsed), hexStringToBuffer(r.bitvector), logs, hexStringToBN(r.status).toNumber() as 0 | 1);
    });
    let ops = DBSetBlockOrHeader(testblock);
    ops = ops.concat(DBSetTD(testblock.header.difficulty, testblock.header.number, testblock.hash()));
    ops = ops.concat(DBSetHashToNumber(testblock.hash(), testblock.header.number));
    ops = ops.concat(DBSaveLookups(testblock.hash(), testblock.header.number));
    ops = ops.concat(DBSaveTxLookup(testblock));
    ops = ops.concat(DBSaveReceipts(testreceipts, testblock.hash(), testblock.header.number));
    await database.batch(ops);
  });

  it('should get total difficulty', async () => {
    expect((await database.getTotalDifficulty(testblock.hash(), testblock.header.number)).toNumber(), 'td should be equal').be.equal(testblock.header.difficulty.toNumber());
  });

  it('should get transactions', async () => {
    const txs = await Promise.all(testblock.transactions.map((tx) => database.getTransaction(tx.hash())));
    txs.forEach((tx, i) => {
      expect(tx.hash().equals(testblock.transactions[i].hash()), 'tx hash should be equal').be.true;
    });
    expect(txs.length, 'txs length should be equal').to.equal(testblock.transactions.length);
  });

  it('should get receipts', async () => {
    const rs = await Promise.all(testblock.transactions.map((tx) => database.getReceipt(tx.hash())));
    rs.forEach((r, i) => {
      const receipt = testreceipts[i];
      const transaction = testblock.transactions[i];
      expect(r.transactionHash!.equals(transaction.hash()), 'receipt tx hash should be equal').be.true;
      if (!transaction.to) {
        expect(r.contractAddress!.equals(generateAddress(transaction.getSenderAddress().buf, transaction.nonce.toArrayLike(Buffer))), 'receipt contractAddress should be equal').be.true;
      }
      expect(r.cumulativeGasUsed.equals(receipt.cumulativeGasUsed), 'receipt cumulativeGasUsed should be equal').be.true;
      expect(r.bitvector.equals(receipt.bitvector), 'receipt bitvector should be equal').be.true;
      expect(r.status, 'receipt status should be equal').be.equal(receipt.status);
      r.logs.forEach((l, i) => {
        const log = receipt.logs[i];
        expect(l.address.equals(log.address), 'log address should be equal');
        expect(l.data.equals(log.data), 'log data should be equal');
        l.topics.forEach((t, i) => {
          expect(t.equals(log.topics[i]), 'log topics should be equal').be.true;
        });
        expect(l.topics.length, 'log topics length should be equal').be.equal(log.topics.length);
      });
      expect(r.logs.length, 'log length should be equal').be.equal(receipt.logs.length);
    });
    expect(rs.length, 'receipt length should be equal').be.equal(testreceipts.length);
  });

  after(async () => {
    await testdb.close();
    fs.rmdirSync(testdir, { recursive: true });
  });
});

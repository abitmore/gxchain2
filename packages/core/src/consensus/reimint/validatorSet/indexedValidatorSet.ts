import Heap from 'qheap';
import { Address, BN } from 'ethereumjs-util';
import { FunctionalAddressMap, FunctionalAddressSet } from '@rei-network/utils';
import { Common } from '@rei-network/common';
import { StakeManager, ValidatorBls } from '../contracts';
import { ValidatorChanges } from './validatorChanges';
import { isGenesis, getGenesisValidators, genesisValidatorVotingPower } from './genesis';

// validator information
export type IndexedValidator = {
  // validator address
  validator: Address;
  // voting power
  votingPower: BN;
  // validator bls public key
  blsPublicKey?: Buffer;
};

// copy a `IndexedValidator`
function copyIndexedValidator(info: IndexedValidator) {
  return {
    ...info,
    votingPower: info.votingPower.clone()
  };
}

export class IndexedValidatorSet {
  // indexed validator set
  readonly indexed: Map<Address, IndexedValidator>;

  /**
   * Load indexed validator set from state trie
   * @param sm - Stake manager instance
   * @returns IndexedValidatorSet instance
   */
  static async fromStakeManager(sm: StakeManager, bls?: ValidatorBls) {
    const indexed = new FunctionalAddressMap<IndexedValidator>();
    const length = await sm.indexedValidatorsLength();
    for (const i = new BN(0); i.lt(length); i.iaddn(1)) {
      const validator = await sm.indexedValidatorsByIndex(i);
      // exclude genesis validators
      if (isGenesis(validator, sm.common)) {
        continue;
      }

      const votingPower = await sm.getVotingPowerByIndex(i);
      if (votingPower.gtn(0)) {
        const indexValidator: IndexedValidator = { validator, votingPower };
        if (bls) {
          indexValidator.blsPublicKey = await bls.getBlsPublicKey(validator);
        }
        indexed.set(validator, indexValidator);
      }
    }

    return new IndexedValidatorSet(indexed);
  }

  /**
   * Create a genesis validator set
   * @param common - Common instance
   * @returns IndexedValidatorSet instance
   */
  static genesis(common: Common) {
    const indexed = new FunctionalAddressMap<IndexedValidator>();
    for (const gv of getGenesisValidators(common)) {
      indexed.set(gv, {
        validator: gv,
        votingPower: genesisValidatorVotingPower.clone()
      });
    }
    return new IndexedValidatorSet(indexed);
  }

  constructor(indexed: Map<Address, IndexedValidator>) {
    this.indexed = indexed;
  }

  /**
   * Get indexed validator length
   */
  get length() {
    return this.indexed.size;
  }

  // get validator object by address(create if it does not exist)
  private getValidator(validator: Address) {
    let v = this.indexed.get(validator);
    if (!v) {
      v = {
        validator: validator,
        votingPower: new BN(0)
      };
      this.indexed.set(validator, v);
    }
    return v;
  }

  /**
   * Get validator voting power by address
   * @param validator - Address
   * @returns Voting power
   */
  getVotingPower(validator: Address) {
    const vp = this.indexed.get(validator)?.votingPower.clone();
    if (!vp) {
      throw new Error('unknown validator, ' + validator.toString());
    }
    return vp;
  }

  /**
   * Check whether validator is indexed
   * @param validator - Validator address
   * @returns `true` if it is indexed
   */
  contains(validator: Address) {
    return this.indexed.has(validator);
  }

  /**
   * Merge validator set changes
   * @param changes - `ValidatorChanges` instance
   */
  async merge(changes: ValidatorChanges, bls?: ValidatorBls) {
    // TODO: if the changed validator is an active validator, the active list maybe not be dirty
    let dirty = false;

    for (const uv of changes.unindexedValidators) {
      this.indexed.delete(uv);
    }

    const newValidators = new FunctionalAddressSet();
    for (const vc of changes.changes.values()) {
      let v: IndexedValidator | undefined;
      if (vc.votingPower) {
        dirty = true;
        v = this.getValidator(vc.validator);
        v.votingPower = vc.votingPower;
        newValidators.add(vc.validator);
      }

      if (!vc.update.eqn(0) && this.indexed.get(vc.validator)) {
        dirty = true;
        v = v ?? this.getValidator(vc.validator);
        v.votingPower.iadd(vc.update);
        if (v.votingPower.isZero()) {
          this.indexed.delete(vc.validator);
          changes.blsValidators.delete(vc.validator);
          newValidators.delete(vc.validator);
        }
      }
    }

    for (const addr of newValidators) {
      if (changes.blsValidators.has(addr)! && bls) {
        const blsPublicKey = await bls.getBlsPublicKey(addr);
        changes.blsValidators.set(addr, blsPublicKey);
      }
    }

    changes.blsValidators.forEach((blsPublicKey, validator) => {
      if (this.contains(validator)) this.getValidator(validator).blsPublicKey = blsPublicKey;
    });

    return dirty;
  }

  /**
   * Copy a new indexed validator set
   * @returns New indexed validator set
   */
  copy() {
    const indexed = new FunctionalAddressMap<IndexedValidator>();
    for (const [addr, validator] of this.indexed) {
      indexed.set(addr, copyIndexedValidator(validator));
    }
    return new IndexedValidatorSet(indexed);
  }

  /**
   * Sort for a active validator list
   * @param maxCount - Max active validator count
   * @returns - Active validator list
   */
  sort(maxCount: number) {
    // create a heap to keep the maximum count validator
    const heap = new Heap({
      compar: (a: IndexedValidator, b: IndexedValidator) => {
        let num = a.votingPower.cmp(b.votingPower);
        if (num === 0) {
          num = a.validator.buf.compare(b.validator.buf) as 1 | -1 | 0;
          num *= -1;
        }
        return num;
      }
    });

    for (const v of Array.from(this.indexed.values()).filter((v) => v.blsPublicKey !== undefined)) {
      heap.push(v);
      // if the heap length is too large, remove the minimum one
      while (heap.length > maxCount) {
        heap.remove();
      }
    }

    // sort validators
    const activeValidators: IndexedValidator[] = [];
    while (heap.length > 0) {
      const v = heap.remove() as IndexedValidator;
      activeValidators.push(v);
    }

    // sort active validators
    activeValidators.sort((a, b) => {
      let num = a.votingPower.cmp(b.votingPower);
      num *= -1;
      if (num === 0) {
        num = a.validator.buf.compare(b.validator.buf) as 1 | -1 | 0;
      }
      return num;
    });

    return activeValidators;
  }
}

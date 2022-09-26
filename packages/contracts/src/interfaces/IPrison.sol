// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

struct Miner {
    // validator jail status
    bool jailed;
    // validator address
    address miner;
    // validator total miss round number
    uint256 missedRoundNumberPeriod;
    // validator latest unjailed block number
    uint256 unjailedBlockNumber;
}

struct MissRecord {
    // miss miner address
    address miner;
    // miss round number per block
    uint256 missedRoundNumberThisBlock;
}

interface IPrison {
    function jailedMiners(uint256 index) external view returns (address);

    function lowestRecordBlockNumber() external view returns (uint256);

    function miners(address miner)
        external
        view
        returns (
            bool,
            address,
            uint256,
            uint256
        );

    function missRecords(uint256 index1, uint256 index2) external view returns (address, uint256);

    function addMissRecord(MissRecord[] calldata record) external returns (address[] memory);

    function unjail() external payable;

    function getMissRecordsLengthByBlcokNumber(uint256 blockNumber) external view returns (uint256);
}

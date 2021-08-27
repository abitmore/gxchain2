// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

import "./interfaces/IConfig.sol";

// TODO: DAO logic
contract Config is IConfig {
    function stakeManager() external view override returns (address) {
        return 0x0000000000000000000000000000000000001001;
    }

    function systemCaller() external view override returns (address) {
        return 0x0000000000000000000000000000000000001002;
    }

    function unstakeManager() external view override returns (address) {
        return 0x0000000000000000000000000000000000001003;
    }

    function validatorRewardManager() external view override returns (address) {
        return 0x0000000000000000000000000000000000001004;
    }

    function unstakeDelay() external view override returns (uint256) {
        return 1 minutes;
    }

    function minIndexVotingPower() external view override returns (uint256) {
        // 2 GXC
        return 2e18;
    }

    function getFactorByReason(uint8 reason) external view override returns (uint8) {
        if (reason == 0) {
            return 40;
        } else {
            revert("Config: invalid reason");
        }
    }

    function setCommissionRateInterval() external view override returns (uint256) {
        return 1 minutes;
    }
}

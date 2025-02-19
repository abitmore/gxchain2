// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.6.0;

library Util {
    function divCeil(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b > 0, "Util: division by zero");
        return a % b == 0 ? a / b : a / b + 1;
    }

    // check if the address is a contract
    function isContract(address addr) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(addr)
        }
        return size > 0;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IEscrowTest {
    function deposit(bytes32, uint256) external payable;
    function claim() external;
    function withdraw(uint256) external;
}

/// @dev Test-only adversarial receiver, never a deployment dependency.
contract ReentrantReceiver {
    IEscrowTest public target;
    bool public attempted;
    bool public blocked;
    constructor(address escrow) { target = IEscrowTest(escrow); }
    function fund() external payable {
        target.deposit{value:msg.value}(bytes32(uint256(123)), 60);
    }
    function tryWithdraw() external {
        attempted = false;
        blocked = false;
        target.withdraw(1);
    }
    function tryClaim() external {
        attempted = false;
        blocked = false;
        target.claim();
    }
    receive() external payable {
        if (!attempted) {
            attempted = true;
            // This receiver has an unlocked, funded balance, so lack of funds
            // cannot mask a missing guard. Also tests cross-function reentry.
            (bool ok,) = address(target).call(abi.encodeWithSignature("withdraw(uint256)", 1));
            blocked = !ok;
        }
    }
}

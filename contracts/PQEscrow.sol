// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PQEscrow
 * @notice Prefunded escrow with trusted relayers and evidence anchoring.
 * @dev ML-DSA is verified OFF-CHAIN by relayers: practical on-chain verification
 * is prohibitively expensive here. A relayer can authorize arbitrary transfers;
 * evidenceHash is an audit commitment, NOT on-chain proof of a valid signature.
 * Ethereum accounts and transactions themselves are NOT post-quantum.
 * Funds are pooled per buyer; offline agreements reserve no individual balance.
 * This demonstrator has not been audited. Do not deposit real value.
 */
contract PQEscrow {
    struct Account { uint256 balance; uint256 lockedUntil; bytes32 keyHash; }
    struct Settlement {
        address buyer;
        address seller;
        uint256 amount;
        uint256 seq;
        bytes32 buyerKeyHash;
        bool release;
        bytes32 evidenceHash;
        uint256 settledAt;
    }
    mapping(address => Account) public accounts;
    mapping(address => uint256) public claimable;
    mapping(address => mapping(uint256 => bool)) public seqUsed;
    mapping(bytes32 => Settlement) public settlements;
    mapping(bytes32 => bool) public isSettled;
    mapping(address => bool) public relayers;
    address public immutable owner;
    uint256 public immutable minLock;
    bool private entered;

    error Unauthorized();
    error InvalidInput();
    error KeyMismatch();
    error FundsLocked();
    error InsufficientBalance();
    error AlreadySettled();
    error SequenceUsed();
    error ReentrantCall();
    error TransferFailed();
    error NothingToClaim();

    event Deposited(address indexed buyer, uint256 amount, bytes32 keyHash, uint256 lockedUntil);
    event Withdrawn(address indexed buyer, uint256 amount);
    event Claimed(address indexed seller, uint256 amount);
    event RelayerUpdated(address indexed relayer, bool allowed);
    event Settled(bytes32 indexed escrowId, address indexed buyer, address indexed seller,
                  uint256 amount, uint256 seq, bool release, bytes32 evidenceHash);

    constructor(uint256 minimumLock) {
        owner = msg.sender;
        relayers[msg.sender] = true;
        minLock = minimumLock;
    }

    modifier onlyRelayer() {
        if (!relayers[msg.sender]) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (entered) revert ReentrantCall();
        entered = true;
        _;
        entered = false;
    }

    function setRelayer(address relayer, bool allowed) external {
        if (msg.sender != owner) revert Unauthorized();
        if (relayer == address(0)) revert InvalidInput();
        relayers[relayer] = allowed;
        emit RelayerUpdated(relayer, allowed);
    }

    function deposit(bytes32 keyHash, uint256 lockSeconds) external payable {
        if (msg.value == 0 || keyHash == bytes32(0) || lockSeconds < minLock || lockSeconds == 0) revert InvalidInput();
        Account storage a = accounts[msg.sender];
        if (a.keyHash != bytes32(0) && a.keyHash != keyHash) revert KeyMismatch();
        a.keyHash = keyHash;
        a.balance += msg.value;
        uint256 until = block.timestamp + lockSeconds;
        if (until > a.lockedUntil) a.lockedUntil = until;
        emit Deposited(msg.sender, msg.value, keyHash, a.lockedUntil);
    }

    function withdraw(uint256 amount) external nonReentrant {
        Account storage a = accounts[msg.sender];
        if (block.timestamp < a.lockedUntil) revert FundsLocked();
        if (amount == 0) revert InvalidInput();
        if (a.balance < amount) revert InsufficientBalance();
        a.balance -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    function settle(bytes32 escrowId, address buyer, address seller, uint256 amount,
                    uint256 seq, bytes32 buyerKeyHash, bool release, bytes32 evidenceHash) external onlyRelayer {
        if (escrowId == bytes32(0) || evidenceHash == bytes32(0) || amount == 0 || seq == 0 ||
            buyer == address(0) || seller == address(0) || buyer == seller) revert InvalidInput();
        if (isSettled[escrowId]) revert AlreadySettled();
        if (seqUsed[buyer][seq]) revert SequenceUsed();
        Account storage a = accounts[buyer];
        if (a.keyHash == bytes32(0) || a.keyHash != buyerKeyHash) revert KeyMismatch();
        if (release) {
            if (a.balance < amount) revert InsufficientBalance();
            a.balance -= amount;
            claimable[seller] += amount;
        }
        seqUsed[buyer][seq] = true;
        isSettled[escrowId] = true;
        settlements[escrowId] = Settlement(buyer, seller, amount, seq, buyerKeyHash, release, evidenceHash, block.timestamp);
        emit Settled(escrowId, buyer, seller, amount, seq, release, evidenceHash);
    }

    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Claimed(msg.sender, amount);
    }
}

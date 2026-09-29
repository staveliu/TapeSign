// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IContainerToken { function token() external view returns (uint256, address, uint256); }

/// @notice Experimental, non-upgradeable, same-chain 2/2 transfer-only wallet.
/// NFT transfers do not silently replace the recorded notary signer. No modules,
/// delegatecall, approvals, arbitrary execution, delegated keys or recovery admin.
contract TapeNotaryWallet is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public circuit;
    uint256 public circuitTokenId;
    address public container;
    address public transactionSigner;
    address public notarySigner;
    uint256 public nonce;
    uint256 public constant policyVersion = 1;
    bool public active;
    bool public paused;
    bytes32 private constant BIND = keccak256("Bind(address circuit,uint256 circuitTokenId,address container,address transactionSigner,address notarySigner,uint256 nonce,uint256 deadline,uint256 policyVersion)");
    bytes32 private constant TRANSFER = keccak256("Transfer(address asset,address recipient,uint256 amount,uint256 nonce,uint256 deadline,uint256 policyVersion)");
    bytes32 private constant RESUME = keccak256("Resume(uint256 nonce,uint256 deadline,uint256 policyVersion)");
    struct Transfer { address asset; address recipient; uint256 amount; uint256 nonce; uint256 deadline; uint256 policyVersion; }
    error InvalidPolicy();
    error OwnerChanged();
    error InvalidRequest();
    error InvalidSignatures();
    error NotActive();
    error NativeTransferFailed();
    event WalletActivated(address indexed container,address indexed transactionSigner,address indexed notarySigner);
    event TransferExecuted(bytes32 indexed digest,uint256 indexed nonce,address indexed asset,address recipient,uint256 amount);
    event NonceCancelled(uint256 indexed nonce,address indexed by);
    event WalletPaused(address indexed by);
    event WalletResumed(uint256 indexed nonce);

    constructor(address circuit_,uint256 tokenId_,address container_,address transactionSigner_,address notarySigner_) {
        if(circuit_.code.length==0||container_.code.length==0||transactionSigner_==address(0)||notarySigner_==address(0)||transactionSigner_==notarySigner_||transactionSigner_==container_||transactionSigner_==address(this)||notarySigner_==address(this)) revert InvalidPolicy();
        circuit=circuit_; circuitTokenId=tokenId_; container=container_; transactionSigner=transactionSigner_; notarySigner=notarySigner_;
        _owner();
    }
    receive() external payable {}
    function walletState() external view returns(address,uint256,address,address,address,uint256,uint256,bool,bool) {
        return(circuit,circuitTokenId,container,transactionSigner,notarySigner,nonce,policyVersion,active,paused);
    }
    // EIP-712 separator recomputed on every request; no cached chain/domain and
    // no immutable placeholders, so all deployments share an exact runtime hash.
    function _hashTypedDataV4(bytes32 structHash) internal view returns(bytes32) {
        bytes32 domain=keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),keccak256("TapeSign Notary Wallet"),keccak256("1"),block.chainid,address(this)));
        return keccak256(abi.encodePacked(hex"1901",domain,structHash));
    }

    function _owner() internal view {
        (uint256 chain,address nft,uint256 id)=IContainerToken(container).token();
        if(chain!=block.chainid||nft!=circuit||id!=circuitTokenId) revert InvalidPolicy();
        if(IERC721(circuit).ownerOf(circuitTokenId)!=notarySigner) revert OwnerChanged();
    }
    function _request(uint256 expected,uint256 deadline,uint256 version) internal view {
        if(expected!=nonce||block.timestamp>deadline||deadline>block.timestamp+7 days||version!=policyVersion) revert InvalidRequest();
        _owner();
    }
    function _signatures(bytes32 digest,bytes calldata a,bytes calldata b) internal view {
        if(!SignatureChecker.isValidSignatureNow(transactionSigner,digest,a)||!SignatureChecker.isValidSignatureNow(notarySigner,digest,b)) revert InvalidSignatures();
    }
    function bindingDigest(uint256 expected,uint256 deadline) public view returns(bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(BIND,circuit,circuitTokenId,container,transactionSigner,notarySigner,expected,deadline,policyVersion)));
    }
    function activate(uint256 expected,uint256 deadline,bytes calldata a,bytes calldata b) external nonReentrant {
        if(active) revert InvalidRequest();
        _request(expected,deadline,policyVersion); _signatures(bindingDigest(expected,deadline),a,b);
        nonce++; active=true; emit WalletActivated(container,transactionSigner,notarySigner);
    }
    function transferDigest(Transfer calldata t) public view returns(bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(TRANSFER,t.asset,t.recipient,t.amount,t.nonce,t.deadline,t.policyVersion)));
    }
    function execute(Transfer calldata t,bytes calldata a,bytes calldata b) external nonReentrant {
        if(!active||paused) revert NotActive();
        if(t.recipient==address(0)||t.recipient==address(this)||t.amount==0||t.asset==address(this)) revert InvalidRequest();
        _request(t.nonce,t.deadline,t.policyVersion);
        bytes32 digest=transferDigest(t); _signatures(digest,a,b); nonce++;
        if(t.asset==address(0)){(bool ok,)=t.recipient.call{value:t.amount}("");if(!ok)revert NativeTransferFailed();}
        else {if(t.asset.code.length==0)revert InvalidRequest();IERC20(t.asset).safeTransfer(t.recipient,t.amount);}
        emit TransferExecuted(digest,t.nonce,t.asset,t.recipient,t.amount);
    }
    function cancel(uint256 expected) external nonReentrant {
        if((msg.sender!=transactionSigner&&msg.sender!=notarySigner)||expected!=nonce)revert InvalidRequest();
        nonce++;emit NonceCancelled(expected,msg.sender);
    }
    function pause() external nonReentrant {
        if(msg.sender!=transactionSigner&&msg.sender!=notarySigner)revert InvalidRequest();
        if(paused)revert InvalidRequest();paused=true;nonce++;emit WalletPaused(msg.sender);
    }
    function resume(uint256 expected,uint256 deadline,bytes calldata a,bytes calldata b) external nonReentrant {
        if(!active||!paused)revert InvalidRequest();_request(expected,deadline,policyVersion);
        bytes32 digest=_hashTypedDataV4(keccak256(abi.encode(RESUME,expected,deadline,policyVersion)));
        _signatures(digest,a,b);nonce++;paused=false;emit WalletResumed(expected);
    }
}

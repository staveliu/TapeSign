// Only the proposal is removable. Wallets, pending transactions, history and
// balances are unaffected. A generation invalidates late proposal saves.
export const walletProposalKey='tapesign-wallet-v1:proposal';
export const walletProposalClearKey='tapesign-wallet-proposal-clear-v1';
export const walletProposalGeneration=()=>localStorage.getItem(walletProposalClearKey);
export const walletProposalClearedAfter=at=>Number.isFinite(Number(at))&&Number(walletProposalGeneration()?.split(':')[0])>=Number(at);
export function assertWalletProposalCurrent(expected){
 if(walletProposalGeneration()!==expected)throw Object.assign(Error('当前提案已清空，本次旧提案操作不再保存；钱包和交易记录不受影响'),{code:'WALLET_PROPOSAL_CLEARED'});
}
export function clearWalletProposal(){
 localStorage.setItem(walletProposalClearKey,Date.now()+':'+crypto.randomUUID());
 localStorage.removeItem(walletProposalKey);
}

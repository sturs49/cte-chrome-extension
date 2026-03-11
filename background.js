// Crypto Tax Edge v5.0 — Background Service Worker
// Pipeline: Noves (primary) + RPC raw logs → Claude (always, in parallel)
// API calls proxied through Cloudflare worker — no keys exposed in extension

const WORKER_BASE = 'https://app.cryptotaxedge.com';   // Cloudflare worker
const NOVES_BASE  = WORKER_BASE + '/noves';             // proxied Noves endpoint
const CLAUDE_URL  = WORKER_BASE + '/claude';            // proxied Claude endpoint
const FEEDBACK_URL = WORKER_BASE + '/tx-feedback';      // feedback webhook

const CHAIN_SLUGS = {
  ethereum: 'eth', polygon: 'polygon', base: 'base',
  arbitrum: 'arbitrum', optimism: 'optimism', bsc: 'bsc',
};

const PUBLIC_RPCS = {
  ethereum:  'https://eth.llamarpc.com',
  polygon:   'https://polygon.llamarpc.com',
  arbitrum:  'https://arbitrum.llamarpc.com',
  optimism:  'https://optimism.llamarpc.com',
  base:      'https://base.llamarpc.com',
  bsc:       'https://binance.llamarpc.com',
};

const EVENT_SIGS = {
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': 'Transfer(address,address,uint256)',
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925': 'Approval(address,address,uint256)',
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822': 'Swap(Uniswap-V2)',
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67': 'Swap(Uniswap-V3)',
  '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c': 'Deposit(address,uint256)',
  '0x884edad9ce6fa2440d8a54cc123490eb96d2768479d49ff9c7366125a9424364': 'Withdrawal(address,uint256)',
  '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f': 'Mint(address,uint256,uint256)',
  '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496': 'Burn(address,uint256,uint256,address)',
  '0x9e71bc8eea02a63969f509818f2dafb9254532904319f9dbda79b67bd34a5f3d': 'Staked(address,uint256)',
  '0x7fc4727e062e336010f2c282598ef5f14facb3de68cf8195c2f23e1454b2b74e': 'Unstaked(address,uint256)',
  '0x90890809c654f11d6e72a28fa60149770a0d11ec6c92319d6ceb2bb0a4ea1a15': 'RewardPaid(address,uint256)',
  '0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7': 'Claimed(address,uint256)',
  '0x2717ead6b9200dd235aad468c9809ea400fe33ac69b5bfaa6d3e90fc922b6398': 'Borrow(Aave)',
  '0x804c9b842b2748a22bb64b345453a3de7ca54a6ca45ce00d415894979e22897a': 'Repay(Aave)',
};

const FUNC_SIGS = {
  '0xa9059cbb': 'transfer(address,uint256)',
  '0x095ea7b3': 'approve(address,uint256)',
  '0x38ed1739': 'swapExactTokensForTokens',
  '0x7ff36ab5': 'swapExactETHForTokens',
  '0x18cbafe5': 'swapExactTokensForETH',
  '0xe8e33700': 'addLiquidity',
  '0xf305d719': 'addLiquidityETH',
  '0xbaa2abde': 'removeLiquidity',
  '0x2e1a7d4d': 'withdraw(uint256)',
  '0xd0e30db0': 'deposit()',
  '0xa0712d68': 'mint(uint256)',
  '0xdb006a75': 'redeem(uint256)',
  '0xc5ebeaec': 'borrow(uint256)',
  '0x0e752702': 'repayBorrow(uint256)',
  '0x617ba037': 'supply(address,uint256,address,uint16)',
  '0xe8eda9df': 'deposit(address,uint256,address,uint16)',
  '0x69328dec': 'withdraw(address,uint256,address)',
  '0x3d18b912': 'getReward()',
  '0xa694fc3a': 'stake(uint256)',
  '0x2e17de78': 'unstake(uint256)',
  '0x12514bba': 'claimRewards(address)',
};

// Full protocol library (93 protocols)
const PROTOCOL_RULES = {
  'lido': { category:'liquid-staking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', receiptToken:'stETH/wstETH', note:'stETH rebases daily = income. Conservative: taxable swap.', warningUS:true },
  'lido finance': { category:'liquid-staking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', receiptToken:'stETH/wstETH', note:'Same as Lido.', warningUS:true },
  'rocket pool': { category:'liquid-staking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'No periodic income', receiptToken:'rETH', note:'rETH accretes value. No periodic income events.', warningUS:false },
  'frax ether': { category:'liquid-staking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', receiptToken:'frxETH/sfrxETH', note:'sfrxETH vault yield is income.', warningUS:true },
  'frax': { category:'liquid-staking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', receiptToken:'frxETH/sfrxETH', note:'Same as Frax Ether.', warningUS:true },
  'coinbase': { category:'liquid-staking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'No periodic income', receiptToken:'cbETH', note:'cbETH accretes. No periodic income.', warningUS:false },
  'stader': { category:'liquid-staking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', receiptToken:'ETHx/MaticX/BNBx', note:'Multi-chain LST.', warningUS:true },
  'marinade': { category:'liquid-staking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'No periodic income', receiptToken:'mSOL', note:'Solana LST. mSOL non-rebasing.', warningUS:false },
  'marinade finance': { category:'liquid-staking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'No periodic income', receiptToken:'mSOL', note:'Same as Marinade.', warningUS:false },
  'jito': { category:'liquid-staking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'No periodic income', receiptToken:'JitoSOL', note:'IRS has NOT confirmed non-taxable. Conservative: taxable.', warningUS:true },
  'ankr': { category:'liquid-staking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', receiptToken:'ankrETH/ankrBNB', note:'Multi-chain LST.', warningUS:true },
  'swell': { category:'liquid-staking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'No periodic income', receiptToken:'swETH', note:'swETH non-rebasing.', warningUS:false },
  'stakewise': { category:'liquid-staking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', receiptToken:'osETH', note:'osETH receipt token.', warningUS:true },
  'eigenlayer': { category:'restaking', koinlyEntry:'Add to Pool', koinlyExit:'Remove from Pool', koinlyReward:'Airdrop', receiptToken:'none (points)', note:'No receipt token = non-taxable. EIGEN airdrop = income.', warningUS:true },
  'symbiotic': { category:'restaking', koinlyEntry:'Add to Pool', koinlyExit:'Remove from Pool', koinlyReward:'Reward', receiptToken:'none', note:'Native restaking. Non-taxable.', warningUS:false },
  'karak': { category:'restaking', koinlyEntry:'Add to Pool', koinlyExit:'Remove from Pool', koinlyReward:'Reward', receiptToken:'none', note:'Same as EigenLayer.', warningUS:false },
  'ether.fi': { category:'liquid-restaking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', receiptToken:'eETH/weETH', note:'LRT. eETH tradeable = taxable swap.', warningUS:true },
  'etherfi': { category:'liquid-restaking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', receiptToken:'eETH/weETH', note:'Same as ether.fi.', warningUS:true },
  'renzo': { category:'liquid-restaking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', receiptToken:'ezETH', note:'LRT via EigenLayer.', warningUS:true },
  'kelp dao': { category:'liquid-restaking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', receiptToken:'rsETH', note:'LRT. rsETH tradeable.', warningUS:true },
  'puffer finance': { category:'liquid-restaking', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', receiptToken:'pufETH', note:'LRT. pufETH tradeable.', warningUS:true },
  'aave': { category:'lending', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'aToken', note:'aTokens = taxable swap. Borrow = Loan. Repay = Loan repayment.', warningUS:true },
  'aave v2': { category:'lending', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'aToken', note:'Same as Aave.', warningUS:true },
  'aave v3': { category:'lending', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'aToken', note:'Same as Aave.', warningUS:true },
  'compound': { category:'lending', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'No periodic income', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'cToken', note:'cTokens accrete. No periodic income; capital gain on exit.', warningUS:true },
  'compound v2': { category:'lending', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Reward', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'cToken', note:'Same as Compound.', warningUS:true },
  'compound v3': { category:'lending', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Reward', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'cToken', note:'Same as Compound.', warningUS:true },
  'spark': { category:'lending', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'spToken', note:'MakerDAO/Aave fork. spTokens = taxable swap.', warningUS:true },
  'spark protocol': { category:'lending', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'spToken', note:'Same as Spark.', warningUS:true },
  'makerdao': { category:'lending', koinlyEntry:'Add to Pool', koinlyExit:'Remove from Pool', koinlyReward:'Loan', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'none (CDP)', note:'No receipt token = non-taxable. DAI borrow = Loan.', warningUS:false },
  'maker': { category:'lending', koinlyEntry:'Add to Pool', koinlyExit:'Remove from Pool', koinlyReward:'Loan', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'none (CDP)', note:'Same as MakerDAO.', warningUS:false },
  'morpho': { category:'lending', koinlyEntry:'Add to Pool', koinlyExit:'Remove from Pool', koinlyReward:'Lending interest', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'shares (internal)', note:'No ERC-20 receipt token to wallet = non-taxable.', warningUS:false },
  'morpho blue': { category:'lending', koinlyEntry:'Add to Pool', koinlyExit:'Remove from Pool', koinlyReward:'Lending interest', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'shares (internal)', note:'Same as Morpho.', warningUS:false },
  'fluid': { category:'lending', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'fToken', note:'ERC-4626 fTokens = taxable swap.', warningUS:true },
  'instadapp': { category:'lending', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'fToken', note:'Same as Fluid.', warningUS:true },
  'venus': { category:'lending', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Reward', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'vToken', note:'BNB Chain (Compound fork).', warningUS:true },
  'kamino': { category:'lending', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'kToken', note:'Solana lending.', warningUS:true },
  'kamino finance': { category:'lending', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', koinlyBorrow:'Loan', koinlyRepay:'Loan repayment', receiptToken:'kToken', note:'Same as Kamino.', warningUS:true },
  'uniswap': { category:'dex', koinlyEntry:'Trade', koinlyExit:'Liquidity Out', koinlyReward:'Lending interest', receiptToken:'UNI-V2 LP / V3 NFT', note:'All swaps taxable. V3 fees = Lending interest income.', warningUS:false },
  'uniswap v2': { category:'dex', koinlyEntry:'Trade', koinlyExit:'Liquidity Out', koinlyReward:'Reward', receiptToken:'UNI-V2 LP', note:'Same as Uniswap V2.', warningUS:false },
  'uniswap v3': { category:'dex', koinlyEntry:'Trade', koinlyExit:'Liquidity Out', koinlyReward:'Lending interest', receiptToken:'NFT position', note:'V3 NFT entry/exit taxable.', warningUS:false },
  'sushiswap': { category:'dex', koinlyEntry:'Trade', koinlyExit:'Liquidity Out', koinlyReward:'Reward', receiptToken:'SLP', note:'All swaps taxable.', warningUS:false },
  'curve': { category:'dex', koinlyEntry:'Trade', koinlyExit:'Liquidity Out', koinlyReward:'Lending interest', receiptToken:'CRV LP', note:'CRITICAL: stable-to-stable swaps still taxable. LP deposit = Liquidity In.', warningUS:true },
  'curve finance': { category:'dex', koinlyEntry:'Trade', koinlyExit:'Liquidity Out', koinlyReward:'Lending interest', receiptToken:'CRV LP', note:'Same as Curve.', warningUS:true },
  'balancer': { category:'dex', koinlyEntry:'Trade', koinlyExit:'Liquidity Out', koinlyReward:'Lending interest', receiptToken:'BPT', note:'2-8 token pools. LP entry/exit taxable.', warningUS:false },
  'pancakeswap': { category:'dex', koinlyEntry:'Trade', koinlyExit:'Liquidity Out', koinlyReward:'Reward', receiptToken:'CAKE-LP', note:'BNB Chain DEX.', warningUS:false },
  'aerodrome': { category:'dex', koinlyEntry:'Trade', koinlyExit:'Liquidity Out', koinlyReward:'Reward', receiptToken:'aLP', note:'Base chain. veAERO lock = Add to Pool.', warningUS:false },
  'velodrome': { category:'dex', koinlyEntry:'Trade', koinlyExit:'Liquidity Out', koinlyReward:'Reward', receiptToken:'vLP', note:'Optimism DEX.', warningUS:false },
  'camelot': { category:'dex', koinlyEntry:'Trade', koinlyExit:'Liquidity Out', koinlyReward:'Reward', receiptToken:'GRAIL LP', note:'Arbitrum DEX.', warningUS:false },
  'trader joe': { category:'dex', koinlyEntry:'Trade', koinlyExit:'Liquidity Out', koinlyReward:'Reward', receiptToken:'JOE-LP', note:'Avalanche/Arbitrum.', warningUS:false },
  'orca': { category:'dex', koinlyEntry:'Trade', koinlyExit:'Liquidity Out', koinlyReward:'Lending interest', receiptToken:'Whirlpool NFT', note:'Solana DEX.', warningUS:false },
  'raydium': { category:'dex', koinlyEntry:'Trade', koinlyExit:'Liquidity Out', koinlyReward:'Lending interest', receiptToken:'RAY LP', note:'Solana DEX.', warningUS:false },
  'meteora': { category:'dex', koinlyEntry:'Trade', koinlyExit:'Liquidity Out', koinlyReward:'Lending interest', receiptToken:'DLMM LP', note:'Solana DLMM.', warningUS:false },
  'jupiter': { category:'dex-aggregator', koinlyEntry:'Trade', koinlyExit:'N/A', koinlyReward:'Airdrop', receiptToken:'none', note:'Solana aggregator. JUP airdrop = income.', warningUS:false },
  '1inch': { category:'dex-aggregator', koinlyEntry:'Trade', koinlyExit:'N/A', koinlyReward:'Reward', receiptToken:'none', note:'Multi-chain aggregator.', warningUS:false },
  'paraswap': { category:'dex-aggregator', koinlyEntry:'Trade', koinlyExit:'N/A', koinlyReward:'Reward', receiptToken:'none', note:'DEX aggregator.', warningUS:false },
  'cow protocol': { category:'dex-aggregator', koinlyEntry:'Trade', koinlyExit:'N/A', koinlyReward:'Reward', receiptToken:'none', note:'Intent-based batch auction. All swaps taxable.', warningUS:false },
  'cowswap': { category:'dex-aggregator', koinlyEntry:'Trade', koinlyExit:'N/A', koinlyReward:'Reward', receiptToken:'none', note:'Same as CoW Protocol.', warningUS:false },
  'odos': { category:'dex-aggregator', koinlyEntry:'Trade', koinlyExit:'N/A', koinlyReward:'Reward', receiptToken:'none', note:'Multi-chain aggregator.', warningUS:false },
  'yearn': { category:'yield-aggregator', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'No periodic income', receiptToken:'yvToken', note:'yvTokens = taxable swap. Yield accretes in token value.', warningUS:true },
  'yearn finance': { category:'yield-aggregator', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'No periodic income', receiptToken:'yvToken', note:'Same as Yearn.', warningUS:true },
  'beefy': { category:'yield-aggregator', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'No periodic income', receiptToken:'mooToken', note:'Auto-compounder. mooTokens = taxable swap.', warningUS:false },
  'convex finance': { category:'yield-aggregator', koinlyEntry:'Add to Pool', koinlyExit:'Remove from Pool', koinlyReward:'Reward', receiptToken:'cvxLP', note:'LP farm staking = non-taxable. CRV→cvxCRV = Trade (taxable one-way).', warningUS:true },
  'convex': { category:'yield-aggregator', koinlyEntry:'Add to Pool', koinlyExit:'Remove from Pool', koinlyReward:'Reward', receiptToken:'cvxLP', note:'Same as Convex Finance.', warningUS:true },
  'aura finance': { category:'yield-aggregator', koinlyEntry:'Add to Pool', koinlyExit:'Remove from Pool', koinlyReward:'Reward', receiptToken:'auraBAL', note:'Balancer BPT farm staking = non-taxable.', warningUS:false },
  'pendle': { category:'yield-aggregator', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Lending interest', receiptToken:'PT + YT', note:'COMPLEX: yield split = taxable disposal. CPA required.', warningUS:true },
  'gmx': { category:'perpetuals', koinlyEntry:'Add to Pool', koinlyExit:'Realized P&L', koinlyReward:'Reward', receiptToken:'GLP/GM', note:'Perp collateral = Add to Pool. Close = Realized P&L. GLP = Liquidity In/Out.', warningUS:true },
  'gmx v1': { category:'perpetuals', koinlyEntry:'Add to Pool', koinlyExit:'Realized P&L', koinlyReward:'Reward', receiptToken:'GLP', note:'Same as GMX.', warningUS:true },
  'gmx v2': { category:'perpetuals', koinlyEntry:'Add to Pool', koinlyExit:'Realized P&L', koinlyReward:'Reward', receiptToken:'GM', note:'Same as GMX V2.', warningUS:true },
  'dydx': { category:'perpetuals', koinlyEntry:'Add to Pool', koinlyExit:'Realized P&L', koinlyReward:'Reward', receiptToken:'none', note:'Collateral = Add to Pool. PnL = Realized P&L.', warningUS:false },
  'hyperliquid': { category:'perpetuals', koinlyEntry:'Add to Pool', koinlyExit:'Realized P&L', koinlyReward:'Airdrop', receiptToken:'none', note:'HYPE airdrop Nov 2024 = income.', warningUS:true },
  'gains network': { category:'perpetuals', koinlyEntry:'Add to Pool', koinlyExit:'Realized P&L', koinlyReward:'Reward', receiptToken:'none', note:'gTrade perpetuals.', warningUS:false },
  'stargate': { category:'bridge', koinlyEntry:'Transfer', koinlyExit:'Transfer', koinlyReward:'Reward', receiptToken:'none', note:'Same-owner bridge = non-taxable Transfer.', warningUS:false },
  'across': { category:'bridge', koinlyEntry:'Transfer', koinlyExit:'Transfer', koinlyReward:'Reward', receiptToken:'none', note:'Non-taxable bridge.', warningUS:false },
  'hop protocol': { category:'bridge', koinlyEntry:'Transfer', koinlyExit:'Transfer', koinlyReward:'Reward', receiptToken:'hToken (burned)', note:'hToken is intermediate and burned = non-taxable.', warningUS:true },
  'wormhole': { category:'bridge', koinlyEntry:'Transfer', koinlyExit:'Transfer', koinlyReward:'Airdrop', receiptToken:'none', note:'W airdrop = income.', warningUS:false },
  'layerzero': { category:'bridge', koinlyEntry:'Transfer', koinlyExit:'Transfer', koinlyReward:'Airdrop', receiptToken:'none', note:'ZRO airdrop 2024 = income.', warningUS:false },
  'axelar': { category:'bridge', koinlyEntry:'Transfer', koinlyExit:'Transfer', koinlyReward:'Reward', receiptToken:'none', note:'Cross-chain bridge.', warningUS:false },
  'polygon bridge': { category:'bridge', koinlyEntry:'Transfer', koinlyExit:'Transfer', koinlyReward:'N/A', receiptToken:'none', note:'L1<->L2 bridge. Non-taxable.', warningUS:false },
  'arbitrum bridge': { category:'bridge', koinlyEntry:'Transfer', koinlyExit:'Transfer', koinlyReward:'N/A', receiptToken:'none', note:'Official Arbitrum bridge.', warningUS:false },
  'optimism bridge': { category:'bridge', koinlyEntry:'Transfer', koinlyExit:'Transfer', koinlyReward:'N/A', receiptToken:'none', note:'Official Optimism bridge.', warningUS:false },
  'weth': { category:'wrap', koinlyEntry:'Swap', koinlyExit:'Swap', koinlyReward:'N/A', receiptToken:'WETH (1:1)', note:'ETH<->WETH 1:1 non-taxable. Tag as Koinly Swap.', warningUS:false },
  'wrapped ether': { category:'wrap', koinlyEntry:'Swap', koinlyExit:'Swap', koinlyReward:'N/A', receiptToken:'WETH', note:'Same as WETH.', warningUS:false },
  'opensea': { category:'nft-marketplace', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Other income', receiptToken:'NFT (ERC-721/1155)', note:'NFT buy = disposal of crypto. NFT sell = capital gain/loss.', warningUS:false },
  'blur': { category:'nft-marketplace', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Airdrop', receiptToken:'NFT', note:'BLUR airdrop = income.', warningUS:false },
  'magic eden': { category:'nft-marketplace', koinlyEntry:'Trade', koinlyExit:'Trade', koinlyReward:'Reward', receiptToken:'NFT', note:'Multi-chain NFT marketplace.', warningUS:false },
};

function getProtocolRule(name) {
  if (!name) return null;
  return PROTOCOL_RULES[name.toLowerCase().trim()] || null;
}

// ── Message router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'analyze_tx') {
    // Quota check for anonymous and free tiers
    const tier = message.tier || 'anonymous';
    const LIMITS = { anonymous: 10, free: 25, starter: 300, pro: 1000, cpa: Infinity, admin: Infinity };
    const limit  = LIMITS[tier] ?? 10;
    const ANON_KEY = 'cte_anon_used';

    chrome.storage.local.get([ANON_KEY, 'cte_monthly_used', 'cte_month_key'], function(s) {
      const nowMonth = new Date().toISOString().slice(0,7); // "YYYY-MM"
      let monthUsed = (s.cte_month_key === nowMonth) ? (s.cte_monthly_used || 0) : 0;
      let anonUsed  = s[ANON_KEY] || 0;

      if (tier === 'anonymous') {
        if (anonUsed >= limit) {
          sendResponse({ error: 'QUOTA_EXCEEDED', tier: 'anonymous', used: anonUsed, limit });
          return;
        }
      } else {
        if (monthUsed >= limit) {
          sendResponse({ error: 'QUOTA_EXCEEDED', tier, used: monthUsed, limit });
          return;
        }
      }

      analyzeTx(message.hash, message.anthropicKey)
        .then(result => {
          // Increment counter on success
          if (tier === 'anonymous') {
            chrome.storage.local.set({ [ANON_KEY]: anonUsed + 1 });
          } else {
            chrome.storage.local.set({ cte_monthly_used: monthUsed + 1, cte_month_key: nowMonth });
          }
          sendResponse(result);
        })
        .catch(e => sendResponse({ error: e.message }));
    }); // end chrome.storage.local.get
    return true;
  }
  if (message.action === 'save_keys') {
    const data = {
      anthropicKey: message.anthropicKey,
      flagSpam:  message.flagSpam,
      flagDefi:  message.flagDefi,
      flagLarge: message.flagLarge,
    };
    chrome.storage.local.set(data, () => {
      sendResponse({ ok: true, saved: message.anthropicKey ? message.anthropicKey.slice(0,12) : 'empty' });
    });
    return true;
  }
  if (message.action === 'get_keys') {
    chrome.storage.local.get(['anthropicKey'], sendResponse);
    return true;
  }

  if (message.action === 'send_feedback') {
    sendFeedback(message.payload).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }
});


// ── Result cache (session-scoped) ────────────────────────────────────────────
const TX_CACHE = new Map();

// ── Main analysis pipeline (optimized) ───────────────────────────────────────
// Improvements:
//   1. EVM chains probed in PARALLEL via Promise.any — no sequential misses
//   2. API key resolved concurrently with Noves — no extra wait
//   3. RPC fetch + Claude fire together after Noves resolves
//   4. Single Claude call using best available data (rawTx if ready, else without)
//   5. Trimmed prompt — fewer tokens = faster TTFT
//   6. Session cache — repeat hash returns instantly

async function analyzeTx(hash, keyFromMessage) {
  hash = hash.trim();

  // Cache hit
  if (TX_CACHE.has(hash)) return TX_CACHE.get(hash);

  // Noves (required — gives us chain + classification)
  const novesResp = await translateTx(hash);
  if (novesResp.error) return { error: novesResp.error };
  const { chain, data } = novesResp;

  // Fire RPC + Claude together now that we have chain
  const [rawTx, claudeResult] = await Promise.all([
    fetchRawTx(hash, chain),
    claudeAnalyze(hash, chain, data, null),
  ]);

  // If RPC returned meaningful logs AND Claude succeeded, do one quick refinement
  let finalClaude = claudeResult;
  if (rawTx && rawTx.logs.length > 0 && claudeResult && !claudeResult.error) {
    finalClaude = await claudeAnalyze(hash, chain, data, rawTx);
  }

  const novesResult = buildNovesResult(data);
  const result = synthesize(novesResult, finalClaude);
  const out = { ok: true, chain, novesData: data, rawTx, claudeResult: finalClaude, ...result };

  // Cache (cap 50 entries)
  if (TX_CACHE.size >= 50) TX_CACHE.delete(TX_CACHE.keys().next().value);
  TX_CACHE.set(hash, out);
  return out;
}

// ── Noves — parallel EVM chain detection ─────────────────────────────────────
async function translateTx(hash) {
  const isSolana = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(hash);
  const isEvm    = /^0x[a-fA-F0-9]{64}$/.test(hash);
  if (!isEvm && !isSolana) return { error: 'Invalid hash format.' };

  if (isSolana) return tryNoves('svm', 'solana', hash, 'solana');

  // Try all EVM chains in parallel — first hit wins
  const chains = ['base', 'ethereum', 'polygon', 'arbitrum', 'optimism', 'bsc'];
  try {
    return await Promise.any(
      chains.map(chainId =>
        tryNoves('evm', CHAIN_SLUGS[chainId], hash, chainId)
          .then(r => { if (!r.ok || r.authError) throw new Error('miss'); return r; })
      )
    );
  } catch {
    return { error: 'Transaction not found on any supported chain.' };
  }
}

async function tryNoves(ecosystem, slug, hash, chainId) {
  try {
    const res = await fetch(`${NOVES_BASE}/${ecosystem}/${slug}/tx/${hash}`, {
      headers: { Accept: 'application/json' }
    });
    if (res.status === 401 || res.status === 403) return { error: `Noves auth error (${res.status})`, authError: true };
    if (!res.ok) return { ok: false };
    const data = await res.json();
    if (data && Object.keys(data).length > 0) return { ok: true, chain: chainId, data };
    return { ok: false };
  } catch { return { ok: false }; }
}

// ── RPC raw log fetcher ───────────────────────────────────────────────────────
async function fetchRawTx(hash, chain) {
  const rpc = PUBLIC_RPCS[chain];
  if (!rpc) return null;
  try {
    const [txRes, receiptRes] = await Promise.all([
      fetch(rpc, { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({jsonrpc:'2.0',method:'eth_getTransactionByHash',params:[hash],id:1}) }),
      fetch(rpc, { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({jsonrpc:'2.0',method:'eth_getTransactionReceipt',params:[hash],id:2}) }),
    ]);
    const [txData, receiptData] = await Promise.all([txRes.json(), receiptRes.json()]);
    const tx = txData?.result;
    const receipt = receiptData?.result;
    if (!tx || !receipt) return null;

    const selector = (tx.input||'0x').length >= 10 ? (tx.input||'0x').slice(0,10).toLowerCase() : '0x';
    const funcName = FUNC_SIGS[selector] || selector;

    const decodedLogs = (receipt.logs||[]).slice(0,8).map((log, i) => {
      const t0  = (log.topics?.[0]||'').toLowerCase();
      const sig = EVENT_SIGS[t0] || t0.slice(0,10);
      const addr = (log.address||'?').toLowerCase();
      let out = `${i+1}. ${sig} @ ${addr.slice(0,8)}`;
      if (t0 === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
        const from = log.topics[1] ? '0x'+log.topics[1].slice(26) : '?';
        const to   = log.topics[2] ? '0x'+log.topics[2].slice(26) : '?';
        out += ` from:${from.slice(0,8)} to:${to.slice(0,8)}`;
      }
      return out;
    });

    return {
      status: receipt.status === '0x1' ? 'success' : 'failed',
      from: (tx.from||'?').toLowerCase(),
      to:   (tx.to||'?').toLowerCase(),
      value: parseInt(tx.value||'0x0',16) / 1e18 + ' ETH',
      funcName, logCount: (receipt.logs||[]).length, logs: decodedLogs,
    };
  } catch { return null; }
}

// ── Claude — trimmed prompt for faster TTFT ───────────────────────────────────
// ── Claude — via Cloudflare worker proxy ─────────────────────────────────────
async function claudeAnalyze(hash, chain, novesData, rawTx) {

  const c    = novesData.classificationData || {};
  const sent = (c.sent||[]).map(a => `${a.amount} ${a.token?.symbol||a.asset}`).join(', ') || 'none';
  const recv = (c.received||[]).map(a => `${a.amount} ${a.token?.symbol||a.asset}`).join(', ') || 'none';
  const proto = c.protocol?.name || '';
  const rule  = getProtocolRule(proto);
  const novesType = c.type || 'unclassified';

  const protoCtx = rule
    ? `PROTOCOL:${proto}(${rule.category}) Entry:${rule.koinlyEntry} Exit:${rule.koinlyExit} Note:${rule.note}`
    : `PROTOCOL:${proto||'unknown'} — apply general US tax rules`;

  const rawSection = rawTx
    ? `RAW:${rawTx.status} fn:${rawTx.funcName} logs(${rawTx.logCount}):\n${rawTx.logs.join('\n')}`
    : 'RAW:unavailable';

  const prompt = `US crypto tax expert. Classify this tx for Koinly. If Noves is wrong per raw logs, correct it.
NOVES: type=${novesType} desc=${c.description||'none'} proto=${proto||'unknown'}
sent=[${sent}] recv=[${recv}] chain=${chain}
${protoCtx}
${rawSection}
RULES: bridge same-owner=Transfer; wrap1:1=Swap(non-taxable); borrow=Loan; repay=Loan repayment; native-stake=Add/Remove Pool; liquid-stake(receipt-token)=Trade; swap=Trade; LP=Liquidity In/Out; rewards=Reward/Airdrop/Lending interest
Respond ONLY valid JSON: {"txType":"<>","confidence":<0-100>,"reasoning":"<20 words max, tx-specific not generic>","koinlyAction":"<exact tag>","taxable":<bool>,"taxCategory":"<disposal|income|non-taxable|unknown>","novesCorrected":<bool>,"novesOriginalType":"${novesType}"}`;

  try {
    const res = await fetch(CLAUDE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j?.error?.message || ''; } catch {}
      return { error: `API ${res.status}: ${detail.slice(0,80)}` };
    }

    const d = await res.json();
    const text = (d.content?.[0]?.text||'').replace(/```json|```/g,'').trim();
    try { return JSON.parse(text); } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) try { return JSON.parse(m[0]); } catch {}
      return { error: 'JSON parse failed' };
    }
  } catch(e) { return { error: e.message }; }
}



// ── Feedback — send thumbs up/down to worker ─────────────────────────────────
async function sendFeedback(payload) {
  try {
    await fetch(FEEDBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn('[CTE] feedback send failed:', e.message);
  }
}

// ── Build Noves-only result ───────────────────────────────────────────────────
function buildNovesResult(data) {
  const c = data.classificationData || {};
  const rawType = (c.type || data.type || '').toLowerCase().replace(/[^a-z]/g,'');
  const isUnknown = !rawType || rawType === 'unclassified' || rawType === 'unknown';

  const KOINLY_FALLBACK = {
    swap: 'Trade', trade: 'Trade', exchange: 'Trade',
    transfer: 'Transfer', send: 'Transfer', receive: 'Transfer',
    deposit: 'Add to Pool', withdraw: 'Remove from Pool',
    stake: 'Add to Pool', unstake: 'Remove from Pool',
    addliquidity: 'Liquidity In', removeliquidity: 'Liquidity Out',
    addtopool: 'Add to Pool', removefrompool: 'Remove from Pool',
    liquidityin: 'Liquidity In', liquidityout: 'Liquidity Out',
    borrow: 'Loan', repay: 'Loan repayment', loanrepayment: 'Loan repayment',
    reward: 'Reward', airdrop: 'Airdrop',
    lendinginterest: 'Lending interest', income: 'Other income',
    wrap: 'Swap', unwrap: 'Swap', bridge: 'Transfer',
    approve: 'Transfer', nft: 'Trade',
  };

  const TAX_CATEGORY = {
    Trade: 'disposal', Swap: 'non-taxable', Transfer: 'non-taxable',
    'Add to Pool': 'non-taxable', 'Remove from Pool': 'non-taxable',
    'Liquidity In': 'disposal', 'Liquidity Out': 'disposal',
    Loan: 'non-taxable', 'Loan repayment': 'non-taxable',
    Reward: 'income', Airdrop: 'income', 'Lending interest': 'income',
    'Other income': 'income',
  };

  const koinlyAction = isUnknown ? 'Transfer' : (KOINLY_FALLBACK[rawType] || 'Transfer');
  const taxCategory  = TAX_CATEGORY[koinlyAction] || 'unknown';
  const taxable      = taxCategory === 'disposal' || taxCategory === 'income';
  const confidence   = isUnknown ? 40 : 72;

  return {
    txType:       c.type || data.type || 'unclassified',
    confidence,
    koinlyAction,
    reasoning:    c.description ? c.description.slice(0, 60) : 'Noves classification',
    taxable,
    taxCategory,
  };
}

// ── Synthesize Noves + Claude ─────────────────────────────────────────────────
function synthesize(novesResult, claudeResult) {
  const nConf = novesResult.confidence || 0;
  const cConf = claudeResult?.confidence || 0;
  const nType = (novesResult.txType||'').toLowerCase().replace(/[^a-z]/g,'');
  const cType = (claudeResult?.txType||'').toLowerCase().replace(/[^a-z]/g,'');

  const claudeOk = claudeResult && !claudeResult.error && !claudeResult._noKey;

  if (!claudeOk) {
    return { ...novesResult, source: 'noves', sourceBreakdown: { noves: nConf }, claudeError: claudeResult?.error };
  }

  // Claude corrected Noves
  if (claudeResult.novesCorrected) {
    return {
      txType: claudeResult.txType, confidence: Math.round(nConf*0.25 + cConf*0.75),
      koinlyAction: claudeResult.koinlyAction, reasoning: claudeResult.reasoning,
      taxable: claudeResult.taxable, taxCategory: claudeResult.taxCategory,
      source: 'noves+claude★', sourceBreakdown: { noves: nConf, claude: cConf },
    };
  }

  // Agreement
  if (nType === cType) {
    return {
      txType: claudeResult.txType, confidence: Math.min(99, Math.round(nConf*0.45 + cConf*0.55 + 5)),
      koinlyAction: claudeResult.koinlyAction, reasoning: claudeResult.reasoning,
      taxable: claudeResult.taxable, taxCategory: claudeResult.taxCategory,
      source: 'noves+claude', sourceBreakdown: { noves: nConf, claude: cConf },
    };
  }

  // Disagreement — flag for review
  return {
    txType: cConf >= nConf ? claudeResult.txType : novesResult.txType,
    confidence: Math.round(Math.max(nConf, cConf) * 0.80),
    koinlyAction: claudeResult.koinlyAction, reasoning: claudeResult.reasoning,
    taxable: claudeResult.taxable, taxCategory: claudeResult.taxCategory,
    source: 'noves+claude⚠', needsReview: true,
    sourceBreakdown: { noves: nConf, claude: cConf },
    disagreement: {
      novesType: novesResult.txType, novesKoinly: novesResult.koinlyAction,
      claudeType: claudeResult.txType, claudeKoinly: claudeResult.koinlyAction,
    },
  };
}

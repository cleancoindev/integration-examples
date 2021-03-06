import Maker from '@makerdao/dai';
import McdPlugin, { ETH, BAT } from '@makerdao/dai-plugin-mcd';
import FaucetABI from './Faucet.json';
import dsTokenAbi from './dsToken.abi.json';
//import MakerOtc from 'dai-plugin-maker-otc'

let maker = null;
let web3 = null;
// let MakerOtc = null;
const connect = async () => {
    maker = await Maker.create('browser', {
        plugins: [//MakerOtc,
            [
                McdPlugin,
                {
                    network: 'kovan',
                    cdpTypes: [
                        { currency: ETH, ilk: 'ETH-A' },
                        { currency: BAT, ilk: 'BAT-A' },
                    ]
                }
            ]
        ]
    });
    await maker.authenticate();
    await maker.service('proxy').ensureProxy();
    //await maker.service('exchange')
    return maker;
}


const getWeb3 = async () => {
    web3 = await maker.service('web3')._web3;
    return web3;
}

const requestTokens = async () => {
    try {
        console.log('trying to call function gulp in faucet')
        let accounts = await web3.eth.getAccounts()
        let BAT = '0x9f8cfb61d3b2af62864408dd703f9c3beb55dff7'
        const faucetABI = FaucetABI;
        const faucetAddress = '0x94598157fcf0715c3bc9b4a35450cce82ac57b20'
        const faucetContract = new web3.eth.Contract(faucetABI, faucetAddress);
        await faucetContract.methods.gulp(BAT).send({ from: accounts[0] }, (error, result) => console.log(error))


    } catch (error) {
        console.log('Request Tokens error', error)
    }
}

const approveProxyInBAT = async () => {
    try {
        let accounts = await web3.eth.getAccounts();
        let proxy = await maker.currentProxy();
        let BATAddress = '0x9f8cfb61d3b2af62864408dd703f9c3beb55dff7'
        const BATAbi = dsTokenAbi;
        const BATContract = new web3.eth.Contract(BATAbi, BATAddress);
        return new Promise(async (resolve, reject) => {
            await BATContract.methods.approve(proxy, '-1').send({ from: accounts[0] }, (error, result) => {
                if (error) {
                    console.log('error in approving BAT token', error)
                    reject(error)
                }
                console.log('result in approving BAT token', result)
                resolve(result)
            })

        })
    } catch (error) {
        console.log(error)
    }

}
const approveProxyInDai = async () => {
    try {
        let accounts = await web3.eth.getAccounts();
        let proxy = await maker.currentProxy();
        let daiAddress = '0x4f96fe3b7a6cf9725f59d353f723c1bdb64ca6aa';
        const daiAbi = dsTokenAbi;
        const DAIContract = new web3.eth.Contract(daiAbi, daiAddress);
        return new Promise(async (resolve, reject) => {
            await DAIContract.methods.approve(proxy, '-1').send({ from: accounts[0] }, (error, result) => {
                if (error) {
                    console.log('error in approving DAI token', error)
                    reject(error);
                }
                console.log('result in approving DAI token', result)
                resolve(result);
            })

        })
    } catch (error) {
        console.log(error)
    }

}

const leverage = async (iterations = 2, priceFloor = 175, principal = 0.25) => {
    const cdpManager = maker.service('mcd:cdpManager');
    console.log('cdpManager', cdpManager)
    const cdpType = maker.service('mcd:cdpType');
    console.log('cdpType', cdpType)
    const liquidationRatioString = await cdpType.cdpTypes[0].liquidationRatio;
    const liquidationRatio = liquidationRatioString.toNumber()
    const priceEth = await cdpType.cdpTypes[0].price.toNumber()
    console.log(`Liquidation ratio: ${liquidationRatio}`);
    console.log(`Current price of ETH: ${priceEth}`);

    // const cdp = await cdpManager.getCdp(642)
    // console.log(cdp)
    // console.log('Collateral Amount: ', cdp.collateralAmount.toNumber())
    // console.log('Collateral Value: ', cdp.collateralValue.toNumber())
    // console.log('Debt: ', cdp.debtValue.toNumber())
    console.log('opening CDP...');
    let cdp = await cdpManager.open('ETH-A', { cache: false })
    console.log('CDP, ', cdp)
    const id = cdp.id
    console.log(`CDP ID: ${id}`);


    // calculate a collateralization ratio that will achieve the given price floor
    const collatRatio = priceEth * liquidationRatio / priceFloor;
    console.log(`Target ratio: ${collatRatio}`);

    // calculate how much Dai we need to draw in order
    // to achieve the desired collateralization ratio
    let drawAmt = Math.floor(principal * priceEth / collatRatio);
    console.log('Drawing: ', drawAmt)
    await cdpManager.lockAndDraw(id, cdp.ilk, ETH(principal), drawAmt);
    console.log(`drew ${drawAmt} Dai`);

    // do `iterations` round trip(s) to the exchange
    for (let i = 0; i < iterations; i++) {
        // exchange the drawn Dai for W-ETH
        let tx = await maker.service('exchange').sellDai(drawAmt, 'WETH', '0.03');
        console.log(`Selling ${drawAmt} Dai`, tx)
        // observe the amount of W-ETH received from the exchange
        // by calling `fillAmount` on the returned transaction object
        let returnedWeth = tx.fillAmount() / 10 ** 18;
        console.log(`exchanged ${drawAmt} Dai for ${returnedWeth}`);

        // calculate how much Dai we need to draw in order to
        // lock all of the W-ETH we just received into our CDP
        // re-attain our desired collateralization ratio
        drawAmt = Math.floor(returnedWeth * priceEth / collatRatio);
        await cdpManager.lockAndDraw(id, cdp.ilk, ETH(returnedWeth), drawAmt);
        console.log(`locked ${returnedWeth}`);
        console.log(`drew ${drawAmt} Dai`);
    }

    // get the final state of our CDP
    cdp = await cdpManager.getCdp(id, { cache: false });
    const collateralAmount = cdp.collateralAmount.toNumber();
    const collateralValue = cdp.collateralValue.toNumber();
    const debt = cdp.debtValue.toNumber();


    const cdpState = {
        collateralValue,
        collateralAmount,
        debt,
        id,
        principal,
        iterations,
        priceFloor,
        finalDai: drawAmt
    };

    console.log(`Created CDP: ${JSON.stringify(cdpState)}`);
}

const sell5Dai = async () => {
    let tx = await maker.service('exchange').sellDai('5', 'WETH', '0.001');
    console.log('Seeling 5 Dai', tx)
    console.log('Seeling 5 Dai', tx.fillAmount())
}

const buyDai = async () => {
    let tx = await maker.service('exchange').buyDai('5', 'WETH', '0.001');
    console.log('Buying 5 Dai', tx)
    console.log('Buying 5 Dai', tx.fillAmount())
}

export {
    requestTokens,
    getWeb3,
    connect,
    approveProxyInBAT,
    approveProxyInDai,
    leverage,
    sell5Dai,
    buyDai
};
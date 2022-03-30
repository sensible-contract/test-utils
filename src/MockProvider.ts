import {
  Balance,
  NftCollection,
  NftUtxo,
  Provider,
  Token,
  TokenUtxo,
  Utxo
} from "@sensible-contract/abstract-provider";
import * as bsv from "@sensible-contract/bsv";
import { BN } from "@sensible-contract/bsv";
import { API_NET, Proto, Utils } from "@sensible-contract/sdk-core";
import * as nftProto from "./contract-proto/nft.proto";
import * as nftSellProto from "./contract-proto/nftSell.proto";
import * as ftProto from "./contract-proto/token.proto";
import { verifyTx } from "./utils";

function getOutpoint(txid, index) {
  return txid + index;
}
enum UtxoType {
  bsv,
  ft,
  nft,
  nftSell,
  other,
}

type TokenBalance = {
  balance: string;
  pendingBalance: string;
  utxoCount: number;
  decimal: number;
};

type NftSellUtxo = {
  codehash: string;
  genesis: string;
  tokenIndex: string;
  txId: string;
  outputIndex: number;
  sellerAddress: string;
  satoshisPrice: number;
};

type UtxoPack = {
  outpoint: string;
  type: UtxoType;
  bsv?: {
    utxo: {
      txId: string;
      outputIndex: number;
      satoshis: number;
      address: string;
    };
  };
  ft?: {
    codehash: string;
    genesis: string;
    ftUtxo: TokenUtxo;
  };
  nft?: {
    codehash: string;
    genesis: string;
    nftUtxo: NftUtxo;
  };
  nftSell?: {
    codehash: string;
    genesis: string;
    nftSellUtxo: NftSellUtxo;
  };
};

interface ModelTxOutResp {
  address?: string;
  codeType?: number;
  codehash?: string;
  genesis?: string;
  height?: number;
  idx?: number;
  isNFT?: boolean;
  metaOutputIndex?: number;
  metaTxId?: string;
  satoshi?: number;
  scriptPk?: string;
  scriptType?: string;
  sensibleId?: string;
  tokenAmount?: string;
  tokenDecimal?: number;
  tokenId?: string;
  tokenIndex?: string;
  tokenName?: string;
  tokenSymbol?: string;
  txid?: string;
  vout?: number;
}
interface ModelNFTSellResp {
  address?: string;
  codehash?: string;
  genesis?: string;
  height?: number;
  idx?: number;
  isReady?: boolean;
  metaOutputIndex?: number;
  metaTxId?: string;
  price?: number;
  satoshi?: number;
  sensibleId?: string;
  supply?: number;
  tokenIndex?: string;
  txid?: string;
  vout?: number;
}
type Spent = {
  txId: string;
  index: number;
  spentTxId: string;
  spentInputIndex: number;
};
export class MockProvider implements Provider {
  serverBase: string;
  transactions: { [key: string]: bsv.Transaction } = {};
  spents: Spent[] = [];
  utxoPacks: UtxoPack[] = [];
  network: "mainnet" | "testnet";
  constructor(apiNet: API_NET = "mainnet") {
    this.network = apiNet;
  }

  public cleanCacheds() {
    this.utxoPacks = [];
    this.transactions = {};
    this.spents = [];
  }

  public cleanBsvUtxos() {
    this.utxoPacks = this.utxoPacks.filter((v) => v.type != UtxoType.bsv);
  }
  /**
   * @param {string} address
   */
  public async getUtxos(address: string): Promise<Utxo[]> {
    let arr = [];
    for (let i = 0; i < this.utxoPacks.length; i++) {
      if (this.utxoPacks[i].type == UtxoType.bsv) {
        if (this.utxoPacks[i].bsv.utxo.address == address) {
          arr.push(this.utxoPacks[i].bsv.utxo);
        }
      }
    }
    let utxos: Utxo[] = [];
    arr.forEach((v) => {
      utxos.push({
        txId: v.txId,
        outputIndex: v.outputIndex,
        satoshis: v.satoshis,
        address: address,
      });
    });
    return utxos;
  }

  /**
   * @param {string} hex
   */
  public async broadcast(txHex: string): Promise<string> {
    let tx = new bsv.Transaction(txHex);
    tx.inputs.forEach((input, index) => {
      let inputTxId = input.prevTxId.toString("hex");
      let outpoint = getOutpoint(inputTxId, input.outputIndex);

      let utxoPack = this.utxoPacks.find((v) => v.outpoint == outpoint);
      if (!utxoPack) {
        console.log(outpoint, "missing");
        throw new Error("missing input");
      }
      this.utxoPacks = this.utxoPacks.filter((v) => v != utxoPack);

      input.output = this.transactions[inputTxId].outputs[input.outputIndex];

      this.spents.push({
        txId: inputTxId,
        index: input.outputIndex,
        spentTxId: tx.id,
        spentInputIndex: index,
      });
    });

    if (tx.inputs.length > 0) {
      if (verifyTx(tx) == false) {
        Utils.dumpTx(tx);
        throw new Error("verifyTx failed");
      }
    }
    tx.outputs.forEach((v, index) => {
      if (v.script.isPublicKeyHashOut()) {
        let address = new bsv.Address(v.script.getAddressInfo() as bsv.Address);
        this.utxoPacks.push({
          outpoint: getOutpoint(tx.id, index),
          type: UtxoType.bsv,
          bsv: {
            utxo: {
              txId: tx.id,
              outputIndex: index,
              satoshis: v.satoshis,
              address: address.toString(),
            },
          },
        });
      } else {
        let scriptBuf = v.script.toBuffer();
        let protoType = Proto.getProtoType(scriptBuf);
        if (protoType == Proto.PROTO_TYPE.FT) {
          let dataPart = ftProto.parseDataPart(scriptBuf);
          let genesis = ftProto.getQueryGenesis(scriptBuf);
          let codehash = ftProto.getQueryCodehash(scriptBuf);
          let address = bsv.Address.fromPublicKeyHash(
            Buffer.from(dataPart.tokenAddress, "hex"),
            this.network
          );
          this.utxoPacks.push({
            outpoint: getOutpoint(tx.id, index),
            type: UtxoType.ft,
            ft: {
              genesis,
              codehash,
              ftUtxo: {
                txId: tx.id,
                outputIndex: index,
                tokenAddress: address.toString(),
                tokenAmount: dataPart.tokenAmount.toString(10),
              },
            },
          });
        } else if (protoType == Proto.PROTO_TYPE.NFT) {
          let dataPart = nftProto.parseDataPart(scriptBuf);
          let genesis = nftProto.getQueryGenesis(scriptBuf);
          let codehash = nftProto.getQueryCodehash(scriptBuf);
          let address = bsv.Address.fromPublicKeyHash(
            Buffer.from(dataPart.nftAddress, "hex"),
            this.network
          );
          this.utxoPacks.push({
            outpoint: getOutpoint(tx.id, index),
            type: UtxoType.nft,
            nft: {
              genesis,
              codehash,
              nftUtxo: {
                txId: tx.id,
                outputIndex: index,
                tokenAddress: address.toString(),
                tokenIndex: dataPart.tokenIndex.toString(10),
                metaOutputIndex: 0,
                metaTxId:""
              },
            },
          });
        } else if (protoType == Proto.PROTO_TYPE.NFT_SELL) {
          let dataPart = nftSellProto.parseDataPart(scriptBuf);
          let address = bsv.Address.fromPublicKeyHash(
            Buffer.from(dataPart.sellerAddress, "hex"),
            this.network
          );
          this.utxoPacks.push({
            outpoint: getOutpoint(tx.id, index),
            type: UtxoType.nftSell,
            nftSell: {
              genesis: dataPart.genesis,
              codehash: dataPart.codehash,
              nftSellUtxo: {
                genesis: dataPart.genesis,
                codehash: dataPart.codehash,
                tokenIndex: dataPart.tokenIndex.toString(10),
                txId: tx.id,
                outputIndex: index,
                sellerAddress: address.toString(),
                satoshisPrice: dataPart.satoshisPrice.toNumber(),
              },
            },
          });
        } else {
          this.utxoPacks.push({
            outpoint: getOutpoint(tx.id, index),
            type: UtxoType.other,
          });
        }
      }
    });

    this.transactions[tx.id] = tx;

    // Utils.dumpTx(tx);
    return tx.id;
  }

  public async pushTx(txHex: string) {
    return this.broadcast(txHex);
  }

  public async getRawTx(txid: string): Promise<string> {
    let tx = this.transactions[txid];
    return tx.serialize(true);
  }

  /**
   * 通过FT合约CodeHash+溯源genesis获取某地址的utxo列表
   */
  public async getTokenUtxos(
    codehash: string,
    genesis: string,
    address: string,
    queryParams: { cursor: number; size: number } = { cursor: 0, size: 100 }
  ): Promise<TokenUtxo[]> {
    let arr = [];
    for (let i = 0; i < this.utxoPacks.length; i++) {
      let utxoPack = this.utxoPacks[i];
      if (utxoPack.type == UtxoType.ft) {
        if (
          utxoPack.ft.codehash == codehash &&
          utxoPack.ft.genesis == genesis &&
          utxoPack.ft.ftUtxo.tokenAddress == address
        ) {
          arr.push(utxoPack.ft.ftUtxo);
        }
      }
    }
    return arr;
  }


  public async getNftSellUtxoDetail(
    codehash: string,
    genesis: string,
    tokenIndex: string,
    queryParams: { ready: boolean }
  ): Promise<ModelNFTSellResp[]> {
    let arr = [];
    for (let i = 0; i < this.utxoPacks.length; i++) {
      let utxoPack = this.utxoPacks[i];
      if (utxoPack.type == UtxoType.nftSell) {
        if (
          utxoPack.nftSell.codehash == codehash &&
          utxoPack.nftSell.genesis == genesis &&
          utxoPack.nftSell.nftSellUtxo.tokenIndex == tokenIndex
        ) {
          arr.push(utxoPack.nftSell.nftSellUtxo);
        }
      }
    }
    return arr.map((v) => ({
      txid: v.txId,
      vout: v.outputIndex,
      address: v.sellerAddress,
      price: v.satoshisPrice,
    }));
  }

  public async getIsUtxoSpent(txId: string, index: number): Promise<boolean> {
    let spent = this.spents.find((v) => v.txId == txId && v.index == index);
    if (spent) {
      return true;
    } else {
      return false;
    }
  }

  /**
   * 查询某人持有的某FT的余额
   */
  public async getTokenBalance(
    codehash: string,
    genesis: string,
    address: string
  ): Promise<TokenBalance> {
    let balance = BN.Zero;
    for (let i = 0; i < this.utxoPacks.length; i++) {
      let utxoPack = this.utxoPacks[i];
      if (utxoPack.type == UtxoType.ft) {
        if (
          utxoPack.ft.codehash == codehash &&
          utxoPack.ft.genesis == genesis &&
          utxoPack.ft.ftUtxo.tokenAddress == address
        ) {
          balance = balance.add(
            BN.fromString(utxoPack.ft.ftUtxo.tokenAmount, 10)
          );
        }
      }
    }
    return {
      balance: balance.toString(),
      pendingBalance: "0",
      utxoCount: 0,
      decimal: 0,
    };
  }

  /**
   * 通过NFT合约CodeHash+溯源genesis获取某地址的utxo列表
   */
  public async getNftUtxos(
    codehash: string,
    genesis: string,
    address: string,
    queryParams: { cursor: number; size: number }
  ): Promise<NftUtxo[]> {
    let arr = [];
    for (let i = 0; i < this.utxoPacks.length; i++) {
      let utxoPack = this.utxoPacks[i];
      if (utxoPack.type == UtxoType.nft) {
        if (
          utxoPack.nft.codehash == codehash &&
          utxoPack.nft.genesis == genesis &&
          utxoPack.nft.nftUtxo.tokenAddress == address
        ) {
          arr.push(utxoPack.nft.nftUtxo);
        }
      }
    }
    return arr;
  }


  getBalance(address: string): Promise<Balance> {
      throw "not support"
  }

  getTokenList(address: string, queryParams?: { cursor: number; size: number; }): Promise<Token[]> {
      throw "not support"
  }

  getNftUtxo(codehash: string, genesis: string, tokenIndex: string): Promise<NftUtxo> {
    let arr = [];
    for (let i = 0; i < this.utxoPacks.length; i++) {
      let utxoPack = this.utxoPacks[i];
      if (utxoPack.type == UtxoType.nft) {
        if (
          utxoPack.nft.codehash == codehash &&
          utxoPack.nft.genesis == genesis &&
          utxoPack.nft.nftUtxo.tokenIndex == tokenIndex
        ) {
          arr.push(utxoPack.nft.nftUtxo);
        }
      }
    }
    return arr[0];
  }

  getNftCollectionList(address: string, queryParams?: { cursor: number; size: number; }): Promise<NftCollection[]> {
      throw "not support"
  }
}

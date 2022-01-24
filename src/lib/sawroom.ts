/* eslint-disable functional/immutable-data */
import { createHash } from 'crypto';

import { protobuf } from '@restroom-mw/sawtooth-sdk';
import {
  createContext,
  CryptoFactory,
} from '@restroom-mw/sawtooth-sdk/signing';
import { Secp256k1PrivateKey } from '@restroom-mw/sawtooth-sdk/signing/secp256k1';
import atob from 'atob';
import axios from 'axios';
import cbor from 'borc';
// import retry from 'async/retry';

type Payload = {
  readonly value: string;
  readonly address: string;
};

const PREFIX = 'c274b5';
const WALLET_PREFIX = '710675';

function hash(v) {
  return createHash('sha512').update(v).digest('hex');
}

// async function is_transaction_valid(link: string) {
//   var res = await retry( {times: 3, interval: 10}, async () => {
//     var batchResult = await axios.get(link);
//     if (batchResult == undefined) throw new Error;
//     if (batchResult.data.data == undefined) throw new Error;
//     // if (batchResult.data.data[0].status == "PENDING") throw new Error;
//     return batchResult;
//   });
//   return res.data.data[0].status;
// }

const buildBatch = (payload: Payload) => {
  const context = createContext('secp256k1');
  const privateKey = context.newRandomPrivateKey();
  const signer = new CryptoFactory(context).newSigner(privateKey);
  const payloadBytes = cbor.encode(payload);

  const toU = (ba) => Buffer.from(ba, 'utf8');

  const transactionHeaderBytes = protobuf.TransactionHeader.encode({
    familyName: 'restroom',
    familyVersion: '1.0',
    inputs: [PREFIX],
    outputs: [PREFIX],
    signerPublicKey: signer.getPublicKey().asHex(),
    batcherPublicKey: signer.getPublicKey().asHex(),
    dependencies: [],
    payloadSha512: createHash('sha512').update(payloadBytes).digest('hex'),
  }).finish();

  const signature = signer.sign(toU(transactionHeaderBytes));

  const transaction = protobuf.Transaction.create({
    header: transactionHeaderBytes,
    headerSignature: signature,
    payload: payloadBytes,
  });

  const transactions = [transaction];

  const batchHeaderBytes = protobuf.BatchHeader.encode({
    signerPublicKey: signer.getPublicKey().asHex(),
    transactionIds: transactions.map((txn) => txn.headerSignature),
  }).finish();

  const batchSignature = signer.sign(toU(batchHeaderBytes));

  const batch = protobuf.Batch.create({
    header: batchHeaderBytes,
    headerSignature: batchSignature,
    transactions: transactions,
  });

  return protobuf.BatchList.encode({
    batches: [batch],
  }).finish();
};

type WalletPayload = {
  readonly action: string;
  readonly value: number;
  readonly beneficiary_pubkey?: string;
};

const buildBatchWallet = (privateKeyHex: string, payload: WalletPayload) => {
  const context = createContext('secp256k1');
  const privateKey = Secp256k1PrivateKey.fromHex(privateKeyHex);
  const signer = new CryptoFactory(context).newSigner(privateKey);
  const address =
    WALLET_PREFIX + hash(signer.getPublicKey().asHex()).substr(0, 64);
  const inputs = [address];
  const outputs = [address];
  if (payload.beneficiary_pubkey != undefined) {
    const toAddress =
      WALLET_PREFIX + hash(payload.beneficiary_pubkey).substr(0, 64);
    inputs.push(toAddress);
    outputs.push(toAddress);
  }
  // eslint-disable-next-line functional/no-let
  let payloadString = payload.action + ',' + payload.value;
  if (payload.beneficiary_pubkey != undefined) {
    payloadString += ',' + payload.beneficiary_pubkey;
  }

  const payloadBytes = Uint8Array.from(payloadString, (x) => x.charCodeAt(0));

  const toU = (ba) => Buffer.from(ba, 'utf8');

  const transactionHeaderBytes = protobuf.TransactionHeader.encode({
    familyName: 'wallet',
    familyVersion: '1.0',
    inputs: inputs,
    outputs: outputs,
    signerPublicKey: signer.getPublicKey().asHex(),
    batcherPublicKey: signer.getPublicKey().asHex(),
    dependencies: [],
    payloadSha512: hash(payloadBytes),
    nonce: '' + Math.random(),
  }).finish();

  const signature = signer.sign(toU(transactionHeaderBytes));

  const transaction = protobuf.Transaction.create({
    header: transactionHeaderBytes,
    headerSignature: signature,
    payload: payloadBytes,
  });

  const transactions = [transaction];

  const batchHeaderBytes = protobuf.BatchHeader.encode({
    signerPublicKey: signer.getPublicKey().asHex(),
    transactionIds: transactions.map((txn) => txn.headerSignature),
  }).finish();

  const batchSignature = signer.sign(toU(batchHeaderBytes));

  const batch = protobuf.Batch.create({
    header: batchHeaderBytes,
    headerSignature: batchSignature,
    transactions: transactions,
  });

  return protobuf.BatchList.encode({
    batches: [batch],
  }).finish();
};

export const store = async (
  payload: unknown,
  address = 'http://localhost:8008',
  debug?: boolean
) => {
  const ts =
    PREFIX +
    createHash('sha512').update(Date.now().toString()).digest('hex').slice(-64);
  const r = await axios.post(
    `${address}/batches`,
    buildBatch({
      value: JSON.stringify(payload),
      address: ts,
    }),
    {
      headers: { 'Content-Type': 'application/octet-stream' },
    }
  );
  if (debug) console.log(r.status, r.data);
  return ts;
};

export const retrieve = async (
  uid: string,
  address = 'http://localhost:8008',
  debug?: boolean
) => {
  const res = await axios.get(`${address}/state?address=${uid}`);
  if (debug) console.log(res.status, res.data);
  if (res.data.data.length) {
    const [result] = cbor.decodeAll(res.data.data[0].data, 'base64');
    if (debug) console.log(result[uid]);
    return JSON.parse(result[uid]);
  }
  return [];
};

export const deposit = async (
  privateKey: string,
  value: number,
  address = 'http://localhost:8008',
  debug?: boolean
) => {
  const r = await axios.post(
    `${address}/batches`,
    buildBatchWallet(privateKey, {
      action: 'deposit',
      value: value,
    }),
    {
      headers: { 'Content-Type': 'application/octet-stream' },
    }
  );
  if (debug) console.log(r.status, r.data);
  return r.data.link;
};

export const withdraw = async (
  privateKey: string,
  value: number,
  address = 'http://localhost:8008',
  debug?: boolean
) => {
  const r = await axios.post(
    `${address}/batches`,
    buildBatchWallet(privateKey, {
      action: 'withdraw',
      value: value,
    }),
    {
      headers: { 'Content-Type': 'application/octet-stream' },
    }
  );
  if (debug) console.log(r.status, r.data);
  return r.data.link;
};

export const transfer = async (
  privateKey: string,
  value: number,
  beneficiary_pubkey: string,
  address = 'http://localhost:8008',
  debug?: boolean
) => {
  const r = await axios.post(
    `${address}/batches`,
    buildBatchWallet(privateKey, {
      action: 'transfer',
      value: value,
      beneficiary_pubkey: beneficiary_pubkey,
    }),
    {
      headers: { 'Content-Type': 'application/octet-stream' },
    }
  );
  if (debug) console.log(r.status, r.data);
  return r.data.link;
};

export const balance = async (
  publicKey: string,
  address = 'http://localhost:8008',
  debug?: boolean
) => {
  try {
    const addr = WALLET_PREFIX + hash(publicKey).substr(0, 64);
    const res = await axios.get(`${address}/state/${addr}`);
    if (debug) console.log(res.status, res.data);
    if (res.data.data.length) {
      const result = atob(res.data.data);
      if (debug) console.log(result);
      return result;
    }
  } catch (error) {
    return undefined;
  }
};

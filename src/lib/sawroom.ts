import { createHash } from 'crypto';

import axios from 'axios';
import cbor from 'borc';
import { protobuf } from 'sawtooth-sdk';
import { createContext, CryptoFactory } from 'sawtooth-sdk/signing';

type Payload = {
  readonly value: string;
  readonly address: string;
};

const PREFIX = 'c274b5';

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

export const store = async (
  payload: unknown,
  address = 'http://localhost:8008',
  debug?: boolean
) => {
  console.error(JSON.stringify(payload));
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
    return result[uid];
  }
  return [];
};

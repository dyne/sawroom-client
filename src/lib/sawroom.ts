import { createHash } from 'crypto';

import axios from 'axios';
import cbor from 'cbor';
import { protobuf } from 'sawtooth-sdk';
import { createContext, CryptoFactory } from 'sawtooth-sdk/signing';

type Payload = {
  readonly value: string;
  readonly timestamp: string;
};

const buildBatch = (payload: Payload) => {
  const context = createContext('secp256k1');
  const privateKey = context.newRandomPrivateKey();
  const signer = new CryptoFactory(context).newSigner(privateKey);
  const payloadBytes = cbor.encode(payload);

  const toU = (ba) => Buffer.from(ba, 'utf8');

  const transactionHeaderBytes = protobuf.TransactionHeader.encode({
    familyName: 'restroom',
    familyVersion: '1.0',
    inputs: ['c274b5'],
    outputs: ['c274b5'],
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
  address = 'http://localhost:8008'
) => {
  const ts = Date.now().toString();
  await axios.post(
    `${address}/batches`,
    buildBatch({
      value: JSON.stringify(payload),
      timestamp: ts,
    }),
    {
      headers: { 'Content-Type': 'application/octet-stream' },
    }
  );
  return ts;
};

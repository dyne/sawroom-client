import test from 'ava';

import { store } from './sawroom';

test('Not connected should broke', async (t) => {
  await t.throwsAsync(
    async () => {
      await store(42);
    },
    { instanceOf: Error, message: 'connect ECONNREFUSED 127.0.0.1:8008' }
  );
});

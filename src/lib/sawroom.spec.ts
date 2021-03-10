import test from 'ava';

import { store } from './sawroom';

test('should save numbers', async (t) => {
  const address = await store(42);
  t.is(13, address.length);
});

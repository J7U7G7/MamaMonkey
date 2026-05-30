import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAddonScript } from './helpers/load-addon-script.mjs';

const { createCommandDispatcher } = loadAddonScript('lib/commands.js');

function makeReq(command, args) {
  return JSON.stringify({ target: 'mamamonkey', command, args });
}

test('dispatches a sync handler and wraps the result', async () => {
  const d = createCommandDispatcher({ ping: () => ({ pong: true }) });
  const out = await d.handle(makeReq('ping'));
  assert.equal(out.handled, true);
  // Normalize through JSON in the host realm: the dispatcher builds objects in the
  // vm sandbox, whose Object.prototype differs from the test realm's (Node deepStrictEqual
  // compares prototypes). JSON round-trip is also exactly how responses cross the wire.
  assert.deepEqual(JSON.parse(JSON.stringify(out.response)), { ok: true, command: 'ping', result: { pong: true } });
});

test('awaits async handlers', async () => {
  const d = createCommandDispatcher({ play: () => Promise.resolve('started') });
  const out = await d.handle(makeReq('play'));
  assert.equal(out.response.ok, true);
  assert.equal(out.response.result, 'started');
});

test('passes args to the handler', async () => {
  const d = createCommandDispatcher({ setVolume: (a) => ({ v: a.value }) });
  const out = await d.handle(makeReq('setVolume', { value: 0.5 }));
  assert.equal(out.response.result.v, 0.5);
});

test('handler throwing becomes ok:false with the error', async () => {
  const d = createCommandDispatcher({ boom: () => { throw new Error('nope'); } });
  const out = await d.handle(makeReq('boom'));
  assert.equal(out.handled, true);
  assert.equal(out.response.ok, false);
  assert.match(out.response.error, /nope/);
});

test('unknown command is handled but ok:false', async () => {
  const d = createCommandDispatcher({});
  const out = await d.handle(makeReq('xyz'));
  assert.equal(out.handled, true);
  assert.equal(out.response.ok, false);
});

test('wrong target -> not handled (lets MM/others act)', async () => {
  const d = createCommandDispatcher({ ping: () => 1 });
  const out = await d.handle(JSON.stringify({ target: 'someoneElse', command: 'ping' }));
  assert.equal(out.handled, false);
});

test('invalid JSON -> not crashing, ok:false', async () => {
  const d = createCommandDispatcher({});
  const out = await d.handle('not json');
  assert.equal(out.response.ok, false);
});

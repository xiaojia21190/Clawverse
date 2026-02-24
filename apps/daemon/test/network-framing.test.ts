import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeLengthPrefixedFrame, readLengthPrefixedFrame } from '../src/network-framing.js';

test('encodeLengthPrefixedFrame/readLengthPrefixedFrame support complete frames', () => {
  const payload = Buffer.from('hello');
  const frame = encodeLengthPrefixedFrame(payload, 1024);
  const read = readLengthPrefixedFrame(frame, 1024);

  assert.equal(read.needsMore, false);
  assert.equal(read.invalidLength, undefined);
  assert.deepEqual(read.frame, payload);
  assert.equal(read.rest.length, 0);
});

test('readLengthPrefixedFrame handles sticky and split packets', () => {
  const firstPayload = Buffer.from('abc');
  const secondPayload = Buffer.from('xyz');
  const firstFrame = encodeLengthPrefixedFrame(firstPayload, 1024);
  const secondFrame = encodeLengthPrefixedFrame(secondPayload, 1024);

  const sticky = Buffer.concat([firstFrame, secondFrame]);
  const firstRead = readLengthPrefixedFrame(sticky, 1024);
  assert.deepEqual(firstRead.frame, firstPayload);
  assert.equal(firstRead.needsMore, false);
  assert.ok(firstRead.rest.length > 0);

  const secondRead = readLengthPrefixedFrame(firstRead.rest, 1024);
  assert.deepEqual(secondRead.frame, secondPayload);
  assert.equal(secondRead.needsMore, false);
  assert.equal(secondRead.rest.length, 0);

  const splitPart1 = firstFrame.subarray(0, 3);
  const splitPart2 = firstFrame.subarray(3);
  const splitRead1 = readLengthPrefixedFrame(splitPart1, 1024);
  assert.equal(splitRead1.frame, null);
  assert.equal(splitRead1.needsMore, true);

  const splitRead2 = readLengthPrefixedFrame(Buffer.concat([splitRead1.rest, splitPart2]), 1024);
  assert.deepEqual(splitRead2.frame, firstPayload);
  assert.equal(splitRead2.needsMore, false);
});

test('readLengthPrefixedFrame rejects invalid length', () => {
  const invalidHeader = Buffer.alloc(4);
  invalidHeader.writeUInt32BE(0, 0);
  const invalid = readLengthPrefixedFrame(invalidHeader, 1024);
  assert.equal(invalid.needsMore, false);
  assert.equal(invalid.invalidLength, 0);
  assert.equal(invalid.frame, null);
});

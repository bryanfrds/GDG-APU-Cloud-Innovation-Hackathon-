import { test } from "node:test";
import assert from "node:assert/strict";
import { wavHeader } from "./wav.mjs";

test("wavHeader describes 24 kHz 16-bit mono PCM", () => {
  const h = wavHeader(48000, 24000);
  assert.equal(h.length, 44);
  assert.equal(h.toString("ascii", 0, 4), "RIFF");
  assert.equal(h.readUInt32LE(4), 36 + 48000);
  assert.equal(h.toString("ascii", 8, 16), "WAVEfmt ");
  assert.equal(h.readUInt16LE(20), 1); // PCM
  assert.equal(h.readUInt16LE(22), 1); // mono
  assert.equal(h.readUInt32LE(24), 24000);
  assert.equal(h.readUInt32LE(28), 48000); // bytes per second
  assert.equal(h.readUInt16LE(34), 16);
  assert.equal(h.toString("ascii", 36, 40), "data");
  assert.equal(h.readUInt32LE(40), 48000);
});

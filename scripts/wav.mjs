// Builds the 44-byte header that turns raw 16-bit mono PCM into a playable WAV file.
export function wavHeader(dataLength, sampleRate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataLength, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); // fmt chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); // bytes per second
  h.writeUInt16LE(2, 32); // bytes per sample
  h.writeUInt16LE(16, 34); // bits per sample
  h.write("data", 36);
  h.writeUInt32LE(dataLength, 40);
  return h;
}

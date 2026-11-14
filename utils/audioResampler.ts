/**
 * Pure audio resampling & PCM16 encoding helpers for Voice Studio.
 * Handles hardware-native sample rates (44.1kHz, 48kHz, etc.) down to 16kHz PCM.
 */

export function resampleTo16kHz(inputData: Float32Array, inputSampleRate: number): Float32Array {
  if (!inputData || inputData.length === 0) {
    return new Float32Array(0);
  }
  const targetRate = 16000;
  if (!inputSampleRate || inputSampleRate === targetRate || inputSampleRate < targetRate) {
    return inputData;
  }

  const ratio = inputSampleRate / targetRate;
  const outputLength = Math.max(1, Math.floor(inputData.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const low = Math.floor(srcIndex);
    const high = Math.min(low + 1, inputData.length - 1);
    const weight = srcIndex - low;
    output[i] = inputData[low] * (1 - weight) + inputData[high] * weight;
  }

  return output;
}

export function floatTo16BitPcmBase64(float32Data: Float32Array): string {
  const len = float32Data.length;
  const int16 = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const clamped = Math.max(-1, Math.min(1, float32Data[i]));
    int16[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
  }

  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

export function calculateRmsVolume(samples: Float32Array): number {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * 밴드별 오디오 필터: 해당 주파수 대역만 남기고 나머지는 크게 감쇠.
 * BAND_HZ와 동일: low 20–200Hz, mid 200–3000Hz, high 3000–10000Hz.
 */

export type BandId = "low" | "mid" | "high";

const BAND_HZ: Record<BandId, { highpass: number; lowpass: number }> = {
  low: { highpass: 20, lowpass: 200 },
  mid: { highpass: 200, lowpass: 3000 },
  high: { highpass: 3000, lowpass: 10000 },
};

/** AudioBuffer → WAV Blob (모노/스테레오) */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const length = buffer.length * numCh * 2; // 16bit
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, length, true);

  const out = new Int16Array(arrayBuffer, 44);
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      out[i * numCh + c] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

/**
 * 오디오 URL을 해당 밴드만 남기고 필터링한 뒤 Blob URL로 반환.
 * (해당 주파수만 통과, 나머지는 크게 감쇠)
 */
export async function applyBandFilter(audioUrl: string, band: BandId): Promise<string> {
  const res = await fetch(audioUrl);
  const arrayBuffer = await res.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 44100 });
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const { sampleRate: sr, duration, numberOfChannels: numCh } = decoded;

  const offline = new OfflineAudioContext(numCh, Math.ceil(duration * sr), sr);
  const source = offline.createBufferSource();
  source.buffer = decoded;

  const { highpass: hpFreq, lowpass: lpFreq } = BAND_HZ[band];
  const hp = offline.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = hpFreq;
  hp.Q.value = 0.7;
  const lp = offline.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = lpFreq;
  lp.Q.value = 0.7;

  source.connect(hp);
  hp.connect(lp);
  lp.connect(offline.destination);

  source.start(0);
  const rendered = await offline.startRendering();
  const blob = audioBufferToWav(rendered);
  const blobUrl = URL.createObjectURL(blob);
  await ctx.close();
  return blobUrl;
}

/**
 * Audio bersama untuk modul yang memakai audio sumber / musik latar
 * (Video Face Enhance, Slideshow to Video):
 *
 * - `decodeAudioBuffer`: decode ArrayBuffer → AudioBuffer via
 *   OfflineAudioContext — BUKAN context playback: tidak perlu resume/gestur,
 *   tanpa warning autoplay, dan hasil AudioBuffer bersifat independen dari
 *   context, bisa diputar ulang oleh context playback mana pun.
 *
 * - `createSharedAudioState` + `resolveSharedAudioBuffer`: hasil decode
 *   di-cache sehingga SEMUA konsumen (indikator waveform, pratinjau, rekaman)
 *   menerima INSTANCE yang sama persis — decode hanya sekali, tanpa race.
 *   Mengganti objek state (reset saat file audio berubah) membuat decode yang
 *   masih berjalan menulis ke objek LAMA — hasilnya tidak bocor ke file baru.
 */

export interface SharedAudioState {
  buffer: AudioBuffer | null;
  promise: Promise<AudioBuffer | null> | null;
}

export function createSharedAudioState(): SharedAudioState {
  return { buffer: null, promise: null };
}

/**
 * Resolve AudioBuffer bersama dari `state`: hasil decode di-cache sehingga
 * pemanggilan berikutnya — dari jalur mana pun — menerima INSTANCE yang sama
 * persis (identitas, bukan salinan). `decode` dipanggil SEKALI; kegagalannya
 * di-cache juga (resolve null tanpa mengulang decode).
 */
export function resolveSharedAudioBuffer(
  state: SharedAudioState,
  decode: () => Promise<AudioBuffer | null>
): Promise<AudioBuffer | null> {
  if (state.buffer) return Promise.resolve(state.buffer);
  if (!state.promise) {
    state.promise = decode().then((b) => {
      state.buffer = b;
      return b;
    });
  }
  return state.promise;
}

/**
 * Decode audio menjadi AudioBuffer via OfflineAudioContext — independen dari
 * context playback (aman dipanggil tanpa gestur; hasil bisa diputar ulang oleh
 * context mana pun). `null` bila tak didukung / decode gagal.
 */
export function decodeAudioBuffer(arrayBuf: ArrayBuffer): Promise<AudioBuffer | null> {
  const Ctor =
    window.OfflineAudioContext ??
    (window as unknown as {
      webkitOfflineAudioContext?: typeof OfflineAudioContext;
    }).webkitOfflineAudioContext;
  if (!Ctor) return Promise.resolve(null);
  try {
    const ctx = new Ctor(1, 1, 44100);
    return ctx
      .decodeAudioData(arrayBuf.slice(0))
      .then((b) => b as AudioBuffer)
      .catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

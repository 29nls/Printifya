import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordWithAudio } from "./recordWithAudio";

// --- Fake DOM media (vitest berjalan di Node tanpa DOM) ---

class FakeTrack {
  kind: string;
  stop = vi.fn();
  constructor(kind: string) {
    this.kind = kind;
  }
}

class FakeStream {
  tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getTracks() {
    return this.tracks;
  }
}

let throwOnAudioMuxing = false;
class FakeMediaRecorder {
  stream: FakeStream;
  opts: Record<string, unknown>;
  static isTypeSupported = () => true;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(function (this: FakeMediaRecorder) {
    this.onstop?.();
  });
  constructor(stream: FakeStream, opts: Record<string, unknown>) {
    if (throwOnAudioMuxing && stream.getAudioTracks().length > 0) {
      throw new Error("muxing audio+video tidak didukung");
    }
    this.stream = stream;
    this.opts = opts;
  }
}

class FakeMediaStreamAudioDestinationNode {
  stream: FakeStream;
  constructor() {
    this.stream = new FakeStream([new FakeTrack("audio")]);
  }
}

/** AudioContext + BufferSource palsu yang dipakai opsi `audio`. */
function fakeAudioContext() {
  const source = {
    buffer: null as unknown,
    loop: false,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  return {
    context: {
      createBufferSource: () => source,
    } as unknown as AudioContext,
    source,
  };
}

function fakeCanvas() {
  return {
    captureStream: vi.fn(
      () => new FakeStream([new FakeTrack("video")])
    ),
  } as unknown as HTMLCanvasElement;
}

/** Akses field FakeMediaRecorder lewat cast (stub global tidak memengaruhi tipe DOM). */
const asFake = (rec: { recorder: MediaRecorder }) =>
  rec.recorder as unknown as FakeMediaRecorder;

beforeEach(() => {
  throwOnAudioMuxing = false;
  vi.stubGlobal("MediaStream", FakeStream);
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("MediaStreamAudioDestinationNode", FakeMediaStreamAudioDestinationNode);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recordWithAudio — rekam canvas dengan audio opsional", () => {
  it("tanpa audio → stream canvas (video saja), opsi MediaRecorder sesuai", () => {
    const canvas = fakeCanvas();
    const rec = recordWithAudio({ canvas, fps: 15, mimeType: "video/webm" });
    expect(rec.stream.getVideoTracks()).toHaveLength(1);
    expect(rec.stream.getAudioTracks()).toHaveLength(0);
    expect(canvas.captureStream).toHaveBeenCalledWith(15);
    expect(asFake(rec).opts).toMatchObject({
      mimeType: "video/webm",
      videoBitsPerSecond: 8_000_000,
    });
    expect(asFake(rec).start).toHaveBeenCalled();
  });

  it("dengan audio → BufferSource dimulai & track audio digabung ke stream", () => {
    const { context, source } = fakeAudioContext();
    const rec = recordWithAudio({
      canvas: fakeCanvas(),
      fps: 15,
      mimeType: "video/webm",
      audio: { context, buffer: {} as AudioBuffer },
    });
    expect(source.connect).toHaveBeenCalled();
    expect(source.start).toHaveBeenCalled();
    // Default loop = false (video: satu putaran audio sumber).
    expect(source.loop).toBe(false);
    expect(rec.stream.getAudioTracks()).toHaveLength(1);
    expect(rec.stream.getVideoTracks()).toHaveLength(1);
  });

  it("loop: true → BufferSource diputar berulang (musik latar)", () => {
    const { context, source } = fakeAudioContext();
    recordWithAudio({
      canvas: fakeCanvas(),
      fps: 15,
      mimeType: "video/webm",
      audio: { context, buffer: {} as AudioBuffer, loop: true },
    });
    expect(source.loop).toBe(true);
  });

  it("muxing audio+video gagal → fallback otomatis ke video saja", () => {
    throwOnAudioMuxing = true;
    const { context, source } = fakeAudioContext();
    const rec = recordWithAudio({
      canvas: fakeCanvas(),
      fps: 15,
      mimeType: "video/mp4",
      audio: { context, buffer: {} as AudioBuffer },
    });
    // Audio tetap dicoba (BufferSource start), tapi recorder memakai video saja.
    expect(source.start).toHaveBeenCalled();
    expect(rec.stream.getAudioTracks()).toHaveLength(0);
    expect(rec.stream.getVideoTracks()).toHaveLength(1);
    expect(asFake(rec).opts).toMatchObject({ mimeType: "video/mp4" });
  });

  it("audio gagal dibuat (context rusak) → tetap rekam tanpa audio", () => {
    const bad = {
      createBufferSource: () => {
        throw new Error("no source");
      },
    } as unknown as AudioContext;
    const rec = recordWithAudio({
      canvas: fakeCanvas(),
      fps: 15,
      mimeType: "video/webm",
      audio: { context: bad, buffer: {} as AudioBuffer },
    });
    expect(rec.stream.getAudioTracks()).toHaveLength(0);
    expect(rec.stream.getVideoTracks()).toHaveLength(1);
  });

  it("stop() mengumpulkan chunk, mengembalikan Blob, dan menghentikan track", async () => {
    const rec = recordWithAudio({ canvas: fakeCanvas(), fps: 15, mimeType: "video/webm" });
    // Simulasi chunk data yang masuk selama perekaman.
    const emitChunk = (data: string) =>
      asFake(rec).ondataavailable?.({
        data: new Blob([data]),
      } as unknown as BlobEvent);
    emitChunk("chunk-a");
    emitChunk("chunk-b");

    const blob = await rec.stop();
    expect(asFake(rec).stop).toHaveBeenCalled();
    expect(blob.type).toBe("video/webm");
    expect(await blob.text()).toBe("chunk-achunk-b");
    for (const t of rec.stream.getTracks()) {
      expect(t.stop).toHaveBeenCalled();
    }
  });

  it("stop() aman dipanggil dua kali (recorder sudah berhenti)", async () => {
    const rec = recordWithAudio({ canvas: fakeCanvas(), fps: 15, mimeType: "video/webm" });
    await rec.stop();
    await expect(rec.stop()).resolves.toBeInstanceOf(Blob);
  });
});

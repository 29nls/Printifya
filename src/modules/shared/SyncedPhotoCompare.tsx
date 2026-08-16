/**
 * Perbandingan sebelum/sesudah foto dengan zoom/pan tersinkron — padanan
 * foto untuk kontrol "Putar Keduanya (Sinkron)" di Video Face Enhance (foto
 * tidak punya audio, jadi yang disinkronkan adalah tampilan gambar/zoom).
 *
 * Dua viewport (sebelum = <img>, sesudah = <canvas> yang digambar dari kanvas
 * hasil olahan). Interaksi: roda mouse / tombol 🔍 memperbesar di sekitar
 * kursor (atau pusat viewport), seret untuk menggeser. Saat sinkron AKTIF
 * (default), kedua sisi selalu menampilkan region yang sama; tombol
 * "Putar Keduanya (Sinkron)" mematikannya agar tiap sisi bisa diperiksa
 * terpisah. Tombol mute ditampilkan nonaktif (foto tanpa audio) demi paritas
 * kontrol dengan modul video.
 */
import { useEffect, useRef, useState } from "react";
import "./syncedCompare.css";

interface View {
  zoom: number;
  ox: number;
  oy: number;
}

const VIEW_IDLE: View = { zoom: 1, ox: 0, oy: 0 };
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const WHEEL_FACTOR = 1.25;

export interface SyncedPhotoCompareProps {
  before: { label: string; src: string };
  after: { label: string; canvas: HTMLCanvasElement | null };
}

export default function SyncedPhotoCompare({
  before,
  after,
}: SyncedPhotoCompareProps) {
  /** Sinkronisasi zoom/pan: ON = kedua sisi selalu menampilkan region sama. */
  const [linked, setLinked] = useState(true);
  const [viewA, setViewA] = useState<View>(VIEW_IDLE);
  const [viewB, setViewB] = useState<View>(VIEW_IDLE);
  const [dragging, setDragging] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef<{
    side: "a" | "b";
    startX: number;
    startY: number;
    view: View;
  } | null>(null);
  // Handler wheel selalu menunjuk ke state terbaru (view/linked) — dipanggil
  // dari listener native non-passive agar preventDefault mencegah scroll
  // halaman (React memasang wheel sebagai passive → preventDefault ditolak).
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});

  const view = (side: "a" | "b"): View => (side === "a" ? viewA : viewB);
  const media = (side: "a" | "b") =>
    side === "a" ? imgRef.current : canvasRef.current;

  /** Batasi pan agar gambar selalu menutupi viewport (tanpa area kosong). */
  const clampView = (side: "a" | "b", v: View): View => {
    const el = media(side);
    const vp = el?.parentElement;
    if (!el || !vp) return v;
    const dispW = el.offsetWidth * v.zoom;
    const dispH = el.offsetHeight * v.zoom;
    const ox =
      dispW > vp.clientWidth
        ? Math.min(0, Math.max(vp.clientWidth - dispW, v.ox))
        : 0;
    const oy =
      dispH > vp.clientHeight
        ? Math.min(0, Math.max(vp.clientHeight - dispH, v.oy))
        : 0;
    return { ...v, ox, oy };
  };

  /** Set tampilan satu sisi; bila sinkron, kedua sisi ikut. */
  const apply = (side: "a" | "b", next: View) => {
    const clamped = clampView(side, next);
    if (linked) {
      setViewA(clamped);
      setViewB(clamped);
    } else if (side === "a") {
      setViewA(clamped);
    } else {
      setViewB(clamped);
    }
  };

  const onWheel = (side: "a" | "b") => (e: WheelEvent) => {
    const el = media(side);
    const vp = el?.parentElement;
    if (!el || !vp) return;
    const cur = view(side);
    const factor = e.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cur.zoom * factor));
    // Perbesar di sekitar kursor: titik gambar di bawah kursor tetap diam.
    const rect = vp.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    apply(side, {
      zoom,
      ox: px - ((px - cur.ox) * zoom) / cur.zoom,
      oy: py - ((py - cur.oy) * zoom) / cur.zoom,
    });
  };

  // Pasang listener wheel native dengan passive:false pada kedua viewport
  // (sekali saat mount) — preventDefault di sini mencegah scroll halaman saat
  // zoom; logika zoom membaca handler terbaru lewat wheelRef.
  useEffect(() => {
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      wheelRef.current(e);
    };
    const vps = viewportRefs.current.filter(Boolean) as HTMLDivElement[];
    for (const vp of vps) {
      vp.addEventListener("wheel", onWheelNative, { passive: false });
    }
    return () => {
      for (const vp of vps) {
        vp.removeEventListener("wheel", onWheelNative);
      }
    };
  }, []);
  wheelRef.current = (e) => {
    const side = e.currentTarget === viewportRefs.current[1] ? "b" : "a";
    onWheel(side)(e);
  };

  const onPointerDown = (side: "a" | "b") => (e: React.PointerEvent) => {
    const el = media(side);
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    dragRef.current = {
      side,
      startX: e.clientX,
      startY: e.clientY,
      view: view(side),
    };
    setDragging(true);
  };

  const onPointerMove = (side: "a" | "b") => (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.side !== side) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    apply(side, { ...d.view, ox: d.view.ox + dx, oy: d.view.oy + dy });
  };

  const onPointerUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  /** Perbesar/kecilkan sisi A di sekitar pusat viewportnya (tombol 🔍). */
  const zoomBy = (dir: 1 | -1) => {
    const cur = viewA;
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, cur.zoom * (dir > 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR))
    );
    const vp = imgRef.current?.parentElement;
    const rect = vp?.getBoundingClientRect();
    if (!vp || !rect) {
      apply("a", { ...cur, zoom });
      return;
    }
    const px = rect.width / 2;
    const py = rect.height / 2;
    apply("a", {
      zoom,
      ox: px - ((px - cur.ox) * zoom) / cur.zoom,
      oy: py - ((py - cur.oy) * zoom) / cur.zoom,
    });
  };

  const toggleLinked = () => {
    const next = !linked;
    // Saat sinkron diaktifkan kembali, kedua sisi mengikuti master (sisi A).
    if (next) setViewB(viewA);
    setLinked(next);
  };

  const resetView = () => {
    setViewA(VIEW_IDLE);
    setViewB(VIEW_IDLE);
  };

  // Gambar ulang kanvas "sesudah" setiap kali hasil olahan berubah.
  useEffect(() => {
    const el = canvasRef.current;
    if (el && after.canvas) {
      el.width = after.canvas.width;
      el.height = after.canvas.height;
      el.getContext("2d")?.drawImage(after.canvas, 0, 0);
    }
  }, [after.canvas]);

  return (
    <div className="sc-compare">
      {(["a", "b"] as const).map((side) => {
        const isA = side === "a";
        return (
          <figure key={side} className="sc-side">
            <figcaption>{isA ? before.label : after.label}</figcaption>
            <div
              className={dragging ? "sc-viewport dragging" : "sc-viewport"}
              ref={(el) => {
                viewportRefs.current[side === "a" ? 0 : 1] = el;
              }}
              onPointerDown={onPointerDown(side)}
              onPointerMove={onPointerMove(side)}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {isA ? (
                <img
                  ref={imgRef}
                  src={before.src}
                  alt={before.label}
                  className="sc-media"
                  draggable={false}
                  style={{
                    transform: `translate(${viewA.ox}px, ${viewA.oy}px) scale(${viewA.zoom})`,
                  }}
                />
              ) : after.canvas ? (
                <canvas
                  ref={canvasRef}
                  className="sc-media"
                  style={{
                    transform: `translate(${viewB.ox}px, ${viewB.oy}px) scale(${viewB.zoom})`,
                  }}
                />
              ) : null}
            </div>
          </figure>
        );
      })}
      <div className="sc-controls">
        <button
          type="button"
          className={linked ? "btn btn-primary active" : "btn"}
          onClick={toggleLinked}
          title={
            linked
              ? "Sinkron aktif — zoom/pan kedua gambar mengikuti satu sama lain. Klik untuk memeriksa tiap sisi secara terpisah."
              : "Sinkron nonaktif — tiap sisi bisa di-zoom/digeser sendiri. Klik untuk menyinkronkan kembali (master = sisi kiri)."
          }
        >
          🔗 Putar Keduanya (Sinkron)
        </button>
        <button
          type="button"
          className="btn"
          disabled
          title="Foto tanpa audio — kontrol mute hanya berlaku untuk video (Video Face Enhance)."
        >
          🔊 Bisukan
        </button>
        <button type="button" className="btn" onClick={resetView}>
          ↺ Reset Tampilan
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => zoomBy(-1)}
          title="Perkecil"
        >
          🔍 −
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => zoomBy(1)}
          title="Perbesar"
        >
          🔍 +
        </button>
        <span className="sc-zoom-badge">{Math.round(viewA.zoom * 100)}%</span>
      </div>
      <p className="hint sc-hint">
        💡 Foto tanpa audio — "Putar Keduanya" menyinkronkan{" "}
        <strong>zoom/pan</strong>: roda mouse atau tombol 🔍 memperbesar di
        sekitar kursor, seret gambar untuk menggeser — gambar lain mengikuti
        saat sinkron aktif. Matikan sinkron untuk memeriksa area berbeda di
        tiap sisi.
      </p>
    </div>
  );
}

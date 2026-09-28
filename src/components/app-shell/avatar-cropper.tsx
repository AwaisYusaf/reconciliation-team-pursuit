"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/src/components/ui/button";
import { Modal } from "@/src/components/ui/modal";

/**
 * Square crop, chosen before upload.
 *
 * The cropped square is what gets stored, rather than storing the original plus an
 * `object-position`. Two reasons: every place that shows the avatar then renders the same
 * picture without having to be told how to frame it, and the object in storage is a small
 * square instead of whatever came off a phone camera.
 *
 * Drag to move, slider to zoom. Pointer events rather than mouse or touch handlers, so one
 * set of code covers mouse, trackpad, pen and finger.
 */

/** The stored avatar's edge length. Large enough for a retina 64px control, small enough to stay tiny. */
const OUTPUT_PX = 512;

/** The on-screen crop window. */
const VIEW_PX = 260;

export type CropResult = { blob: Blob; type: string };

export function AvatarCropper({
  open,
  file,
  onCancel,
  onDone,
}: {
  open: boolean;
  file: File;
  onCancel: () => void;
  onDone: (result: CropResult) => void;
}) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [working, setWorking] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: ImageBitmap | null = null;

    // `imageOrientation: "from-image"` applies the EXIF rotation. Without it a photo taken in
    // portrait on a phone draws to the canvas sideways, because the orientation tag is
    // honoured when an <img> renders but not when raw pixels are decoded.
    createImageBitmap(file, { imageOrientation: "from-image" })
      .then((result) => {
        if (cancelled) {
          result.close();
          return;
        }
        created = result;
        setBitmap(result);
      })
      .catch(() => {
        if (!cancelled) setError("That image couldn't be opened. Try a different file.");
      });

    return () => {
      cancelled = true;
      created?.close();
    };
  }, [file]);

  /**
   * The scale at which the image exactly covers the crop window.
   *
   * Everything is expressed as a multiple of this rather than in raw pixels, so `zoom = 1`
   * always means "just covers" whatever the source dimensions are, and the image can never be
   * zoomed out far enough to show a gap.
   */
  const baseScale = bitmap ? Math.max(VIEW_PX / bitmap.width, VIEW_PX / bitmap.height) : 1;
  const scale = baseScale * zoom;
  const drawnWidth = bitmap ? bitmap.width * scale : 0;
  const drawnHeight = bitmap ? bitmap.height * scale : 0;

  /** Keep the crop window covered: the image may not be dragged past its own edges. */
  const clamp = useCallback(
    (next: { x: number; y: number }) => {
      const maxX = Math.max(0, (drawnWidth - VIEW_PX) / 2);
      const maxY = Math.max(0, (drawnHeight - VIEW_PX) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y)),
      };
    },
    [drawnWidth, drawnHeight],
  );

  /**
   * The offset actually used, clamped during render rather than corrected in an effect.
   *
   * Zooming out shrinks the allowed range, which can leave the stored offset outside it. An
   * effect that wrote a corrected value back would render one frame of the wrong crop first
   * and cost a second render to fix it; deriving it means the invalid state is never shown.
   * `offset` stays the raw value the drag produced, so zooming back in restores the framing
   * instead of keeping it pinned where a clamp once pushed it.
   */
  const view = clamp(offset);

  async function confirm() {
    if (!bitmap) return;
    setWorking(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_PX;
      canvas.height = OUTPUT_PX;
      const context = canvas.getContext("2d");
      if (!context) {
        setError("This browser couldn't prepare the image.");
        return;
      }

      // White underneath: the output is JPEG, which has no alpha, and a transparent PNG drawn
      // straight onto an empty canvas would come out with black where it was see-through.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, OUTPUT_PX, OUTPUT_PX);

      // The on-screen transform, scaled up from the preview to the output size.
      const ratio = OUTPUT_PX / VIEW_PX;
      const width = drawnWidth * ratio;
      const height = drawnHeight * ratio;
      const x = OUTPUT_PX / 2 - width / 2 + view.x * ratio;
      const y = OUTPUT_PX / 2 - height / 2 + view.y * ratio;
      context.drawImage(bitmap, x, y, width, height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9),
      );
      if (!blob) {
        setError("This browser couldn't prepare the image.");
        return;
      }
      onDone({ blob, type: "image/jpeg" });
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal open={open} title="Position your photo" onClose={onCancel} size="md" dismissDisabled={working}>
      <div className="flex flex-col items-center gap-4">
        {error ? (
          <p className="text-[15px] text-danger m-0">{error}</p>
        ) : (
          <>
            {/*
              The circle is a ring drawn over the image, not a clip on it: the person needs to
              see the parts that fall outside the crop to know what they are cutting off.
            */}
            <div
              className="relative overflow-hidden rounded-[10px] bg-section touch-none cursor-grab active:cursor-grabbing"
              style={{ width: VIEW_PX, height: VIEW_PX }}
              onPointerDown={(event) => {
                if (!bitmap) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = {
                  x: event.clientX,
                  y: event.clientY,
                  ox: view.x,
                  oy: view.y,
                };
              }}
              onPointerMove={(event) => {
                const start = dragRef.current;
                if (!start) return;
                setOffset({
                  x: start.ox + (event.clientX - start.x),
                  y: start.oy + (event.clientY - start.y),
                });
              }}
              onPointerUp={() => {
                dragRef.current = null;
              }}
              onPointerCancel={() => {
                dragRef.current = null;
              }}
            >
              {bitmap && (
                <canvas
                  ref={(node) => {
                    if (!node) return;
                    node.width = VIEW_PX;
                    node.height = VIEW_PX;
                    const context = node.getContext("2d");
                    if (!context) return;
                    context.clearRect(0, 0, VIEW_PX, VIEW_PX);
                    context.drawImage(
                      bitmap,
                      VIEW_PX / 2 - drawnWidth / 2 + view.x,
                      VIEW_PX / 2 - drawnHeight / 2 + view.y,
                      drawnWidth,
                      drawnHeight,
                    );
                  }}
                  className="block"
                />
              )}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-full border-2 border-surface"
                style={{ boxShadow: "0 0 0 9999px rgba(33, 27, 22, 0.45)" }}
              />
            </div>

            <label className="w-full max-w-[260px]">
              <span className="block text-[13px] font-bold text-sub mb-1.5">Zoom</span>
              <input
                type="range"
                min={1}
                max={4}
                step={0.01}
                value={zoom}
                disabled={!bitmap}
                onChange={(event) => setZoom(Number(event.target.value))}
                className="w-full accent-[var(--color-accent)]"
              />
            </label>

            <p className="text-[13px] text-sub text-center m-0">
              Drag the photo to move it, and use the slider to zoom.
            </p>
          </>
        )}

        <div className="flex flex-wrap justify-end gap-2.5 w-full">
          <Button variant="quiet" onClick={onCancel} disabled={working}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!bitmap || working || Boolean(error)}>
            {working ? "Saving…" : "Save photo"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

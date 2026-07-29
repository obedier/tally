import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Sheet } from "../ui/Sheet";
import { acceptScannedCode, classifyCameraError, type CameraFailure } from "../../lib/scan";
import "./scan.css";

interface ScanSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called with a verified product code. The sheet closes itself first. */
  onCode: (code: string) => void;
}

const FAILURE_COPY: Record<CameraFailure, { title: string; detail: string }> = {
  denied: {
    title: "Camera access is off",
    detail: "Allow camera access for Tally in Settings, then try again. Or type the code below.",
  },
  "no-camera": {
    title: "No camera available",
    detail: "This device has no camera the browser can use. Type the code below instead.",
  },
  insecure: {
    title: "Camera needs a secure connection",
    detail: "Scanning works over https. Type the code below instead.",
  },
  unavailable: {
    title: "Couldn't start the camera",
    detail: "Another app may be using it. Try again, or type the code below.",
  },
};

/**
 * Camera scanner for product barcodes (UPC/EAN/Code-128 and friends).
 *
 * The decoder is loaded on demand — it is ~200KB that nobody who never scans
 * should pay for. Manual entry sits under the viewfinder at all times, so the
 * feature is never a dead end when the camera is missing, blocked, or the label
 * is too worn to read.
 */
export function ScanSheet({ open, onClose, onCode }: ScanSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const [starting, setStarting] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [typed, setTyped] = useState("");
  const [attempt, setAttempt] = useState(0);

  // Held in a ref, not state: the accept path must be able to stop the camera
  // synchronously, and a re-render is not guaranteed before the sheet unmounts.
  const stopRef = useRef<(() => void) | null>(null);

  const accept = useCallback(
    (code: string) => {
      stopRef.current?.();
      stopRef.current = null;
      onCode(code);
    },
    [onCode],
  );

  useEffect(() => {
    if (!open) return;
    if (typeof navigator === "undefined" || navigator.mediaDevices === undefined) {
      // A missing mediaDevices almost always means a non-secure origin; the
      // native shell and https both have it.
      setFailure(window.isSecureContext === false ? "insecure" : "no-camera");
      return;
    }

    let cancelled = false;
    setFailure(null);
    setStarting(true);

    void (async () => {
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        // Restricting formats cuts misreads: an unconstrained reader will happily
        // decode noise as a Data Matrix.
        const hints = new Map<number, unknown>([
          [
            DecodeHintType.POSSIBLE_FORMATS,
            [
              BarcodeFormat.EAN_13,
              BarcodeFormat.EAN_8,
              BarcodeFormat.UPC_A,
              BarcodeFormat.UPC_E,
              BarcodeFormat.CODE_128,
              BarcodeFormat.CODE_39,
              BarcodeFormat.ITF,
              BarcodeFormat.QR_CODE,
            ],
          ],
        ]);
        const reader = new BrowserMultiFormatReader(hints as never);
        const video = videoRef.current;
        if (video === null || cancelled) return;

        const controls = await reader.decodeFromConstraints(
          // `ideal`, not `exact`: a laptop with only a front camera should still
          // scan rather than fail outright.
          { video: { facingMode: { ideal: "environment" } } },
          video,
          (result) => {
            if (result === undefined || result === null) return;
            const code = acceptScannedCode(result.getText());
            // A rejected decode is a misread or a non-product code — keep the
            // camera running and say so rather than researching the wrong thing.
            if (code === null) {
              setRejected(true);
              return;
            }
            accept(code);
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        stopRef.current = () => controls.stop();
        setStarting(false);
      } catch (error) {
        if (cancelled) return;
        setStarting(false);
        setFailure(classifyCameraError(error));
      }
    })();

    return () => {
      cancelled = true;
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [open, attempt, accept]);

  const onManualSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = acceptScannedCode(typed);
    if (code === null) {
      setRejected(true);
      return;
    }
    accept(code);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Scan a product code"
      description="Point the camera at the barcode on the product or its box."
    >
      <div className="scan">
        {failure === null ? (
          <div className="scan__viewfinder">
            <video ref={videoRef} className="scan__video" muted playsInline />
            <div className="scan__frame" aria-hidden="true" />
            <p className="scan__status" role="status">
              {starting ? "Starting camera…" : "Hold the barcode inside the frame"}
            </p>
          </div>
        ) : (
          <div className="scan__failure" role="status">
            <p className="scan__failure-title">{FAILURE_COPY[failure].title}</p>
            <p className="small-copy">{FAILURE_COPY[failure].detail}</p>
            {failure !== "insecure" && failure !== "no-camera" ? (
              <button
                type="button"
                className="button-quiet scan__retry"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Try the camera again
              </button>
            ) : null}
          </div>
        )}

        <form className="scan__manual" onSubmit={onManualSubmit}>
          <label className="micro-copy scan__manual-label" htmlFor="scan-code">
            Or type the code
          </label>
          <div className="scan__manual-row">
            <input
              id="scan-code"
              className="scan__manual-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={typed}
              placeholder="UPC, EAN, or SKU"
              maxLength={48}
              onChange={(event) => {
                setTyped(event.target.value);
                setRejected(false);
              }}
            />
            <button type="submit" className="button-primary scan__manual-go" disabled={typed.trim() === ""}>
              Research
            </button>
          </div>
          {rejected ? (
            <p className="micro-copy scan__rejected" role="alert">
              That doesn't look like a valid product code. Check the digits and try again.
            </p>
          ) : null}
        </form>
      </div>
    </Sheet>
  );
}

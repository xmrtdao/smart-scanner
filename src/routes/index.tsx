import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, Trash2, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { detectItems, identifyItem, researchPrices } from "@/lib/scan.functions";
import {
  loadScans,
  money,
  profit,
  roi,
  saveScans,
  score,
  verdict,
  type LiveItem,
  type Scan,
} from "@/lib/thrift";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Thrifty Picker — Live Camera Resale Scanner" },
      {
        name: "description",
        content:
          "Point your phone at a shelf. Thrifty Picker spots every item live, values it, and ranks the best flips in real time.",
      },
      { property: "og:title", content: "Thrifty Picker — Live Camera Resale Scanner" },
      {
        property: "og:description",
        content:
          "Live camera scanning that identifies secondhand items, estimates resale value, and ranks the best buys.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const toneClass = {
  buy: "bg-primary text-primary-foreground",
  maybe: "bg-amber-400 text-neutral-900",
  pass: "bg-destructive text-destructive-foreground",
};

const rankColor = (i: number) =>
  i === 0 ? "border-primary" : i === 1 ? "border-amber-300" : "border-white/60";

function Index() {
  const detect = useServerFn(detectItems);
  const identify = useServerFn(identifyItem);
  const research = useServerFn(researchPrices);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef(true);
  const inflight = useRef(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    setScans(loadScans());
  }, []);

  const persist = useCallback((next: Scan[]) => {
    setScans(next);
    saveScans(next);
  }, []);

  const grabFrame = useCallback((max = 768) => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  }, []);

  // Auto-start the rear camera and keep a detection loop running.
  useEffect(() => {
    let cancelled = false;
    loopRef.current = true;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        void tick();
      } catch {
        if (!cancelled) setCameraError("Camera access is blocked. Allow the camera to start scanning.");
      }
    };

    const tick = async () => {
      while (loopRef.current && !cancelled) {
        if (!pausedRef.current && !inflight.current) {
          const frame = grabFrame();
          if (frame) {
            inflight.current = true;
            setScanning(true);
            try {
              const out = await detect({ data: { image: frame } });
              if (!cancelled) setLive(out.items ?? []);
            } catch {
              /* keep the loop alive on transient failures */
            } finally {
              inflight.current = false;
              if (!cancelled) setScanning(false);
            }
          }
        }
        await new Promise((r) => setTimeout(r, 900));
      }
    };

    void start();
    return () => {
      cancelled = true;
      loopRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [detect, grabFrame]);

  const ranked = [...live].sort((a, b) => (b.estValue || 0) - (a.estValue || 0));

  const appraise = async (item: LiveItem) => {
    const image = grabFrame(1024);
    if (!image) return;
    pausedRef.current = true;
    setBusy(`Appraising ${item.label}…`);
    try {
      const identification = await identify({ data: { image, hint: `Focus on: ${item.label}` } });
      setBusy(`Researching prices for ${identification.name}…`);
      const result = await research({
        data: {
          name: identification.name,
          brand: identification.brand,
          category: identification.category,
          condition: identification.condition,
          keywords: identification.keywords ?? [],
          askingPrice: 0,
        },
      });
      const scan: Scan = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        image,
        askingPrice: 0,
        identification,
        research: result,
      };
      persist([scan, ...scans]);
      setSelected(scan.id);
      setShowList(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
      pausedRef.current = false;
    }
  };

  const current = scans.find((s) => s.id === selected) ?? null;

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      <Toaster position="top-center" />

      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 size-full object-cover"
        aria-label="Live camera"
      />

      {/* Detection overlay */}
      <div className="pointer-events-none absolute inset-0">
        {ranked.map((item, i) => {
          const [x, y, w, h] = item.bbox as [number, number, number, number];
          return (
            <button
              key={`${item.label}-${i}`}
              onClick={() => void appraise(item)}
              className={`pointer-events-auto absolute rounded-lg border-2 ${rankColor(i)} bg-white/5`}
              style={{
                left: `${Math.max(0, x) * 100}%`,
                top: `${Math.max(0, y) * 100}%`,
                width: `${Math.min(1, w) * 100}%`,
                height: `${Math.min(1, h) * 100}%`,
              }}
              aria-label={`Appraise ${item.label}`}
            >
              <span className="absolute -top-6 left-0 flex max-w-[80vw] items-center gap-1 rounded-md bg-black/75 px-2 py-0.5 text-[11px] font-semibold">
                <span className="rounded bg-primary px-1 text-primary-foreground">#{i + 1}</span>
                <span className="truncate">{item.label}</span>
                <span className="text-primary">{money(item.estValue || 0)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Top bar */}
      <header className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-4">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Zap className="size-4" />
          </span>
          <div>
            <h1 className="font-display text-base leading-none tracking-tight">Thrifty Picker</h1>
            <p className="text-[11px] text-white/70">
              {scanning ? "Scanning…" : `${live.length} item${live.length === 1 ? "" : "s"} in view`}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowList(true)}
          className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold backdrop-blur"
        >
          {scans.length} saved
        </button>
      </header>

      {/* Ranking strip */}
      {ranked.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-5 pt-10">
          <p className="mb-2 text-[10px] uppercase tracking-widest text-white/60">
            Best value first — tap for a full appraisal
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {ranked.map((item, i) => (
              <button
                key={`strip-${i}`}
                onClick={() => void appraise(item)}
                className="min-w-40 shrink-0 rounded-xl border border-white/15 bg-black/60 p-2 text-left backdrop-blur"
              >
                <div className="flex items-center gap-1 text-[10px] text-white/60">
                  <span className="rounded bg-primary px-1 font-bold text-primary-foreground">
                    #{i + 1}
                  </span>
                  {Math.round((item.confidence || 0) * 100)}% sure
                </div>
                <div className="mt-1 truncate text-sm font-semibold">{item.label}</div>
                <div className="text-xs text-primary">{money(item.estValue || 0)}</div>
                <div className="truncate text-[10px] text-white/60">{item.note}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {cameraError && (
        <div className="absolute inset-0 grid place-items-center bg-black/85 px-8 text-center text-sm">
          <div className="space-y-3">
            <Camera className="mx-auto size-8" />
            <p>{cameraError}</p>
          </div>
        </div>
      )}

      {busy && (
        <div className="absolute inset-0 grid place-items-center bg-black/70 text-center text-sm">
          <div className="space-y-3">
            <Loader2 className="mx-auto size-7 animate-spin" />
            <p>{busy}</p>
          </div>
        </div>
      )}

      {showList && (
        <SavedSheet
          scans={scans}
          current={current}
          onSelect={setSelected}
          onClose={() => setShowList(false)}
          onDelete={(id) => {
            persist(scans.filter((s) => s.id !== id));
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

function SavedSheet({
  scans,
  current,
  onSelect,
  onClose,
  onDelete,
}: {
  scans: Scan[];
  current: Scan | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const ranked = [...scans].sort((a, b) => score(b) - score(a));
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background/95 text-foreground backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-display text-lg">Saved finds</h2>
        <button onClick={onClose} aria-label="Back to camera" className="grid size-9 place-items-center rounded-lg border border-input">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {current && <Detail scan={current} onDelete={() => onDelete(current.id)} />}
        {ranked.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing saved yet — tap an item on the camera.</p>
        )}
        <ul className="space-y-2">
          {ranked.map((s) => {
            const v = verdict(s);
            return (
              <li key={s.id}>
                <button
                  onClick={() => onSelect(s.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left ${
                    current?.id === s.id ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <img src={s.image} alt="" className="size-12 rounded-lg object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.identification.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      List ~{money(s.research.suggestedListPrice)}
                    </span>
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${toneClass[v.tone]}`}>
                    {v.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Detail({ scan, onDelete }: { scan: Scan; onDelete: () => void }) {
  const v = verdict(scan);
  const r = scan.research;

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${toneClass[v.tone]}`}>
            {v.label}
          </span>
          <h3 className="mt-2 font-display text-xl leading-tight">{scan.identification.name}</h3>
          <p className="text-sm text-muted-foreground">
            {[scan.identification.brand, scan.identification.category, scan.identification.condition]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <button
          onClick={onDelete}
          aria-label="Delete find"
          className="grid size-9 place-items-center rounded-lg border border-input"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Sold low" value={money(r.lowPrice)} />
        <Stat label="List at" value={money(r.suggestedListPrice)} accent />
        <Stat label="Sold high" value={money(r.highPrice)} />
      </div>

      <p className="text-sm text-muted-foreground">{r.summary}</p>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <Stat label="Demand" value={r.demand} />
        <Stat label="Sell time" value={r.sellSpeed} />
        <Stat label="Platform" value={r.bestPlatform} />
      </div>

      {r.comps.length > 0 && (
        <ul className="divide-y divide-border">
          {r.comps.map((c, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm">{c.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {c.source} · {c.condition}
                </span>
              </span>
              <span className="text-sm font-semibold">{money(c.price)}</span>
            </li>
          ))}
        </ul>
      )}

      {r.risks.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <ul className="list-inside list-disc text-sm">
            {r.risks.map((risk, i) => (
              <li key={i}>{risk}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Profit at free · {money(profit(scan))} · ROI {Math.round(roi(scan))}%
      </p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-background p-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

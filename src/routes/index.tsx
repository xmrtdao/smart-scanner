import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, RefreshCw, Trash2, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { identifyItem, researchPrices } from "@/lib/scan.functions";
import {
  loadScans,
  money,
  profit,
  roi,
  saveScans,
  score,
  verdict,
  type Scan,
} from "@/lib/thrift";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Thrifty Picker — Scan Thrift Finds for Resale Profit" },
      {
        name: "description",
        content:
          "Point your camera at a thrift find. Thrifty Picker identifies it, estimates resale value, and ranks your finds by profit potential.",
      },
      { property: "og:title", content: "Thrifty Picker — Scan Thrift Finds for Resale Profit" },
      {
        property: "og:description",
        content:
          "Identify any secondhand item, get resale price estimates, and see which finds are worth buying.",
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

function Index() {
  const identify = useServerFn(identifyItem);
  const research = useServerFn(researchPrices);

  const [scans, setScans] = useState<Scan[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [askingPrice, setAskingPrice] = useState("");
  const [hint, setHint] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setScans(loadScans());
  }, []);

  const persist = useCallback((next: Scan[]) => {
    setScans(next);
    saveScans(next);
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      toast.error("Couldn't open the camera. You can upload a photo instead.");
    }
  };

  const runScan = async (image: string) => {
    stopCamera();
    setBusy("Identifying the item…");
    const price = Number(askingPrice) || 0;
    try {
      const identification = await identify({ data: { image, ...(hint ? { hint } : {}) } });
      setBusy(`Researching prices for ${identification.name}…`);
      const result = await research({
        data: {
          name: identification.name,
          brand: identification.brand,
          category: identification.category,
          condition: identification.condition,
          keywords: identification.keywords ?? [],
          askingPrice: price,
        },
      });
      const scan: Scan = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        image,
        askingPrice: price,
        identification,
        research: result,
      };
      persist([scan, ...scans]);
      setSelected(scan.id);
      setHint("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    void runScan(canvas.toDataURL("image/jpeg", 0.8));
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        void runScan(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const ranked = [...scans].sort((a, b) => score(b) - score(a));
  const current = scans.find((s) => s.id === selected) ?? ranked[0];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster position="top-center" />
      <header className="border-b border-border/60 bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Zap className="size-5" />
            </span>
            <div>
              <h1 className="font-display text-lg leading-none tracking-tight">Thrifty Picker</h1>
              <p className="text-xs text-muted-foreground">Scan it. Price it. Flip it.</p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">{scans.length} finds saved</span>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_1.1fr]">
        <section className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="relative aspect-[4/3] bg-neutral-900">
              {cameraOn ? (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="size-full object-cover"
                  aria-label="Camera preview"
                />
              ) : current ? (
                <img
                  src={current.image}
                  alt={current.identification.name}
                  className="size-full object-cover opacity-90"
                />
              ) : (
                <div className="grid size-full place-items-center text-center text-sm text-muted-foreground">
                  <div className="space-y-2 px-6">
                    <Camera className="mx-auto size-8" />
                    <p>Open the camera or upload a photo of a thrift find to appraise it.</p>
                  </div>
                </div>
              )}

              <div className="pointer-events-none absolute inset-6 rounded-xl border-2 border-dashed border-white/20" />

              {busy && (
                <div className="absolute inset-0 grid place-items-center bg-black/70 text-center text-sm text-white">
                  <div className="space-y-3">
                    <Loader2 className="mx-auto size-7 animate-spin" />
                    <p>{busy}</p>
                  </div>
                </div>
              )}
              {cameraOn && (
                <button
                  onClick={stopCamera}
                  className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-black/60 text-white"
                  aria-label="Close camera"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-muted-foreground">
                  Asking price
                  <input
                    value={askingPrice}
                    onChange={(e) => setAskingPrice(e.target.value.replace(/[^\d.]/g, ""))}
                    inputMode="decimal"
                    placeholder="$"
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Tag / notes (optional)
                  <input
                    value={hint}
                    onChange={(e) => setHint(e.target.value)}
                    placeholder="e.g. size M, made in Italy"
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
                  />
                </label>
              </div>

              <div className="flex gap-2">
                {cameraOn ? (
                  <button
                    onClick={capture}
                    disabled={!!busy}
                    className="flex-1 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Capture & appraise
                  </button>
                ) : (
                  <button
                    onClick={startCamera}
                    disabled={!!busy}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    <Camera className="size-4" /> Open camera
                  </button>
                )}
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={!!busy}
                  className="flex items-center justify-center gap-2 rounded-lg border border-input px-4 py-3 text-sm font-medium disabled:opacity-50"
                >
                  <ImagePlus className="size-4" /> Upload
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="font-display text-sm uppercase tracking-widest text-muted-foreground">
              Today&apos;s finds, best first
            </h2>
            <ul className="mt-3 space-y-2">
              {ranked.length === 0 && (
                <li className="text-sm text-muted-foreground">No finds yet.</li>
              )}
              {ranked.map((s) => {
                const v = verdict(s);
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelected(s.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors ${
                        current?.id === s.id ? "border-primary bg-primary/5" : "border-border hover:bg-accent"
                      }`}
                    >
                      <img src={s.image} alt="" className="size-12 rounded-lg object-cover" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {s.identification.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Pay {money(s.askingPrice)} → sell ~{money(s.research.suggestedListPrice)}
                        </span>
                      </span>
                      <span className="text-right">
                        <span
                          className={`block rounded-full px-2 py-0.5 text-[10px] font-semibold ${toneClass[v.tone]}`}
                        >
                          {v.label}
                        </span>
                        <span className="mt-1 block text-xs font-semibold text-primary">
                          +{money(Math.max(0, profit(s)))}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section>
          {current ? (
            <Detail
              scan={current}
              onDelete={() => {
                persist(scans.filter((s) => s.id !== current.id));
                setSelected(null);
              }}
              onRerun={() => void runScan(current.image)}
              busy={!!busy}
            />
          ) : (
            <div className="grid h-full min-h-60 place-items-center rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Your appraisal will appear here: what it is, what it sells for, and whether to buy it.
            </div>
          )}
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted-foreground">
        Price estimates are AI-generated from market knowledge, not live scraped listings. Always
        sanity-check high-value items before buying.
      </footer>
    </div>
  );
}

function Detail({
  scan,
  onDelete,
  onRerun,
  busy,
}: {
  scan: Scan;
  onDelete: () => void;
  onRerun: () => void;
  busy: boolean;
}) {
  const v = verdict(scan);
  const r = scan.research;
  const span = Math.max(1, r.highPrice - r.lowPrice);
  const markerLeft = Math.min(100, Math.max(0, ((r.medianPrice - r.lowPrice) / span) * 100));

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span
            className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${toneClass[v.tone]}`}
          >
            {v.label}
          </span>
          <h2 className="mt-2 font-display text-2xl leading-tight">{scan.identification.name}</h2>
          <p className="text-sm text-muted-foreground">
            {[scan.identification.brand, scan.identification.category, scan.identification.condition]
              .filter(Boolean)
              .join(" · ")}{" "}
            · {Math.round((scan.identification.confidence || 0) * 100)}% confident
          </p>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onRerun}
            disabled={busy}
            aria-label="Re-run appraisal"
            className="grid size-9 place-items-center rounded-lg border border-input hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className="size-4" />
          </button>
          <button
            onClick={onDelete}
            aria-label="Delete find"
            className="grid size-9 place-items-center rounded-lg border border-input hover:bg-accent"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="You pay" value={money(scan.askingPrice)} />
        <Stat label="List at" value={money(r.suggestedListPrice)} accent />
        <Stat label="Profit after fees" value={money(profit(scan))} accent />
      </div>

      <div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{money(r.lowPrice)}</span>
          <span>Sold range</span>
          <span>{money(r.highPrice)}</span>
        </div>
        <div className="relative mt-2 h-2 rounded-full bg-muted">
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary/30" style={{ width: "100%" }} />
          <div
            className="absolute -top-1 size-4 -translate-x-1/2 rounded-full border-2 border-background bg-primary"
            style={{ left: `${markerLeft}%` }}
            title={`Median ${money(r.medianPrice)}`}
          />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{r.summary}</p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <Stat label="Demand" value={r.demand} />
        <Stat label="Typical sell time" value={r.sellSpeed} />
        <Stat label="Best platform" value={r.bestPlatform} />
      </div>

      <div>
        <h3 className="font-display text-sm uppercase tracking-widest text-muted-foreground">
          Comparable sales
        </h3>
        <ul className="mt-2 divide-y divide-border">
          {r.comps.map((c, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm">{c.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {c.source} · {c.condition} · {c.note}
                </span>
              </span>
              <span className="text-sm font-semibold">{money(c.price)}</span>
            </li>
          ))}
        </ul>
      </div>

      {(scan.identification.details?.length ?? 0) > 0 && (
        <div>
          <h3 className="font-display text-sm uppercase tracking-widest text-muted-foreground">
            What the camera saw
          </h3>
          <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
            {scan.identification.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      {r.risks.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-destructive">
            Watch out
          </h3>
          <ul className="mt-1 list-inside list-disc text-sm">
            {r.risks.map((risk, i) => (
              <li key={i}>{risk}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">ROI {Math.round(roi(scan))}% · score {score(scan)}</p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

export type Comp = {
  source: string;
  title: string;
  price: number;
  condition: string;
  note: string;
};

export type PriceResearch = {
  lowPrice: number;
  medianPrice: number;
  highPrice: number;
  suggestedListPrice: number;
  demand: "low" | "medium" | "high";
  sellSpeed: string;
  bestPlatform: string;
  comps: Comp[];
  risks: string[];
  summary: string;
};

export type Identification = {
  name: string;
  brand: string;
  category: string;
  condition: string;
  confidence: number;
  details: string[];
  keywords: string[];
};

export type LiveItem = {
  label: string;
  bbox: number[];
  estValue: number;
  note: string;
  confidence: number;
};

export type Scan = {
  id: string;
  createdAt: number;
  image: string;
  askingPrice: number;
  identification: Identification;
  research: PriceResearch;
};

export function profit(scan: Scan) {
  const fees = scan.research.suggestedListPrice * 0.15;
  return scan.research.suggestedListPrice - fees - scan.askingPrice;
}

export function roi(scan: Scan) {
  if (scan.askingPrice <= 0) return profit(scan) > 0 ? 999 : 0;
  return (profit(scan) / scan.askingPrice) * 100;
}

export function score(scan: Scan) {
  const demandWeight = { low: 0.7, medium: 1, high: 1.3 }[scan.research.demand] ?? 1;
  const confidence = Math.max(0.4, Math.min(1, scan.identification.confidence || 0.7));
  return Math.round(Math.max(0, roi(scan)) * demandWeight * confidence);
}

export function verdict(scan: Scan): { label: string; tone: "buy" | "maybe" | "pass" } {
  const p = profit(scan);
  const r = roi(scan);
  if (p >= 15 && r >= 60) return { label: "Buy it", tone: "buy" };
  if (p >= 5) return { label: "Worth a haggle", tone: "maybe" };
  return { label: "Leave it", tone: "pass" };
}

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const KEY = "thrifty-picker-scans";

export function loadScans(): Scan[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Scan[];
  } catch {
    return [];
  }
}

export function saveScans(scans: Scan[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(scans.slice(0, 30)));
  } catch {
    /* storage full — ignore */
  }
}

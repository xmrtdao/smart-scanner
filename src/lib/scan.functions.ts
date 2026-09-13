import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Identification, LiveItem, PriceResearch } from "./thrift";

const DetectInput = z.object({ image: z.string().min(20) });

type DetectionResult = {
  items: LiveItem[];
  unavailableReason?: string;
};

const detectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "bbox", "estValue", "note", "confidence"],
        properties: {
          label: { type: "string" },
          bbox: { type: "array", items: { type: "number" } },
          estValue: { type: "number" },
          note: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
} as const;

export const detectItems = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => DetectInput.parse(input))
  .handler(async ({ data }): Promise<DetectionResult> => {
    const { askAstraJson } = await import("./ai.server");
    try {
      const out = await askAstraJson<{ items: LiveItem[] }>({
        instructions:
          "You are a live resale-scanner vision model. Find every distinct resellable object in the frame (up to 12). For each: label (specific: brand/model when readable, else generic), bbox as [x, y, width, height] normalized 0-1 relative to the whole image, estValue = typical US secondhand resale price in USD, note = 3-6 word reason for the value (options, size, condition), confidence 0-1. If the frame shows many similar items (phones, TVs, shoes), box each one separately so they can be ranked by value. Return an empty items array if nothing resellable is visible. Never omit bbox.",
        content: [
          { type: "input_text", text: "Detect and value the items in this frame." },
          { type: "input_image", image_url: data.image },
        ],
        schemaName: "live_items",
        schema: detectSchema,
        effort: "low",
      });
      const items = (Array.isArray(out.items) ? out.items : []).filter(
        (i) =>
          i &&
          Array.isArray(i.bbox) &&
          i.bbox.length === 4 &&
          i.bbox.every((n) => typeof n === "number" && Number.isFinite(n)),
      );
      return { items };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live scanning is unavailable right now.";
      if (/credit|Too many requests|not configured/i.test(message)) {
        return { items: [], unavailableReason: message };
      }
      throw error;
    }
  });

const IdentifyInput = z.object({
  image: z.string().min(20),
  hint: z.string().max(300).optional(),
});

const identSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "brand", "category", "condition", "confidence", "details", "keywords"],
  properties: {
    name: { type: "string" },
    brand: { type: "string" },
    category: { type: "string" },
    condition: { type: "string" },
    confidence: { type: "number" },
    details: { type: "array", items: { type: "string" } },
    keywords: { type: "array", items: { type: "string" } },
  },
} as const;

export const identifyItem = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => IdentifyInput.parse(input))
  .handler(async ({ data }): Promise<Identification> => {
    const { askAstraJson } = await import("./ai.server");
    return askAstraJson<Identification>({
      instructions:
        "You are an expert thrift-store reseller appraiser. Identify the item in the photo as precisely as possible: exact model or pattern names, brand, era, materials. Judge visible condition honestly. confidence is 0-1. details: up to 5 short observations (marks, wear, tags, model numbers). keywords: search terms a reseller would use on eBay. If unsure, say so in the name rather than inventing a model.",
      content: [
        { type: "input_text", text: data.hint ? `Seller/tag info: ${data.hint}` : "Identify this item." },
        { type: "input_image", image_url: data.image },
      ],
      schemaName: "identification",
      schema: identSchema,
      effort: "low",
    });
  });

const ResearchInput = z.object({
  name: z.string().min(1),
  brand: z.string().default(""),
  category: z.string().default(""),
  condition: z.string().default(""),
  keywords: z.array(z.string()).default([]),
  askingPrice: z.number().min(0).default(0),
});

const researchSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "lowPrice",
    "medianPrice",
    "highPrice",
    "suggestedListPrice",
    "demand",
    "sellSpeed",
    "bestPlatform",
    "comps",
    "risks",
    "summary",
  ],
  properties: {
    lowPrice: { type: "number" },
    medianPrice: { type: "number" },
    highPrice: { type: "number" },
    suggestedListPrice: { type: "number" },
    demand: { type: "string", enum: ["low", "medium", "high"] },
    sellSpeed: { type: "string" },
    bestPlatform: { type: "string" },
    comps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "title", "price", "condition", "note"],
        properties: {
          source: { type: "string" },
          title: { type: "string" },
          price: { type: "number" },
          condition: { type: "string" },
          note: { type: "string" },
        },
      },
    },
    risks: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
} as const;

export const researchPrices = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => ResearchInput.parse(input))
  .handler(async ({ data }): Promise<PriceResearch> => {
    const { askAstraJson } = await import("./ai.server");
    const { fetchEbayComps, summarise } = await import("./ebay.server");

    const query = [data.brand, data.name].filter(Boolean).join(" ") || data.keywords.join(" ");
    const liveComps = await fetchEbayComps(query);
    const stats = summarise(liveComps);

    const research = await askAstraJson<PriceResearch>({
      instructions:
        "You are a resale market analyst. Estimate the current US secondhand resale market for the item. All prices in USD, net of shipping. If liveEbay stats are provided, anchor lowPrice/medianPrice/highPrice/suggestedListPrice to them — they are real current eBay asking prices — and adjust slightly downward for sold-vs-asking. Give 3-5 comparable listings with plausible titles and prices. sellSpeed is a short phrase like '2-4 weeks'. risks: up to 4 short warnings (fakes, shipping cost, restrictions, saturation). summary: 2 sentences of buy/pass reasoning for a reseller at the given asking price.",
      content: [
        {
          type: "input_text",
          text: JSON.stringify({
            item: data.name,
            brand: data.brand,
            category: data.category,
            condition: data.condition,
            searchTerms: data.keywords,
            askingPrice: data.askingPrice,
            liveEbay: stats
              ? { ...stats, samples: liveComps.slice(0, 8).map((c) => ({ title: c.title, price: c.price })) }
              : null,
          }),
        },
      ],
      schemaName: "price_research",
      schema: researchSchema,
      effort: "low",
    });

    const aiComps = Array.isArray(research.comps)
      ? research.comps.filter((c) => c && typeof c.price === "number")
      : [];

    return {
      ...research,
      lowPrice: stats ? stats.low : research.lowPrice,
      medianPrice: stats ? stats.median : research.medianPrice,
      highPrice: stats ? stats.high : research.highPrice,
      comps: liveComps.length ? [...liveComps.slice(0, 6), ...aiComps.slice(0, 2)] : aiComps,
      risks: Array.isArray(research.risks) ? research.risks : [],
    };
  });


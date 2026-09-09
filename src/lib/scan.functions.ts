import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Identification, PriceResearch } from "./thrift";

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
    const research = await askAstraJson<PriceResearch>({
      instructions:
        "You are a resale market analyst. Estimate the current US secondhand resale market for the item, based on typical sold prices (eBay sold, Mercari, Poshmark, Facebook Marketplace, specialist markets). All prices in USD, net of shipping. Give 3-5 realistic comparable sold listings with plausible titles and prices — mark them as representative comps, never as scraped live data. sellSpeed is a short phrase like '2-4 weeks'. risks: up to 4 short warnings (fakes, shipping cost, restrictions, saturation). summary: 2 sentences of buy/pass reasoning for a reseller at the given asking price.",
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
          }),
        },
      ],
      schemaName: "price_research",
      schema: researchSchema,
      effort: "medium",
    });
    return {
      ...research,
      comps: Array.isArray(research.comps)
        ? research.comps.filter((c) => c && typeof c.price === "number")
        : [],
      risks: Array.isArray(research.risks) ? research.risks : [],
    };
  });

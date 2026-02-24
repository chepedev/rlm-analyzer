import type { TokenUsage } from './providers/types.js';

export interface ModelPricing {
    inputPer1M: number;
    outputPer1M: number;
    cacheCreationPer1M?: number;
    cacheReadPer1M?: number;
}

// Pricing as of early 2025, in USD per 1M tokens
export const PRICING_DATA: Record<string, ModelPricing> = {
    // Gemini Models (Google AI Studio)
    'gemini-3-flash-preview': { inputPer1M: 0.50, outputPer1M: 3.00, cacheCreationPer1M: 0.50, cacheReadPer1M: 0.125 },
    'gemini-3-pro-preview': { inputPer1M: 2.50, outputPer1M: 10.00, cacheCreationPer1M: 2.50, cacheReadPer1M: 0.625 }, // Extrapolated Pro relative pricing based on history
    'gemini-2.5-pro': { inputPer1M: 2.00, outputPer1M: 8.00, cacheCreationPer1M: 2.00, cacheReadPer1M: 0.50 },
    'gemini-2.5-flash': { inputPer1M: 0.075, outputPer1M: 0.30, cacheCreationPer1M: 0.075, cacheReadPer1M: 0.01875 },
    'gemini-2.0-flash-exp': { inputPer1M: 0.075, outputPer1M: 0.30, cacheCreationPer1M: 0.075, cacheReadPer1M: 0.01875 },
    'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.30, cacheCreationPer1M: 0.075, cacheReadPer1M: 0.01875 },
    'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5.00, cacheCreationPer1M: 1.25, cacheReadPer1M: 0.3125 },

    // Claude 3.5 Models (Anthropic / Bedrock)
    'claude-3-5-sonnet-20241022': { inputPer1M: 3.00, outputPer1M: 15.00, cacheCreationPer1M: 3.75, cacheReadPer1M: 0.30 },
    'claude-3-5-haiku-20241022': { inputPer1M: 0.25, outputPer1M: 1.25, cacheCreationPer1M: 0.30, cacheReadPer1M: 0.03 },
    'us.anthropic.claude-sonnet-4-5-20250929-v1:0': { inputPer1M: 3.00, outputPer1M: 15.00, cacheCreationPer1M: 3.75, cacheReadPer1M: 0.30 }, // Assuming 3.5 pricing
    'us.anthropic.claude-haiku-4-5-20251001-v1:0': { inputPer1M: 0.25, outputPer1M: 1.25, cacheCreationPer1M: 0.30, cacheReadPer1M: 0.03 }, // Assuming 3.5 pricing
    'us.anthropic.claude-opus-4-5-20251101-v1:0': { inputPer1M: 15.00, outputPer1M: 75.00 }, // Assuming Opus 3 pricing

    // Amazon Nova Models
    'amazon.nova-micro-v1:0': { inputPer1M: 0.035, outputPer1M: 0.14 },
    'amazon.nova-lite-v1:0': { inputPer1M: 0.06, outputPer1M: 0.24 },
    'amazon.nova-pro-v1:0': { inputPer1M: 0.80, outputPer1M: 3.20 },
    'us.amazon.nova-2-lite-v1:0': { inputPer1M: 0.06, outputPer1M: 0.24 },

    // Llama Models
    'meta.llama3-1-70b-instruct-v1:0': { inputPer1M: 0.72, outputPer1M: 0.72 },
    'meta.llama3-1-405b-instruct-v1:0': { inputPer1M: 2.40, outputPer1M: 2.40 },
    'meta.llama3-3-70b-instruct-v1:0': { inputPer1M: 0.72, outputPer1M: 0.72 },
};

/**
 * Normalizes model names to match the keys in PRICING_DATA
 */
function normalizeModelName(modelId: string): string {
    // If it's explicitly in the table, use it
    if (PRICING_DATA[modelId]) {
        return modelId;
    }

    const lower = modelId.toLowerCase();

    // Basic substring matches for fallback
    if (lower.includes('gemini-3-flash') || lower.includes('gemini-2.0-flash') || lower.includes('gemini-2.5-flash')) return 'gemini-1.5-flash';
    if (lower.includes('gemini-1.5-flash') || lower.includes('gemini-flash')) return 'gemini-1.5-flash';
    if (lower.includes('gemini-3-pro') || lower.includes('gemini-1.5-pro') || lower.includes('gemini-pro')) return 'gemini-1.5-pro';

    if (lower.includes('claude-3-5-sonnet') || lower.includes('claude-sonnet-4-5') || lower.includes('sonnet')) return 'claude-3-5-sonnet-20241022';
    if (lower.includes('claude-3-5-haiku') || lower.includes('claude-haiku-4-5') || lower.includes('haiku')) return 'claude-3-5-haiku-20241022';
    if (lower.includes('opus')) return 'us.anthropic.claude-opus-4-5-20251101-v1:0';

    if (lower.includes('nova-micro')) return 'amazon.nova-micro-v1:0';
    if (lower.includes('nova-lite') || lower.includes('nova-2-lite')) return 'amazon.nova-lite-v1:0';
    if (lower.includes('nova-pro')) return 'amazon.nova-pro-v1:0';

    // Default to Gemini Flash if we can't figure it out (conservative)
    return 'gemini-1.5-flash';
}

/**
 * Calculates the cost in USD for a given token usage and model.
 * 
 * @param modelId The ID or alias of the model used
 * @param usage The token usage statistics
 * @returns Cost in USD, or 0 if pricing is unknown
 */
export function calculateCost(modelId: string, usage: TokenUsage | undefined): number {
    if (!usage) return 0;

    const normalizedModel = normalizeModelName(modelId);
    const pricing = PRICING_DATA[normalizedModel];

    if (!pricing) {
        return 0; // Return 0 if we really have no idea
    }

    let cost = 0;

    // Calculate base input/output costs
    const baseInputTokens = usage.inputTokens - (usage.cacheCreationTokens || 0) - (usage.cacheReadTokens || 0);
    if (baseInputTokens > 0) {
        cost += (baseInputTokens / 1_000_000) * pricing.inputPer1M;
    }

    cost += (usage.outputTokens / 1_000_000) * pricing.outputPer1M;

    // Add Anthropic Prompt Caching costs if applicable
    if (usage.cacheCreationTokens && pricing.cacheCreationPer1M) {
        cost += (usage.cacheCreationTokens / 1_000_000) * pricing.cacheCreationPer1M;
    }

    if (usage.cacheReadTokens && pricing.cacheReadPer1M) {
        cost += (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPer1M;
    }

    return cost;
}

#!/usr/bin/env node
/**
 * RLM Analyzer MCP Server
 * Exposes RLM analysis capabilities via Model Context Protocol
 * Supports Gemini, Amazon Bedrock, and Claude (Anthropic) providers
 *
 * Usage with Claude Code:
 * Add to ~/.claude/claude_desktop_config.json:
 *
 * For Gemini (default):
 * {
 *   "mcpServers": {
 *     "rlm-analyzer": {
 *       "command": "npx",
 *       "args": ["rlm-analyzer-mcp"],
 *       "env": { "GEMINI_API_KEY": "your_key" }
 *     }
 *   }
 * }
 *
 * For Amazon Bedrock:
 * {
 *   "mcpServers": {
 *     "rlm-analyzer": {
 *       "command": "npx",
 *       "args": ["rlm-analyzer-mcp"],
 *       "env": {
 *         "RLM_PROVIDER": "bedrock",
 *         "AWS_REGION": "us-east-1",
 *         "AWS_ACCESS_KEY_ID": "your_key",
 *         "AWS_SECRET_ACCESS_KEY": "your_secret"
 *       }
 *     }
 *   }
 * }
 *
 * For Claude (Anthropic):
 * {
 *   "mcpServers": {
 *     "rlm-analyzer": {
 *       "command": "npx",
 *       "args": ["rlm-analyzer-mcp"],
 *       "env": {
 *         "RLM_PROVIDER": "claude",
 *         "ANTHROPIC_API_KEY": "your_key"
 *       }
 *     }
 *   }
 * }
 */

import { fileURLToPath } from 'url';
import { logUsage } from './cost-logger.js';
import { realpathSync } from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { RLMResult, CodeAnalysisResult } from './types.js';

/**
 * Formats an RLMResult into text for an MCP tool response,
 * including metrics like token usage and estimated cost if available.
 */
function logMcpUsage(result: RLMResult | CodeAnalysisResult, directory: string, analysisType: string, provider: string, model: string, startTime: number): void {
  const codeResult = result as CodeAnalysisResult;
  logUsage({
    provider,
    model,
    analysisType,
    directory,
    inputTokens: result.tokenUsage?.inputTokens ?? 0,
    outputTokens: result.tokenUsage?.outputTokens ?? 0,
    totalTokens: result.tokenUsage?.totalTokens ?? 0,
    costUsd: result.costUsd ?? 0,
    executionTimeMs: Date.now() - startTime,
    subCallCount: result.subCallCount ?? 0,
    source: 'mcp',
    success: result.success,
    cacheHit: codeResult.cacheHit,
    changedFilesCount: codeResult.changedFilesCount,
  }).catch(() => { /* silent */ });
}

function formatResult(result: RLMResult, fallbackMessage: string): string {
  if (!result.success) {
    return `Error: ${result.error}`;
  }

  let text = result.answer || fallbackMessage;
  const stats: string[] = [];

  if (result.tokenSavings && result.tokenSavings.savings > 0) {
    stats.push(`📊 Token Optimization: ${result.tokenSavings.savings.toFixed(1)}% context savings`);
  }

  if (result.tokenUsage) {
    const cachedTokens = result.tokenUsage.cacheReadTokens || 0;
    const cacheCreationTokens = result.tokenUsage.cacheCreationTokens || 0;
    const toolTokens = result.tokenUsage.toolUseTokens || 0;
    const thoughtsTokens = result.tokenUsage.thoughtsTokens || 0;

    let cacheStr = cachedTokens > 0 ? ` / ${cachedTokens.toLocaleString()} cache read` : '';
    let cacheCrStr = cacheCreationTokens > 0 ? ` / ${cacheCreationTokens.toLocaleString()} cache creation` : '';
    let toolStr = toolTokens > 0 ? ` / ${toolTokens.toLocaleString()} tool` : '';
    let thoughtsStr = thoughtsTokens > 0 ? ` / ${thoughtsTokens.toLocaleString()} thoughts` : '';

    stats.push(`🪙 Tokens: ${result.tokenUsage.totalTokens.toLocaleString()} (${result.tokenUsage.inputTokens.toLocaleString()} in / ${result.tokenUsage.outputTokens.toLocaleString()} out${cacheStr}${cacheCrStr}${toolStr}${thoughtsStr})`);
  }

  if (result.costUsd !== undefined && result.costUsd > 0) {
    stats.push(`💸 Cost: $${result.costUsd.toFixed(4)}`);
  }

  if (stats.length > 0) {
    const statsText = stats.join('\n');
    text += `\n\n---\n${statsText}`;

    // Also log to stderr so it shows up in KiloCode's MCP output panel
    console.error(`\n[rlm-analyzer] Operation completed:\n${statsText}\n`);
  }

  return text;
}

import {
  analyzeCodebase,
  analyzeArchitecture,
  analyzeDependencies,
  analyzeSecurity,
  analyzeRefactoring,
  summarizeCodebase,
  askQuestion,
} from './analyzer.js';
import { resolveModelConfig, resolveProviderModelAlias, getProviderAliasesDisplay } from './models.js';
import { hasApiKey, hasAnyCredentials, initializeProvider, hasBedrockCredentials, hasClaudeCredentials } from './config.js';
import type { AnalysisType } from './types.js';
import type { ProviderName } from './providers/types.js';

// Provider parameter common to all analysis tools
const PROVIDER_PARAM = {
  type: 'string',
  enum: ['gemini', 'bedrock', 'claude'],
  description: 'LLM provider to use (default: gemini). Bedrock requires AWS credentials. Claude requires ANTHROPIC_API_KEY.',
};

// Tool definitions
const TOOLS = [
  {
    name: 'rlm_analyze',
    description: 'Analyze a codebase using recursive LLM analysis. Can answer complex questions about code architecture, patterns, and implementation details by recursively examining files.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Absolute path to the directory to analyze',
        },
        query: {
          type: 'string',
          description: 'Question or analysis request about the codebase',
        },
        analysisType: {
          type: 'string',
          enum: ['architecture', 'dependencies', 'security', 'performance', 'refactor', 'summary', 'custom'],
          description: 'Type of analysis to perform (default: custom if query provided, summary otherwise)',
        },
        model: {
          type: 'string',
          description: 'Model to use: fast, smart, or full model ID (default: from environment)',
        },
        provider: PROVIDER_PARAM,
      },
      required: ['directory'],
    },
  },
  {
    name: 'rlm_summarize',
    description: 'Get a comprehensive summary of a codebase including purpose, tech stack, architecture, and key components.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Absolute path to the directory to analyze',
        },
        model: {
          type: 'string',
          description: 'Model to use: fast, smart, or full model ID',
        },
        provider: PROVIDER_PARAM,
      },
      required: ['directory'],
    },
  },
  {
    name: 'rlm_architecture',
    description: 'Analyze the architecture and structure of a codebase. Identifies patterns, layers, components, and their relationships.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Absolute path to the directory to analyze',
        },
        model: {
          type: 'string',
          description: 'Model to use: fast, smart, or full model ID',
        },
        provider: PROVIDER_PARAM,
      },
      required: ['directory'],
    },
  },
  {
    name: 'rlm_security',
    description: 'Perform security analysis on a codebase. Identifies potential vulnerabilities, insecure patterns, and security best practice violations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Absolute path to the directory to analyze',
        },
        model: {
          type: 'string',
          description: 'Model to use: fast, smart, or full model ID',
        },
        provider: PROVIDER_PARAM,
      },
      required: ['directory'],
    },
  },
  {
    name: 'rlm_dependencies',
    description: 'Analyze dependencies in a codebase. Maps internal and external dependencies, identifies circular dependencies and coupling issues.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Absolute path to the directory to analyze',
        },
        model: {
          type: 'string',
          description: 'Model to use: fast, smart, or full model ID',
        },
        provider: PROVIDER_PARAM,
      },
      required: ['directory'],
    },
  },
  {
    name: 'rlm_refactor',
    description: 'Find refactoring opportunities in a codebase. Identifies code duplication, complex functions, and improvement opportunities.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Absolute path to the directory to analyze',
        },
        model: {
          type: 'string',
          description: 'Model to use: fast, smart, or full model ID',
        },
        provider: PROVIDER_PARAM,
      },
      required: ['directory'],
    },
  },
  {
    name: 'rlm_ask',
    description: 'Ask a specific question about a codebase. The AI will analyze relevant files to answer your question.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        directory: {
          type: 'string',
          description: 'Absolute path to the directory to analyze',
        },
        question: {
          type: 'string',
          description: 'The question to answer about the codebase',
        },
        model: {
          type: 'string',
          description: 'Model to use: fast, smart, or full model ID',
        },
        provider: PROVIDER_PARAM,
      },
      required: ['directory', 'question'],
    },
  },
  {
    name: 'rlm_config',
    description: 'Get current RLM Analyzer configuration including model settings and API key status.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'rlm_log_session',
    description: 'Log an AI coding session (e.g., Kilo Code) usage to the cost tracking database. Call this at the end of each task to track spending.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name or directory path' },
        model: { type: 'string', description: 'Model used (e.g., claude-sonnet-4-5, anthropic/claude-opus-4.6)' },
        costUsd: { type: 'number', description: 'Total session cost in USD (from Current Cost in environment_details)' },
        inputTokens: { type: 'number', description: 'Total input tokens (from environment_details)' },
        outputTokens: { type: 'number', description: 'Total output tokens (from environment_details)' },
        sessionNotes: { type: 'string', description: 'Brief description of what was done (optional)' },
        source: { type: 'string', description: 'Source identifier (default: kilocode)', default: 'kilocode' },
      },
      required: ['project', 'model', 'costUsd', 'inputTokens', 'outputTokens'],
    },
  },
];

// Create server
const server = new Server(
  { name: 'rlm-analyzer', version: '1.6.1' },
  { capabilities: { tools: {} } }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;

  try {
    // Get provider from args or default to gemini
    const provider = (args?.provider as ProviderName) || 'gemini';

    // Check credentials for analysis tools
    if (name !== 'rlm_config' && name !== 'rlm_log_session' && !hasAnyCredentials()) {
      let errorMsg: string;
      if (provider === 'bedrock') {
        errorMsg = 'Error: AWS credentials not configured. Set AWS_BEARER_TOKEN_BEDROCK (recommended), or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, or AWS_PROFILE.';
      } else if (provider === 'claude') {
        errorMsg = 'Error: Claude API key not configured. Set ANTHROPIC_API_KEY in the MCP server environment.';
      } else {
        errorMsg = 'Error: GEMINI_API_KEY not configured. Set it in the MCP server environment.';
      }
      return {
        content: [{
          type: 'text',
          text: errorMsg,
        }],
        isError: true,
      };
    }

    // Initialize provider for analysis tools
    if (name !== 'rlm_config' && name !== 'rlm_log_session') {
      initializeProvider(provider);
    }

    // Resolve model alias using provider-specific resolution
    const model = args?.model ? resolveProviderModelAlias(args.model as string, provider) : undefined;
    const resolvedModel = model ?? 'default';
    const mcpStartTime = Date.now();

    // Setup analysis options with progress tracking to prevent timeouts
    const options: any = {
      ...(model ? { model } : {}),
      provider
    };

    // Extract progress token if supported by the client
    const progressToken = (request.params as any)._meta?.progressToken;

    if (progressToken) {
      options.onProgress = (progressData: any) => {
        void server.notification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress: typeof progressData.subCallCount === 'number' ? progressData.subCallCount : 0
          }
        });
      };
    }

    switch (name) {
      case 'rlm_analyze': {
        const { directory, query, analysisType } = args as {
          directory: string;
          query?: string;
          analysisType?: AnalysisType;
        };

        const result = await analyzeCodebase({
          directory,
          query,
          analysisType: analysisType || (query ? 'custom' : 'summary'),
          ...options,
        });

        logMcpUsage(result, directory, analysisType || (query ? 'custom' : 'summary'), provider, resolvedModel, mcpStartTime);
        return {
          content: [{
            type: 'text',
            text: formatResult(result, 'Analysis complete but no answer generated.'),
          }],
          isError: !result.success,
        };
      }

      case 'rlm_summarize': {
        const { directory } = args as { directory: string };
        const result = await summarizeCodebase(directory, options);

        logMcpUsage(result, directory, 'summary', provider, resolvedModel, mcpStartTime);
        return {
          content: [{
            type: 'text',
            text: formatResult(result, 'Summary complete but no content generated.'),
          }],
          isError: !result.success,
        };
      }

      case 'rlm_architecture': {
        const { directory } = args as { directory: string };
        const result = await analyzeArchitecture(directory, options);

        logMcpUsage(result, directory, 'architecture', provider, resolvedModel, mcpStartTime);
        return {
          content: [{
            type: 'text',
            text: formatResult(result, 'Architecture analysis complete.'),
          }],
          isError: !result.success,
        };
      }

      case 'rlm_security': {
        const { directory } = args as { directory: string };
        const result = await analyzeSecurity(directory, options);

        logMcpUsage(result, directory, 'security', provider, resolvedModel, mcpStartTime);
        return {
          content: [{
            type: 'text',
            text: formatResult(result, 'Security analysis complete.'),
          }],
          isError: !result.success,
        };
      }

      case 'rlm_dependencies': {
        const { directory } = args as { directory: string };
        const result = await analyzeDependencies(directory, options);

        logMcpUsage(result, directory, 'dependencies', provider, resolvedModel, mcpStartTime);
        return {
          content: [{
            type: 'text',
            text: formatResult(result, 'Dependency analysis complete.'),
          }],
          isError: !result.success,
        };
      }

      case 'rlm_refactor': {
        const { directory } = args as { directory: string };
        const result = await analyzeRefactoring(directory, options);

        logMcpUsage(result, directory, 'refactor', provider, resolvedModel, mcpStartTime);
        return {
          content: [{
            type: 'text',
            text: formatResult(result, 'Refactoring analysis complete.'),
          }],
          isError: !result.success,
        };
      }

      case 'rlm_ask': {
        const { directory, question } = args as { directory: string; question: string };
        const result = await askQuestion(directory, question, options);

        logMcpUsage(result, directory, 'custom', provider, resolvedModel, mcpStartTime);
        return {
          content: [{
            type: 'text',
            text: formatResult(result, 'Question answered but no content generated.'),
          }],
          isError: !result.success,
        };
      }

      case 'rlm_config': {
        const geminiConfig = resolveModelConfig({ provider: 'gemini' });
        const bedrockConfig = resolveModelConfig({ provider: 'bedrock' });
        const claudeConfig = resolveModelConfig({ provider: 'claude' });
        const geminiStatus = hasApiKey() ? 'configured' : 'NOT CONFIGURED';
        const bedrockStatus = hasBedrockCredentials() ? 'configured' : 'NOT CONFIGURED';
        const claudeStatus = hasClaudeCredentials() ? 'configured' : 'NOT CONFIGURED';

        return {
          content: [{
            type: 'text',
            text: `RLM Analyzer Configuration:

Gemini Provider:
- API Key: ${geminiStatus}
- Default Model: ${geminiConfig.defaultModel} (source: ${geminiConfig.defaultSource})
- Fallback Model: ${geminiConfig.fallbackModel} (source: ${geminiConfig.fallbackSource})
- Aliases:
${getProviderAliasesDisplay('gemini')}

Bedrock Provider:
- AWS Credentials: ${bedrockStatus}
- Default Model: ${bedrockConfig.defaultModel} (source: ${bedrockConfig.defaultSource})
- Fallback Model: ${bedrockConfig.fallbackModel} (source: ${bedrockConfig.fallbackSource})
- Aliases:
${getProviderAliasesDisplay('bedrock')}

Claude Provider:
- API Key: ${claudeStatus}
- Default Model: ${claudeConfig.defaultModel} (source: ${claudeConfig.defaultSource})
- Fallback Model: ${claudeConfig.fallbackModel} (source: ${claudeConfig.fallbackSource})
- Aliases:
${getProviderAliasesDisplay('claude')}

Use 'provider' parameter to switch between providers.`,
          }],
        };
      }

      case 'rlm_log_session': {
        const { project, model: sessionModel, costUsd, inputTokens = 0, outputTokens = 0, sessionNotes, source = 'kilocode' } = args as {
          project: string;
          model: string;
          costUsd: number;
          inputTokens?: number;
          outputTokens?: number;
          sessionNotes?: string;
          source?: string;
        };
        await logUsage({
          provider: source,
          model: sessionModel,
          analysisType: sessionNotes || 'coding-session',
          directory: project.startsWith('/') ? project : `/projects/${project}`,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          costUsd,
          executionTimeMs: 0,
          subCallCount: 0,
          source,
          success: true,
        });
        return {
          content: [{ type: 'text', text: `✅ Session logged: ${project} — $${costUsd.toFixed(4)} (${sessionModel})` }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// Start server
export async function startMcpServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('RLM Analyzer MCP server running on stdio');
}

// Auto-start when run as a script (via node, npx, or bin symlink)
// Use import.meta.url to detect if we're the main module
function isMainModule(): boolean {
  try {
    const scriptPath = process.argv[1];
    if (!scriptPath) return false;

    // Get the real path of this file
    const thisFile = fileURLToPath(import.meta.url);

    // Get real paths to resolve symlinks (npx creates symlinks in .bin/)
    const realScript = realpathSync(scriptPath);
    const realThis = realpathSync(thisFile);

    return realScript === realThis;
  } catch {
    // Fallback: check if script path contains our identifiers
    const scriptPath = process.argv[1] || '';
    return (
      scriptPath.endsWith('mcp-server.js') ||
      scriptPath.endsWith('rlm-mcp') ||
      scriptPath.endsWith('rlm-analyzer-mcp')
    );
  }
}

if (isMainModule()) {
  startMcpServer().catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  });
}

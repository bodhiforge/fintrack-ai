/**
 * Agent Orchestrator
 * Agentic loop: tool results feed back to LLM for natural responses
 */

import OpenAI from 'openai';
import type { Keyboard, ToolContext, ToolDefinition } from '@fintrack-ai/core';
import type { Environment, TelegramUser } from '../types.js';
import type { User, Project } from '@fintrack-ai/core';
import { getWorkingMemory, addMessage, extendMemoryTTL } from './memory-session.js';
import { getProjectMembers } from '../db/index.js';
import { getToolRegistry, type ToolRegistry } from '../tools/index.js';
import { buildSystemPrompt, buildConversationMessages } from './prompt-builder.js';

// ============================================
// Types
// ============================================

export interface AgentContext {
  readonly chatId: number;
  readonly user: User;
  readonly project: Project;
  readonly environment: Environment;
  readonly telegramUser: TelegramUser;
}

export interface AgentResponse {
  readonly text: string;
  readonly keyboard?: Keyboard;
}

// ============================================
// Constants
// ============================================

const MAX_LOOP_ITERATIONS = 3;
const MODEL = 'gpt-4o-mini';

// ============================================
// Agentic Loop (recursive)
// ============================================

interface LoopState {
  readonly messages: OpenAI.ChatCompletionMessageParam[];
  readonly keyboard?: Keyboard;
  readonly iteration: number;
}

async function runAgentLoop(
  client: OpenAI,
  toolDefinitions: readonly ToolDefinition[],
  registry: ToolRegistry,
  toolContext: ToolContext,
  state: LoopState
): Promise<AgentResponse> {
  if (state.iteration >= MAX_LOOP_ITERATIONS) {
    return { text: 'Processing complete.', keyboard: state.keyboard };
  }

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: state.messages,
    tools: toolDefinitions.map(definition => ({
      type: definition.type,
      function: {
        name: definition.function.name,
        description: definition.function.description,
        parameters: definition.function.parameters,
      },
    })),
    tool_choice: 'auto',
    temperature: 0,
  });

  const message = completion.choices[0]?.message;

  if (message == null) {
    return { text: 'Processing complete.', keyboard: state.keyboard };
  }

  // If no tool calls: LLM produced final text response
  if (message.tool_calls == null || message.tool_calls.length === 0) {
    const responseText = message.content ?? "I didn't understand that. Please try again.";
    return { text: responseText, keyboard: state.keyboard };
  }

  // Tool calls: execute all, feed results back
  const toolResults = await Promise.all(
    message.tool_calls.map(async toolCall => {
      const tool = registry.get(toolCall.function.name);

      if (tool == null) {
        console.error(`[Agent] Unknown tool: ${toolCall.function.name}`);
        return {
          toolCallId: toolCall.id,
          content: `Error: Unknown tool "${toolCall.function.name}"`,
          keyboard: undefined as Keyboard | undefined,
        };
      }

      try {
        const args = tool.parameters.parse(
          JSON.parse(toolCall.function.arguments) as unknown
        );
        const result = await tool.execute(args, toolContext);

        console.log(`[Agent] Tool ${toolCall.function.name} executed`);

        return {
          toolCallId: toolCall.id,
          content: result.content,
          keyboard: result.keyboard,
        };
      } catch (error) {
        console.error(`[Agent] Tool ${toolCall.function.name} error:`, error);
        return {
          toolCallId: toolCall.id,
          content: `Error executing ${toolCall.function.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          keyboard: undefined as Keyboard | undefined,
        };
      }
    })
  );

  // Collect last keyboard from tool results
  const lastKeyboard = toolResults.reduce<Keyboard | undefined>(
    (accumulator, result) => result.keyboard ?? accumulator,
    state.keyboard
  );

  // Build updated messages with assistant + tool results
  const toolResultMessages: OpenAI.ChatCompletionMessageParam[] = toolResults.map(result => ({
    role: 'tool' as const,
    tool_call_id: result.toolCallId,
    content: result.content,
  }));

  const updatedMessages: OpenAI.ChatCompletionMessageParam[] = [
    ...state.messages,
    message,
    ...toolResultMessages,
  ];

  // Recurse with updated state
  return runAgentLoop(client, toolDefinitions, registry, toolContext, {
    messages: updatedMessages,
    keyboard: lastKeyboard,
    iteration: state.iteration + 1,
  });
}

// ============================================
// Main Agent Entry Point
// ============================================

export async function processWithAgent(
  text: string,
  context: AgentContext
): Promise<AgentResponse> {
  const { user, project, environment, chatId } = context;

  // Load working memory, extend TTL
  const workingMemory = await getWorkingMemory(environment.DB, user.id, chatId);

  console.log('[Agent] Working memory:', JSON.stringify({
    hasLastTransaction: workingMemory.lastTransaction != null,
    lastTransactionMerchant: workingMemory.lastTransaction?.merchant,
    recentMessagesCount: workingMemory.recentMessages.length,
  }));

  await extendMemoryTTL(environment.DB, user.id, chatId);

  // Build tool context
  const participants = await getProjectMembers(environment, project.id);

  const membership = await environment.DB.prepare(
    'SELECT display_name FROM project_members WHERE project_id = ? AND user_id = ?'
  ).bind(project.id, user.id).first();
  const payerName = (membership?.display_name as string) ?? user.firstName ?? 'User';

  const toolContext: ToolContext = {
    userId: user.id,
    chatId,
    projectId: project.id,
    projectName: project.name,
    participants,
    defaultCurrency: project.defaultCurrency,
    defaultLocation: project.defaultLocation,
    payerName,
    workingMemory,
    db: environment.DB,
    openaiApiKey: environment.OPENAI_API_KEY,
    // Pass environment for record-tool's semantic search
    ...(({ environment }) => ({ environment }))(context),
  };

  // Build messages: system + conversation history + user message
  const registry = getToolRegistry();
  const toolDefinitions = registry.getForLLM();

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(workingMemory, project.name) },
    ...buildConversationMessages(workingMemory),
    { role: 'user', content: text },
  ];

  // Add user message to working memory
  await addMessage(environment.DB, user.id, chatId, 'user', text);

  const client = new OpenAI({ apiKey: environment.OPENAI_API_KEY });

  try {
    const response = await runAgentLoop(
      client,
      toolDefinitions,
      registry,
      toolContext,
      { messages, iteration: 0 }
    );

    // Save assistant response to memory
    await addMessage(environment.DB, user.id, chatId, 'assistant', response.text);

    return response;
  } catch (error) {
    console.error('[Agent] Error:', error instanceof Error ? error.message : error);
    return { text: 'Something went wrong. Please try again.' };
  }
}

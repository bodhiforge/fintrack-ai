/**
 * Tools Module
 * Pi Agent-inspired tool system for FinTrack AI
 *
 * Exports all tools and the registry for the telegram-bot package.
 */

// Registry
export { ToolRegistry, getToolRegistry, createToolRegistry } from './registry.js';

// Individual Tools
export { recordTool } from './record-tool.js';
export { queryTool } from './query-tool.js';
export { modifyAmountTool } from './modify-amount-tool.js';
export { modifyMerchantTool } from './modify-merchant-tool.js';
export { modifyCategoryTool } from './modify-category-tool.js';
export { deleteTool } from './delete-tool.js';

// Helpers
export type { ModifyDetails } from './modify-helpers.js';

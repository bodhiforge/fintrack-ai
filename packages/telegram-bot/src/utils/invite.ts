/**
 * Invite Code Generator
 */

import { INVITE_CODE_CHARACTERS, Threshold } from '../constants.js';

export function generateInviteCode(): string {
  return Array.from(
    { length: Threshold.INVITE_CODE_LENGTH },
    () => INVITE_CODE_CHARACTERS.charAt(
      Math.floor(Math.random() * INVITE_CODE_CHARACTERS.length)
    )
  ).join('');
}

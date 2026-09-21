export const ENTER_ALT = "\u001b[?1049h";
export const LEAVE_ALT = "\u001b[?1049l";
export const HIDE_CURSOR = "\u001b[?25l";
export const SHOW_CURSOR = "\u001b[?25h";
export const CLEAR_HOME = "\u001b[H\u001b[J";

/**
 * @param {(s: string) => void} write
 * @param {NodeJS.ReadStream | { isTTY?: boolean, setRawMode?: Function, resume?: Function } | null} [stdin]
 */
export function enterTerminal(write, stdin) {
  write(ENTER_ALT + HIDE_CURSOR);
  if (stdin && stdin.isTTY && typeof stdin.setRawMode === "function") {
    stdin.setRawMode(true);
    if (typeof stdin.resume === "function") stdin.resume();
  }
}

/**
 * Restore cursor, leave the alternate screen, and drop raw mode.
 * Safe to call more than once.
 *
 * @param {(s: string) => void} write
 * @param {NodeJS.ReadStream | { isTTY?: boolean, setRawMode?: Function, isRaw?: boolean } | null} [stdin]
 */
export function restoreTerminal(write, stdin) {
  try {
    if (stdin && stdin.isTTY && typeof stdin.setRawMode === "function") {
      stdin.setRawMode(false);
    }
  } catch {
    // stdin may already be destroyed
  }
  write(SHOW_CURSOR + LEAVE_ALT);
}

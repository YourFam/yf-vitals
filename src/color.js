import picocolors from "picocolors";

/**
 * @param {{ isTTY: boolean, env: NodeJS.ProcessEnv }} opts
 */
export function createColor(opts) {
  const enabled = Boolean(opts.isTTY) && opts.env.NO_COLOR === undefined;
  const pc = picocolors.createColors(enabled);
  return {
    enabled,
    cyan: (value) => pc.cyan(String(value)),
    magenta: (value) => pc.magenta(String(value)),
    green: (value) => pc.green(String(value)),
    yellow: (value) => pc.yellow(String(value)),
    dim: (value) => pc.dim(String(value)),
  };
}

/**
 * @param {string} value
 */
export function stripAnsi(value) {
  return String(value).replace(/\u001b\[[0-9;]*m/g, "");
}

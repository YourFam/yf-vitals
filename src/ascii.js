const DUMB_TERM = /^(dumb|unknown)?$/i;

/**
 * ASCII bars when YF_VITALS_ASCII=1, or when WT_SESSION is missing and TERM looks dumb.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function useAscii(env = process.env) {
  if (env.YF_VITALS_ASCII === "1") return true;
  const term = env.TERM ?? "";
  const dumb = DUMB_TERM.test(term);
  return !env.WT_SESSION && dumb;
}

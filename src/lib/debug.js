/**
 * debug — developer tracing that stays quiet in normal use.
 *
 * The pen SDK wrapper, MyScript client and canvas used to print every pen
 * message, recognition dump and render step to the console. That is useful
 * when chasing a pen or recognition problem and noise the rest of the time,
 * so it goes through `debug()`, which prints only in the Vite dev server or
 * when switched on for this profile:
 *
 *   localStorage.setItem('smartpen-debug', '1')   // then reload
 *
 * Problems the user should see still go to the Activity Log (`log()` in
 * stores/ui.js), and warnings and errors still use console.warn / error.
 */
import { readString } from './safe-storage.js';

const enabled = (() => {
  try {
    if (import.meta.env && import.meta.env.DEV && import.meta.env.MODE !== 'test') return true;
  } catch {
    /* no import.meta.env outside Vite */
  }
  return readString('smartpen-debug') === '1';
})();

/** console.log, only when debugging is on. */
export function debug(...args) {
  if (enabled) console.log(...args);
}

export const debugEnabled = enabled;

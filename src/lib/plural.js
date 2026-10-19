/**
 * "1 day", "2 days": the noun that agrees with the count.
 *
 * @param {number} n
 * @param {string} one - singular form
 * @param {string} [many] - plural form; defaults to `one` + "s"
 * @returns {string} the noun only, so callers keep their own markup around the number
 */
export function plural(n, one, many = `${one}s`) {
  return n === 1 ? one : many;
}

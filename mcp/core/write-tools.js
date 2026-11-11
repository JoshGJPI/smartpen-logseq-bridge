/**
 * write-tools — edit_transcript and undo_transcript_edit (v3.18.0). Registered
 * only when the server starts with SMARTPEN_MCP_WRITES=1. They never touch a
 * file: each call is forwarded to the running app (core/app-client.js), which
 * checks it, saves through its own write path and refreshes its views. The data
 * folder this server reads is sent along so the app can refuse a mismatch.
 */
import { requireBookKey, requirePageId } from './paths.js';
import { postToApp, AppError } from './app-client.js';

const text = (t) => ({ type: 'text', text: t });
const fail = (msg) => ({ content: [text(`Error: ${msg}`)], isError: true });

/**
 * @param {string} root  the data folder this server reads
 * @param {{ post?: typeof postToApp }} [opts]  `post` is replaced in tests
 */
export function createWriteTools(root, { post = postToApp } = {}) {
  async function call(body) {
    let r;
    try {
      r = await post({ ...body, data_root: root });
    } catch (e) {
      if (e instanceof AppError) return fail(e.message);
      throw e;
    }
    if (!r.ok) return fail(r.error || 'The app refused the edit');
    return { content: [text(r.text || 'Done')] };
  }

  return {
    edit_transcript(args) {
      const book = requireBookKey(args.book);
      const page = requirePageId(args.page);
      const dryRun = args.dry_run !== false;
      return call({
        action: 'edit', book, page, edits: args.edits, dry_run: dryRun,
        ...(args.revision != null ? { revision: String(args.revision) } : {}),
      });
    },
    undo_transcript_edit(args) {
      return call({ action: 'undo', book: requireBookKey(args.book), page: requirePageId(args.page) });
    },
  };
}

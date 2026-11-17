// SPDX-License-Identifier: MPL-2.0

const PRELOAD_TIMEOUT_MS = 5000;

/** Starts `load`. Never rejects (the converter reports errors) and waits at most
 * PRELOAD_TIMEOUT_MS, or until `signal` aborts, so a stalled download cannot hold up playback or
 * closing. The load itself keeps going for later messages. */
export async function preloadDecoder(
  load: () => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  // an already-aborted signal never fires "abort" (e.g. closed while the source initialized)
  if (signal?.aborted === true) {
    return;
  }
  // a hand-rolled race: every contender settles the same promise, and the timer is cleared
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, PRELOAD_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", done, { once: true });
    void load()
      .catch(() => {})
      .finally(done);
  });
}

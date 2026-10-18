// Restores a saved list offset once the list is tall enough to reach it.
//
// Right after a reload a virtualized list has measured only a few rows, and
// the native content may not even be mounted when JS sees the new layout, so
// Android clamps an early scrollTo to the short content (deep offsets in a
// 10k-row list landed at the top, with no scroll event). The request therefore
// stays pending and is re-sent every frame until the list reports the target
// offset, the user drags, a new load starts, or about a second passes.
//
// request / retry return the offset to scroll to now, or null when done.
export const MAX_RESTORE_ATTEMPTS = 60;

export type ScrollRestore = {
  request(offset: number): number;
  retry(): number | null;
  // False while a restore is pending and `y` is not the target: an offset
  // clamped by a short list must not replace the saved one.
  scrolled(y: number): boolean;
  cancel(): void;
  pending(): boolean;
};

export function createScrollRestore(): ScrollRestore {
  let target: number | null = null,
    attempts = 0;
  const retry = () => {
    if (target !== null && ++attempts > MAX_RESTORE_ATTEMPTS) target = null;
    return target;
  };
  return {
    request(offset) {
      attempts = 0;
      target = offset > 0 ? offset : null;
      return offset > 0 ? offset : 0;
    },
    retry,
    scrolled(y) {
      if (target === null) return true;
      if (Math.abs(y - target) > 1) return false;
      target = null;
      return true;
    },
    cancel() {
      target = null;
    },
    pending: () => target !== null,
  };
}

export interface Scene {
  update(): void;
  draw(): void;
  /** false while menu blips would be wrong (walking, animations). Default: on. */
  readonly menuSounds?: boolean;
}

/** Typewriter text box shared by the island and title screens. */
export class TypeText {
  lines: string[] = [];
  private pages: string[][] = [];
  private page = 0;
  private chars = 0;
  done = true;

  show(pages: string[][]) {
    this.pages = pages;
    this.page = 0;
    this.chars = 0;
    this.done = pages.length === 0;
    this.lines = [];
  }

  /** Returns true while a page is fully shown and waiting for A. */
  get waiting() {
    return !this.done && this.chars >= this.pages[this.page].join('').length;
  }

  tick(a: boolean) {
    if (this.done) return;
    const p = this.pages[this.page];
    const total = p.join('').length;
    if (this.chars < total) {
      this.chars = a ? total : this.chars + 1;
    } else if (a) {
      this.page++;
      this.chars = 0;
      if (this.page >= this.pages.length) {
        this.done = true;
        this.lines = [];
        return;
      }
    }
    let left = this.chars;
    this.lines = this.pages[this.page].map(l => {
      const s = l.slice(0, Math.max(0, left));
      left -= l.length;
      return s;
    });
  }
}

import { appendFileSync, closeSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/**
 * The batch module's one filesystem seam: every file the module reads or writes goes through a `BatchFs`. Nothing here
 * removes, empties or truncates a file or a folder — a run's evidence is never deleted (batch-3's B2 lost its raw
 * data to a second run that emptied its folder). Two things are ever replaced, each by one rename, never emptied
 * first: the latest-out symlink, and only when it is a symlink; and a probe's state file (abort.ts#markDirty).
 * Synchronous on purpose: a step line is on disk before the next step starts, so a run killed
 * mid-step keeps what it wrote.
 */
export interface BatchFs {
  /** Whether anything is at `path` — a file, a folder, or a symlink, dangling or not. */
  exists(path: string): boolean;
  /** The file's text, or undefined when it cannot be read (missing, a folder, no permission). */
  read(path: string): string | undefined;
  /** The names in a folder, sorted; none when it is missing or no folder. */
  list(dir: string): string[];
  /** Make the folder `path`, its parents as needed; throws `EEXIST` when `path` itself exists: never reused. */
  mkdirExclusive(path: string): void;
  /** Write a new file; throws `EEXIST` when one exists: never overwritten. */
  createExclusive(path: string, text: string): void;
  /** Append to a file, creating it. */
  append(path: string, text: string): void;
  /**
   * Point the symlink `link` at `target`: undefined when it does, else why not. A symlink there is replaced; anything
   * else there is kept.
   */
  linkLatest(link: string, target: string): string | undefined;
  /**
   * Replace a file's text whole: written beside it, then renamed over it, so a reader sees the old text or the new,
   * never a part. Only for a probe's state file (abort.ts#markDirty); throws when it cannot (a folder there).
   */
  replace(path: string, text: string): void;
  /**
   * Open `path` for append (creating it, never truncating), hand its fd to `use`, and close it after, even when `use`
   * throws: a child's log, which the child writes itself (bounded.ts hands the fd to proc.ts's start).
   */
  withAppend<T>(path: string, use: (fd: number) => T): T;
  /** The path with its symlinks resolved, as far as it exists (a missing tail is kept as written). */
  real(path: string): string;
}

/** Whether `e` is the EEXIST an exclusive mkdir or create throws: something is already there. */
export const isEexist = (e: unknown): boolean => (e as NodeJS.ErrnoException).code === 'EEXIST';

/** The real filesystem. */
export const nodeFs: BatchFs = {
  exists(path) {
    try {
      lstatSync(path);
      return true;
    } catch {
      return false;
    }
  },
  read(path) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  },
  list(dir) {
    try {
      return readdirSync(dir).sort();
    } catch {
      return [];
    }
  },
  mkdirExclusive(path) {
    mkdirSync(dirname(path), { recursive: true });
    mkdirSync(path);
  },
  createExclusive(path, text) {
    writeFileSync(path, text, { flag: 'wx' });
  },
  append(path, text) {
    appendFileSync(path, text);
  },
  linkLatest(link, target) {
    let isLink = true;
    try {
      isLink = lstatSync(link).isSymbolicLink();
    } catch (e) {
      // Only nothing there means a link is made; any other failure is said, not guessed past.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return `the link could not be checked (${(e as Error).message})`;
    }
    if (!isLink) return 'a file, not a link, is there';
    // A fresh link beside it, renamed over the old one: the old link is replaced in one step, never removed first.
    const fresh = `${link}.${process.pid}.new`;
    try {
      symlinkSync(target, fresh);
      renameSync(fresh, link);
    } catch (e) {
      return `the link could not be made (${(e as Error).message})`;
    }
    return undefined;
  },
  withAppend(path, use) {
    const fd = openSync(path, 'a');
    try {
      return use(fd);
    } finally {
      closeSync(fd);
    }
  },
  replace(path, text) {
    // Checked first, so nothing is written beside a folder that the rename would refuse to replace.
    if (this.exists(path) && !lstatSync(path).isFile()) throw new Error(`${path} is no file: not replaced`);
    const fresh = `${path}.${process.pid}.new`;
    writeFileSync(fresh, text, { flag: 'wx' });
    renameSync(fresh, path);
  },
  real(path) {
    const abs = resolve(path);
    try {
      // .native: the on-disk case too, so on a case-folding filesystem one folder named in two cases resolves the same.
      return realpathSync.native(abs);
    } catch {
      const parent = dirname(abs);
      return parent === abs ? abs : join(this.real(parent), basename(abs));
    }
  },
};

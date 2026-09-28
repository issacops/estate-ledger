import { fakeFiles, resetFakes, restoredPaths } from "./core";

export function resetIoFakes(): void {
  resetFakes();
}

export function ioFiles(): Map<string, Uint8Array> {
  return fakeFiles();
}

export function ioRestored(): string[] {
  return restoredPaths();
}

export async function readFile(path: string): Promise<Uint8Array> {
  const f = fakeFiles().get(path);
  if (!f) throw new Error(`mock fs: no such file ${path}`);
  return f;
}

export async function writeFile(path: string, data: Uint8Array): Promise<void> {
  fakeFiles().set(path, data);
}

export async function mkdir(): Promise<void> {}
export async function exists(): Promise<boolean> {
  return true;
}
export async function stat(): Promise<{ size: number }> {
  return { size: 0 };
}

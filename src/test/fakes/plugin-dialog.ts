let mockOpenPath: string | null = null;

export function setMockOpenPath(p: string | null): void {
  mockOpenPath = p;
}

export async function save(opts?: {
  defaultPath?: string;
}): Promise<string | null> {
  return opts?.defaultPath ?? "mock-save.xlsx";
}

export async function open(_opts?: unknown): Promise<string | string[] | null> {
  return mockOpenPath;
}

export async function confirm(): Promise<boolean> {
  return true;
}
export async function message(): Promise<void> {}
export async function ask(): Promise<boolean> {
  return true;
}

export function splitLines(value: string): string[] {
  return value.split(/\r\n|\r|\n/);
}

export function countLines(value: string): number {
  return Math.max(1, splitLines(value).length);
}

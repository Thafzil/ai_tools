const globalScope = globalThis as typeof globalThis & {
  ngDevMode?: boolean;
};

globalScope.ngDevMode ??= true;

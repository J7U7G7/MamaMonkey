function flag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}
function port(v, dflt) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : dflt;
}

export function resolveConfig({ argv = [], env = {} } = {}) {
  return {
    servePort: port(flag(argv, '--serve-port') ?? env.MM_SERVE_PORT, 8088),
    mmHost: flag(argv, '--mm-host') ?? env.MM_HOST ?? '127.0.0.1',
    mmPort: port(flag(argv, '--mm-port') ?? env.MM_PORT, 18391),
  };
}

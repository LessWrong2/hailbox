/**
 * Prints the version for the next widget release.
 *
 * Normally that's the latest release with its patch number bumped. To start a new minor or
 * major series, set a higher version in packages/hailbox/package.json; since it's ahead of every
 * release, the next release uses it as-is.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function parse(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? match.slice(1).map(Number) : null;
}

function compare(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function nextVersion(packageVersion, tags) {
  const base = parse(packageVersion);
  if (!base) throw new Error(`packages/hailbox/package.json has an unexpected version: ${packageVersion}`);
  const latest = tags.map(parse).filter(Boolean).sort(compare).at(-1);
  const next = !latest || compare(base, latest) > 0 ? base : [latest[0], latest[1], latest[2] + 1];
  return next.join('.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pkg = JSON.parse(readFileSync(new URL('../packages/hailbox/package.json', import.meta.url), 'utf8'));
  const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  console.log(nextVersion(pkg.version, tags));
}

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
for (const page of ['index.html', 'planner/index.html', 'auth/callback/index.html']) {
  const html = readFileSync(`out/${page}`, 'utf8');
  const assets = [...html.matchAll(/(?:src|href)="([^"]*\/_next\/[^"?#]+)[^"]*"/g)].map(match => match[1]);
  assert.ok(assets.length, `${page} must load application assets`);
  for (const asset of assets) {
    assert.ok(asset.startsWith(`${base}/_next/`), `Wrong repository path: ${asset}`);
    assert.ok(existsSync(`out${asset.slice(base.length)}`), `Missing asset: ${asset}`);
  }
}
assert.match(readFileSync('out/index.html', 'utf8'), /Your day/);
console.log('Exported planner, sign-in callback, and repository asset paths verified.');

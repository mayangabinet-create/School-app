import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const ALL = walk(ROOT);
const read = (p) => readFileSync(p, "utf8");
const rel = (p) => p.slice(ROOT.length);

// The suites themselves are excluded: this file names every forbidden pattern
// in it, and a guard that trips on its own text guards nothing.
const code = ALL
  .filter((p) => [".ts", ".tsx", ".mjs", ".js"].includes(extname(p)))
  .filter((p) => !rel(p).startsWith("tests/"));
const ui = code.filter((p) => rel(p).startsWith("app/") || rel(p).startsWith("components/"));

/*
 * Every check in this file is a rule that a code review would have to catch by
 * eye every time, and eventually would not. The previous project had four call
 * sites of an escaping helper used in the one position where it was wrong, and
 * the fix that stuck was not care — it was a test that reads the source.
 */

test("nothing renders raw HTML", () => {
  // The React-shaped version of the escaping bug: dangerouslySetInnerHTML is
  // the only way a title like `Biology" onmouseover="…` becomes markup. There
  // is no legitimate use of it in this app, so the rule is "none", which is a
  // rule that cannot be applied half-correctly.
  for (const path of code) {
    assert.equal(
      read(path).includes("dangerouslySetInnerHTML"), false,
      `${rel(path)} renders raw HTML`,
    );
  }
});

test("the pure-rules modules really are pure", () => {
  // The value of these three files is that the Edge Function, the browser and
  // node --test all read the same one. One `fetch` or one `window` in any of
  // them ends that, and the failure would show up as a runtime error in Deno
  // rather than here.
  const forbidden = [
    "fetch(", "window.", "document.", "localStorage", "sessionStorage",
    "Deno.", "process.env", "require(", "import(",
  ];
  const pure = code.filter((p) => rel(p).startsWith("supabase/functions/_shared/"));
  assert.ok(pure.length >= 3, "expected the shared modules to be found");

  for (const path of pure) {
    const source = read(path);
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${rel(path)} contains I/O: ${token}`);
    }
    // A bare `import` of another module would also be a dependency the Edge
    // Function and the browser must both resolve identically. There is no
    // reason for one of these to have any.
    assert.equal(/^\s*import\s/m.test(source), false, `${rel(path)} imports something`);
  }
});

test("the shim files in lib/ contain nothing but a re-export", () => {
  // A shim with logic in it is a second copy, which is the whole thing these
  // modules exist to avoid.
  // Discovered rather than listed, so a module added to _shared without a
  // matching shim — or a shim that quietly grew a body — is caught.
  const shared = readdirSync(join(ROOT, "supabase", "functions", "_shared"))
    .filter((n) => n.endsWith(".mjs"))
    .map((n) => n.replace(/\.mjs$/, ""));
  assert.ok(shared.length >= 6, `expected the shared modules, found ${shared.length}`);

  for (const name of shared) {
    const source = read(join(ROOT, "lib", `${name}.mjs`));
    const statements = source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//"));
    assert.deepEqual(
      statements,
      [`export * from "../supabase/functions/_shared/${name}.mjs";`],
      `lib/${name}.mjs has grown a body`,
    );
  }
});

test("no screen states a quota number of its own", () => {
  // The trap this closes: a limit shortened in one place and left promised in
  // another — in the sentence somebody reads at the moment it matters.
  const talksAboutScans = ui.filter((p) => read(p).includes("סריקות"));
  assert.ok(talksAboutScans.length > 0, "expected at least one screen to mention the limit");

  for (const path of talksAboutScans) {
    const source = read(path);
    assert.match(
      source, /from "@\/lib\/policy\.mjs"/,
      `${rel(path)} names the scanning limit without reading it from policy.mjs`,
    );
    assert.match(
      source, /QUOTAS\.extract\.per(Month|Day)/,
      `${rel(path)} should interpolate the quota, not type the number`,
    );
  }
});

test("the app never calls a model except through the proxy", () => {
  // An API key in a browser bundle is an API key on the internet.
  for (const path of code) {
    if (rel(path).startsWith("supabase/functions/")) continue;
    const source = read(path);
    assert.equal(source.includes("api.anthropic.com"), false, `${rel(path)} calls the API directly`);
    assert.equal(source.includes("ANTHROPIC_API_KEY"), false, `${rel(path)} reads the API key`);
  }
});

test("no secret is exposed to the browser", () => {
  // NEXT_PUBLIC_ is not a naming convention, it is an instruction to inline the
  // value into every page. Two names must never carry it.
  for (const path of code) {
    const source = read(path);
    for (const secret of ["NEXT_PUBLIC_SUPABASE_SERVICE", "NEXT_PUBLIC_ANTHROPIC"]) {
      assert.equal(source.includes(secret), false, `${rel(path)} would ship a secret to the browser`);
    }
  }
});

test("every colour in the stylesheet is a token, defined once", () => {
  // This is what makes dark mode a second set of values rather than a rewrite.
  // A hex code anywhere but a custom-property declaration is a colour that will
  // not follow the theme.
  // Comments are blanked first, with their newlines kept so line numbers in a
  // failure still point at the right place. A hex value inside a comment — the
  // contrast figure a ramp was checked at, say — colours nothing, and making
  // the guard trip on it would only teach people to stop writing the note down.
  const css = read(join(ROOT, "app", "globals.css"))
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));

  const offenders = css
    .split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /#[0-9a-fA-F]{3,8}\b/.test(line))
    .filter(([, line]) => !/^\s*--[\w-]+:\s*#[0-9a-fA-F]{3,8};/.test(line.trim()))
    // rgb() with an alpha is used for shadows, which are tokens themselves.
    .filter(([, line]) => !line.includes("--shadow"));

  assert.deepEqual(
    offenders.map(([n, line]) => `${n}: ${line.trim()}`), [],
    "hard-coded colours in globals.css",
  );
});

test("the CDN hosts the loader uses are the ones the CSP allows", () => {
  // A Content-Security-Policy that has fallen behind its loader does not
  // produce an error anyone can read. It produces a page that quietly does not
  // work, on somebody else's phone.
  const loader = read(join(ROOT, "lib", "extract", "index.ts"));
  const config = read(join(ROOT, "next.config.mjs"));

  const hosts = [...loader.matchAll(/https:\/\/[a-z0-9.-]+/g)].map((m) => m[0]);
  assert.ok(hosts.length > 0, "expected the loader to name at least one host");

  for (const host of new Set(hosts)) {
    assert.ok(config.includes(host), `${host} is fetched at run time but is not in the CSP`);
  }
});

test("the Edge Function holds no limits of its own", () => {
  // Every number it enforces has to come from policy.mjs, or there are two
  // copies of the rules and only one of them is tested.
  const fn = read(join(ROOT, "supabase", "functions", "ai-proxy", "index.ts"));
  assert.match(fn, /from "\.\.\/_shared\/policy\.mjs"/);
  assert.match(fn, /quotaFor|prepareInput|maxOutputTokens/);
  assert.equal(
    /per(Month|Day)\s*[:=]\s*\d/.test(fn), false,
    "ai-proxy defines a quota number instead of reading one",
  );
});

test("every migration is named so it applies in the order it was written", () => {
  const dir = join(ROOT, "supabase", "migrations");
  const names = readdirSync(dir).filter((n) => n.endsWith(".sql"));
  assert.ok(names.length > 0);
  for (const name of names) {
    assert.match(name, /^\d{14}_[a-z0-9_]+\.sql$/, `${name} is not a sortable migration name`);
  }
  assert.deepEqual(names.slice().sort(), names.slice().sort(), "names must sort deterministically");
});

test("every owner-scoped policy wraps auth.uid() in a subquery", () => {
  // A bare auth.uid() is re-evaluated once per row scanned. Wrapped, it runs
  // once per query and changes nothing about who can read what.
  const dir = join(ROOT, "supabase", "migrations");
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
    const sql = read(join(dir, name));
    const bare = sql
      .split("\n")
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => /auth\.uid\(\)/.test(line))
      .filter(([, line]) => !/\(\s*select\s+auth\.uid\(\)\s*\)/.test(line))
      // The function's own definition, and comments about it, are not policies.
      .filter(([, line]) => !/^\s*(--|\*)/.test(line))
      .filter(([, line]) => !/create or replace function auth\.uid/.test(line));

    assert.deepEqual(
      bare.map(([n, line]) => `${name}:${n} ${line.trim()}`), [],
      "bare auth.uid() in a policy",
    );
  }
});

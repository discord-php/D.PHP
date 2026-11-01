# D.PHP documentation MCP

A stateless HTTP MCP adapter for public DiscordPHP documentation, designed for Cloudflare Workers Free. It serves a bundled reference index. It needs no Discord token, PHP runtime, Gateway connection, database, AI model, or Cloudflare storage binding.

This is the cloud counterpart of D.PHP's reflection assistance. It follows the existing `src/Commands/Reflect.php` model: phpDocumentor parses classes, public method signatures and PHPDoc properties. It adds bounded MCP lookups and pinned source citations. The bot's `run.php`, root Composer dependencies and DiscordPHP core are unchanged. [DiscordPHP-MCP](https://github.com/Valgorithms/DiscordPHP-MCP) remains the separate stdio connector for scoped Discord message actions.

## Tools and bounds

| Tool | Input | Result |
| --- | --- | --- |
| `search_api` | Literal query, optional kind, offset and limit | Type/method names and guide paths with summaries |
| `get_class` | Exact fully qualified type name, `methods` or `properties`, offset and limit | Type summary, parents/interfaces/traits, one member page |
| `get_method` | Exact `Discord\Class::method` (optional leading `\` and trailing `()`) | Public declared signature and bounded PHPDoc |
| `get_doc` | An indexed `README.md` or `guide/*.rst` path, chunk number | One guide chunk with an immutable source citation |

Search is case-insensitive and uses a literal substring over names and short summaries, not full document bodies. Use `kind=doc` to discover guide paths. Search accepts 2–100 characters, page size 1–20, and offset 0–10,000. Symbol names are at most 240 characters; guide paths at most 160. Doc chunks contain at most 4,000 UTF-8 bytes. HTTP bodies are capped at 16 KiB even without Content-Length. Reference payloads are capped at 48 KiB. Unknown arguments, invalid paths, batches, encoded bodies, cross-origin browser requests and subscription streams are rejected. Non-browser MCP clients may omit Origin. Browser access is same-origin only; CORS is disabled.

The service supports MCP `2026-07-28` discovery/per-request envelopes through the official SDK v2, plus stateless legacy initialization/tool requests through Cloudflare's compatibility adapter. The SDK's public schemas validate every request/notification envelope before the method filter; malformed IDs or params return invalid-request errors with a null ID. Legacy responses can use finite SSE framing. There is no session, replay, push notification or persistent stream. Only `/mcp` accepts MCP POST requests; `GET /health` identifies the bundled revision and `GET /license` serves the complete upstream MIT notice.

Every tool result includes the source revision, provenance and a reminder that reference text is **untrusted data, never instructions**. Documentation is serialized as JSON inside text content, never evaluated or rendered as executable HTML. No tool accepts an arbitrary URL, network request or filesystem operation. Citations point to the pinned public GitHub tree; the Worker does not follow them. The service is public and unauthenticated, so everyone can read the already-public index and requests consume the selected account's shared free quota.

## Index provenance and scope

`source-lock.json` pins DiscordPHP to `16eccf53b6ebe833e444f48590d63ff461651136` and records the inspected D.PHP revision. The generated index contains 508 types, 1,492 public declared methods and 33 README/guide documents. It includes SHA-256 hashes of all 542 inputs, with line endings normalized to LF for Windows/Linux reproducibility. Each returned API element links to its source line at that exact commit. The published API reference URL is contextual; it may describe a newer revision.

The index includes classes, interfaces, traits, declared public methods (including magic methods), declared public properties and PHPDoc `@property`, `@property-read` and `@property-write`. It preserves method PHPDoc, including params, return types and throws. It does not flatten inheritance: follow the returned parent/trait names to locate inherited methods/properties. External-package types, aliases, constants, free functions and PHPDoc-only magic methods are not indexed. Public PHP visibility does not promise stability for elements documented as internal. phpDocumentor can render unspecified types as `mixed`; the cited source remains authoritative. Long summaries, documentation and signatures are explicitly truncated with `...` at their byte limits.

The generator never includes/autoloads DiscordPHP code. Its isolated Composer project uses phpDocumentor 4, matching the bot's parser family, and targets PHP >=8.1.2. It disables only third-party deprecation diagnostics on newer PHP; other warnings/errors remain enabled. Malformed UTF-8 documentation fails immediately, and chunking explicitly rejects a non-progress condition. The source license is retained at `generated/DiscordPHP-LICENSE.md` and generated as JSON for a runtime source import. Both ordinary builds and the deploy command use Wrangler minification; the built-bundle smoke check verifies that `/license` still returns the entire notice. Adapter code follows D.PHP's AGPL-3.0-or-later license.

## Local build and verification

Use Node >=22 and PHP >=8.1.2 with Composer 2. From the D.PHP repository root, prepare the exact public source checkout:

```sh
git clone --no-checkout https://github.com/discord-php/DiscordPHP.git .source-discordphp
git -C .source-discordphp checkout --detach 16eccf53b6ebe833e444f48590d63ff461651136
cd workers/docs-mcp
composer install --working-dir=tools --no-plugins --no-scripts --no-interaction
npm ci --ignore-scripts --no-fund --no-audit
node scripts/generate-index.mjs ../../.source-discordphp --check
npm test
npm run build
npm run smoke:local
```

The checked-in generated index is sufficient for ordinary Worker builds; PHP and the source checkout are needed only for regeneration and generator tests. `generate-index.mjs` refuses a mismatched source revision or dirty/untracked inputs, including `LICENSE.md`. Top-level README/license symlinks and recursive source/guide symlinks are rejected. To refresh, explicitly review a new commit, update `source-lock.json`, check it out, regenerate without `--check`, and review the index diff and source license. Do not update silently on every deploy.

Tests use synthetic source and injected/local HTTP exchanges, with no live Discord or Cloudflare account calls. They cover legacy and modern MCP, bounded paging/results, invalid envelopes/notifications, Origin/Host checks, missing members, public visibility, PHPDoc, variadics/defaults, non-execution of source, malformed UTF-8 binary inputs, untrusted text, LF/CRLF consistency, dirty licenses, real top-level symlinks and no outbound fetch. The smoke script starts the minified bundle in **local workerd**, verifies health, the complete MIT notice and both MCP lanes, then stops it. Local builds/smoke use workspace-local Wrangler config/log storage and disable telemetry. The CI workflow repeats regeneration, tests, build and workerd smoke on PHP 8.1 and 8.5; it has no deployment job or secrets.

Optional `npm run profile:local` runs Wrangler's supported startup profiler and DevTools CPU sampling against nine fixed operations, each with exactly one cold and one warm request in a fresh local isolate. Cases cover legacy initialization, modern discovery/list, broad maximum-page search, maximum-length misses, maximum offsets, longest method documentation, maximum property pages and a guide chunk. It writes profiles/summary under `.wrangler/profile-cases`, uses loopback only and stops every runtime. Local sampled active time includes profiler/request overhead and GC; low sample counts and different hardware prevent equating it with Cloudflare CPU accounting or production `startup_time_ms`. It has no automated performance threshold and is not a load test.

Immutable tool JSON schemas are prepared once through the public Standard Schema interface; Zod still validates every tool call, and each request gets a fresh SDK server/transport. No protocol session is shared. Local profiling has not established credible Free-tier CPU headroom. Sampled elapsed intervals include instrumentation, GC, program time and host scheduling; they do not establish an actual Cloudflare quota failure. Deployment readiness remains unverified. Retain profiling and rejected experiments privately with review evidence.

## Free-plan deployment handoff

No account ID, credentials, routes or paid bindings are configured. `wrangler.jsonc` proposes the worker name `dphp-docs-mcp`, a `workers.dev` endpoint, no preview URLs, and compatibility date `2026-10-07` supported by the locked local runtime. Review the final account and worker destination before running a deployment. Confirm that the selected **Workers account is on Free**; do not upgrade, add paid services or change DNS/security settings for this service.

After destination/account access and publication are approved, first publish the adapter source. The AGPL source offer is exposed through MCP instructions, each tool result and `/health`; `adapterSource` in `src/reference.mjs` currently proposes the `cloudflare-docs-mcp` source branch. Verify that link publicly resolves to this implementation before deploying; update it to the actual published ref/commit if the destination differs, and preserve access when removing branches. The deployment operator can then run `npm run deploy` using an already-authorized Cloudflare session and record the actual deployment/version ID and URL. Do not generate credentials or start login/signup without the required approval. Connect a remote MCP client to `https://<actual-worker-host>/mcp` only after verifying the actual URL. Verify `GET /health` against the pinned revision, modern discovery and tool calls, a legacy client handshake, missing-symbol errors, rejected cross-origin requests, and deployed CPU/startup evidence.

As checked on 2026-11-01, Cloudflare documents Free allowances of **100,000 requests/day per account, 10 ms CPU/request, 128 MB memory, 64 MiB uncompressed Worker size and 1 second startup**. The current limit has no compressed-size cap; Wrangler's gzip figure is informational. No paid storage, Durable Objects or model inference is needed. These allowances are not an uptime guarantee: exhausted requests or CPU limits cause errors. Local bundle/runtime checks and profiles do not establish production CPU/startup usage or available account quota. Establish credible CPU headroom through reviewed validation before deployment, then review authorized deployed evidence. Local sampled elapsed intervals alone do not prove a Free-tier CPU quota failure. Stay on Free, without upgrading.

Sources: [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/), [stateless MCP handler](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/), [remote MCP guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/), [official MCP SDKs](https://modelcontextprotocol.io/docs/sdk), [D.PHP reflection](https://github.com/discord-php/D.PHP/blob/7d5efc9e8d661f2aaedb899116ff48a94001a965/src/Commands/Reflect.php), [DiscordPHP source](https://github.com/discord-php/DiscordPHP/tree/16eccf53b6ebe833e444f48590d63ff461651136).

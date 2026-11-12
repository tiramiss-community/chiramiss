# README organization

Approved direction: split documentation by use case, as proposed in the conversation.

Keep the English root README as an overview and entry point (roughly 120–160 lines):
features, library and Docker quick starts, Misskey entry point, documentation links,
ChiramissBot information, performance overview, and license/credits.

Move complete details into `docs/misskey.md`, `docs/library.md`, `docs/server.md`,
`docs/compatibility.md`, and `docs/benchmark.md`. Preserve PR #16's behavior descriptions,
all configuration defaults, security notes, benchmark tables, Notes and Environment.
Keep the bot information reachable from its existing User-Agent URL, and the server
exposure warning beside quick starts. Describe benchmark numbers as historical measurements.

Alternatives considered: moving only compatibility and benchmarks leaves configuration
too long; splitting every advanced topic adds navigation overhead. The approved use-case
split balances discoverability and reading continuity. Keep the npm README self-contained
for installation and basic usage, linking to canonical detailed documentation.

Base the work on PR #16 (`57727eb`). Update relative links and benchmark release instructions.
No runtime behavior, dependencies, or fresh benchmark runs are needed.

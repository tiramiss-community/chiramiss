# chiramiss benchmark

Compares chiramiss with upstream [summaly](https://github.com/misskey-dev/summaly) on the same fake origin, under the same CPU and memory limits. This package is private and not published.

## What is measured

All summarized URLs live on a fake server (`https://origin.bench`) inside a private Docker network. **No third-party site is ever contacted.**

- **S1: latency, one request at a time.** Five page kinds (article, large, Shift_JIS, oEmbed, redirect) at 0 ms and 50 ms added round-trip time. The headline number is the ratio of median latencies for an article page with no added latency, i.e. the cost of summarizing itself. Every page links the same `/favicon.ico`, so chiramiss answers its favicon check from its cache (filled during the warmup) while summaly sends `HEAD /favicon.ico` for every page; the headline says so. An extra row, "article, unique favicon URL", gives every page its own favicon URL so that the cache cannot answer, which shows how much of the gap the cache accounts for. The table also lists origin requests and new connections per summary for each target.
- **S2: concurrent load.** Article pages at 10 / 50 / 100 concurrent requests with 50 ms RTT. Reports requests per second, p50, p99 and error rate.
- **S3: same URL, many requests.** An oEmbed page requested 100 times. S3a sends all requests at once (in-flight sharing); S3b spreads them over time (in-flight sharing plus the result cache). Reports how many requests, bytes and new connections reached the origin.
- **S4: resource use.** CPU time per summary and peak memory, taken from the container's cgroup. CPU time covers only the measured requests. Memory comes from `memory.peak`, which counts from the container's start (startup and warmup included): when the measured requests raised it, the value is their own peak; when they did not, the report shows `≤ N`, an upper bound set by startup and warmup.

A response only counts as successful when it is HTTP 200 and its `title`, `description`, `icon`, `thumbnail`, `sitename` and `url` (the final URL after the redirect) all match the fixture, plus `player.url` for oEmbed. A target that skips work (for example returns `icon: null`) is not counted as fast. Errors are counted and shown as warnings in the report. Runs where the origin saw fewer page fetches than successful responses (a sign that a cache answered) are flagged too.

## Requirements

- Linux with native Docker (Docker Engine, Compose v2), cgroup v2, amd64 or arm64. Docker Engine inside WSL2 works; Docker Desktop is not guaranteed to.
- Node.js and pnpm (see the repository root).

## Running

From the repository root:

```sh
pnpm install
pnpm bench                      # full run, 3 repetitions
pnpm bench --quick              # small smoke run, not for publication
pnpm bench --summaly-image <ref>  # compare with a different summaly image
```

Options: `--runs <n>`, `--summaly-image <ref>`, `--cpus <n>` (default 2), `--memory <size>` (default 1g), `--subnet <cidr>` (default 172.30.250.0/24), `--out <dir>`. Run `pnpm bench --help` for the full text.

Results go to `packages/bench/results/<timestamp>-<sha>/` (`results.json` and `report.md`). That directory is not committed. If any run fails, neither file is written.

### How long it takes

Measured on an i7-14700K under WSL2:

- `--quick`: about 168 seconds when the chiramiss image build is cached; a first build adds roughly 15 seconds.
- Default full run (3 repetitions): **estimated** at 40 to 50 minutes. This is not a measurement; it scales the per-run time of the quick run up to the full request counts. The first chiramiss build and the image pull add a few minutes. Expect it to differ on other machines.

## Certificates

`certs/` holds a CA and a server certificate for `origin.bench`. They exist only for this benchmark, are not secrets, and must never be trusted anywhere else. Regenerate them with `certs/generate.sh` (validity is 100 years).

## Updating the benchmark report for a release

1. Check out the release tag.
2. Make sure the working tree is clean (the report warns when it is not).
3. Run `pnpm bench` without `--quick`.
4. Replace the report in [`docs/benchmark.md`](../../docs/benchmark.md) with the whole of `report.md`: the headline, any warnings, the tables, the Notes and the Environment section. Do not drop the Notes or the warnings; they say what the numbers include (for example the favicon-check cache in S1). Update the introductory measurement date, commit and revision context to match the new run.
5. Update the [main README performance overview](../../README.md#performance) to match the report, including the measurement date, commit and favicon-cache conditions. Keep the full tables and caveats in `docs/benchmark.md`.

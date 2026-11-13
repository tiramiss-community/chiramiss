# Benchmark

[← README](../README.md)

Measured with the benchmark in [`packages/bench`](../packages/bench), which compares chiramiss (built from this
repository) with the official summaly Docker image under the same limits, against a local fake site, so that no
third-party site is contacted. See [its README](../packages/bench/README.md) for what each scenario measures and how
to reproduce the numbers (`pnpm bench`). The report below is pasted as is.

These measurements were taken on 2026-11-12 at commit
[`90e1c62`](https://github.com/tiramiss-community/chiramiss/commit/90e1c627b5c3ab6d322e501e5f5f396a82b4cf29),
before the GET-first change in [PR #16](https://github.com/tiramiss-community/chiramiss/pull/16).
They describe that revision, rather than a measurement of the current checkout.

**chiramiss summarizes a typical article page 6.6× faster than summaly** (median, no added network latency — the cost of summarizing itself; includes chiramiss's favicon-check cache: per page, summaly sent 1.0 `HEAD /favicon.ico` and chiramiss 0.0).

With a favicon URL unique to every page, so that chiramiss's favicon-check cache cannot answer: 5.5×.

Across page types: 1.5×–80.5×.

### S1: one request at a time (latency, ms)

| S1 (ms) | summaly p50 | summaly p95 | summaly origin requests / summary | summaly new connections / summary | chiramiss p50 | chiramiss p95 | chiramiss origin requests / summary | chiramiss new connections / summary | ratio (p50) | run-to-run p50 range |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| article, rtt 0ms | 14.1 | 17.2 | 3.0 | 0.0 | 2.1 | 4.0 | 2.0 | 0.0 | 6.6× | summaly 14.1–14.2; chiramiss 1.9–3.2 |
| article, rtt 50ms | 167.3 | 170.9 | 3.0 | 0.0 | 104.8 | 105.7 | 2.0 | 0.0 | 1.6× | summaly 166.9–167.4; chiramiss 104.5–105.0 |
| article, unique favicon URL, rtt 0ms | 14.3 | 17.1 | 3.0 | 0.0 | 2.6 | 3.1 | 3.0 | 0.0 | 5.5× | summaly 14.1–14.4; chiramiss 2.5–2.7 |
| article, unique favicon URL, rtt 50ms | 167.3 | 169.9 | 3.0 | 0.0 | 156.7 | 157.9 | 3.0 | 0.0 | 1.1× | summaly 167.0–167.4; chiramiss 156.6–156.8 |
| large, rtt 0ms | 382.1 | 394.1 | 3.0 | 0.0 | 4.7 | 6.6 | 2.0 | 0.0 | 80.5× | summaly 380.0–384.8; chiramiss 4.7–4.8 |
| large, rtt 50ms | 537.6 | 549.8 | 3.0 | 0.0 | 107.3 | 112.1 | 2.0 | 0.0 | 5.0× | summaly 534.4–541.4; chiramiss 107.1–107.6 |
| sjis, rtt 0ms | 13.5 | 16.1 | 3.0 | 0.0 | 2.1 | 2.8 | 2.0 | 0.0 | 6.3× | summaly 13.4–13.6; chiramiss 2.0–2.3 |
| sjis, rtt 50ms | 166.6 | 170.1 | 3.0 | 0.0 | 104.8 | 105.6 | 2.0 | 0.0 | 1.6× | summaly 166.4–166.6; chiramiss 104.7–104.9 |
| oembed, rtt 0ms | 3.8 | 5.1 | 4.0 | 0.0 | 2.5 | 3.1 | 3.0 | 0.0 | 1.5× | summaly 3.7–3.9; chiramiss 2.5–2.5 |
| oembed, rtt 50ms | 157.7 | 159.9 | 4.0 | 0.0 | 156.5 | 157.7 | 3.0 | 0.0 | 1.0× | summaly 157.6–157.7; chiramiss 156.4–156.6 |
| redirect, rtt 0ms | 14.7 | 18.1 | 4.0 | 0.0 | 2.6 | 3.2 | 3.0 | 0.0 | 5.6× | summaly 14.3–14.8; chiramiss 2.5–2.8 |
| redirect, rtt 50ms | 219.2 | 222.3 | 4.0 | 0.0 | 156.5 | 157.5 | 3.0 | 0.0 | 1.4× | summaly 218.5–219.4; chiramiss 156.4–156.7 |

### S2: concurrent load (rtt 50ms, article)

| S2 | summaly req/s | summaly p50 (ms) | summaly p99 (ms) | summaly errors | chiramiss req/s | chiramiss p50 (ms) | chiramiss p99 (ms) | chiramiss errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| concurrency 10 | 42.9 | 230.5 | 272.5 | 0.0% | 80.8 | 106.6 | 313.8 | 0.0% |
| concurrency 50 | 68.8 | 721.2 | 935.7 | 0.0% | 357.6 | 106.5 | 415.4 | 0.0% |
| concurrency 100 | 74.8 | 1331.1 | 2149.3 | 0.0% | 540.9 | 115.1 | 471.4 | 0.0% |

### S3: same URL requested many times (rtt 50ms, oEmbed page)

| S3 | summaly origin requests | summaly origin KiB | summaly new connections | summaly p50 (ms) | chiramiss origin requests | chiramiss origin KiB | chiramiss new connections | chiramiss p50 (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| S3a (in-flight sharing) | 400 | 461.1 | 74.3 | 571.4 | 3 | 3.5 | 0.0 | 192.0 |
| S3b (in-flight sharing + result cache) | 400 | 369.6 | 4.0 | 159.5 | 3 | 3.5 | 0.0 | 1.0 |

### S4: resource use

CPU time is the container CPU consumed per summary while the measured requests ran (mean over runs; startup and warmup excluded). Peak memory is the highest memory use of the container while the measured requests ran (maximum over runs), from the cgroup's `memory.peak`. `memory.peak` counts from the container's start, so when the measured requests never went above the peak already reached during startup and warmup, only an upper bound is known: those cells read `≤ N`, where N is that earlier peak.

| S4 | summaly CPU ms / summary | summaly peak MiB | chiramiss CPU ms / summary | chiramiss peak MiB |
| --- | ---: | ---: | ---: | ---: |
| S1 | 89.63 | 142.3 | 4.06 | 107.0 |
| S2 | 16.17 | 224.7 | 1.76 | 100.1 |
| S3a | 5.61 | 169.9 | 0.39 | 82.7 |
| S3b | 6.88 | 72.6 | 0.94 | ≤ 71.1 |

### Notes

- Favicon check (S1, article, rtt 0ms): per summary, summaly sent 1.0 `HEAD /favicon.ico` and chiramiss 0.0. chiramiss caches the result of a favicon check per favicon URL for 5 minutes. Every page here links the same `/favicon.ico`, so after the warmup chiramiss answers the check from that cache, while summaly checks again for every page. This is production behaviour for pages of one site, not the cost of an isolated summary. The "article, unique favicon URL" rows give every page its own favicon URL so that the cache cannot answer; the difference from the "article" rows is what the cache saves.
- Connections (S1, article, rtt 0ms): per summary, summaly made 3.0 origin requests over 0.0 new connections, chiramiss 2.0 over 0.0. Fewer than 1.0 new connections per summary would mean connections were reused from one summary to the next. The S1 table lists both numbers for every page.
- Large page (80.5× at rtt 0ms): the page is a short `<head>` followed by about 1.5 MB of body. The origin sent 1.43 MiB per summary to summaly and 1.43 MiB to chiramiss, so both downloaded the whole page. chiramiss tokenizes the HTML only up to `</head>` and stops; summaly parses the whole document. Most of this gap is parsing work that chiramiss skips.
- The origin is a fake server on a private network (`origin.bench`); no third-party site is contacted. `rtt` is a delay added at the origin by a TCP proxy, in milliseconds of round-trip time.
- S1 and S2 use a distinct URL for every request, so neither target can answer from its result cache.

### Environment

- Started: 2026-11-12T08:06:52.347Z
- chiramiss: commit 90e1c627b5c3ab6d322e501e5f5f396a82b4cf29, working tree clean, Node 26.13.1
- summaly: image ghcr.io/misskey-dev/summaly:5.6.0, digest ghcr.io/misskey-dev/summaly@sha256:1d3785156565ce9ba6809879d60c3cdb963f0ec00acaba5d8cb7b88dde3ee3ff, Node 26.13.1
- Limits per target: 2 CPUs, 1g memory
- Host: Intel(R) Core(TM) i7-14700K, 28 logical CPUs, 31.2 GiB RAM, Linux 6.18.40.1-microsoft-standard-WSL2, Docker 29.8.1

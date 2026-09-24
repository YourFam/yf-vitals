# yf-vitals

Live CPU, RAM, disk, and network bars (plus GPU when the OS exposes it) in your terminal.

Works on any machine with **Node 20+**. No git repo. No API key. Press **q** to quit.

- **Source / README:** https://github.com/YourFam/yf-vitals
- **npm:** https://www.npmjs.com/package/@yourfam/yf-vitals
- **Unscoped alias:** https://www.npmjs.com/package/yf-vitals
- **Issues:** https://github.com/YourFam/yf-vitals/issues

## Install

Node 20+.

```bash
npx yf-vitals
npx yf-vitals --low-power
npx yf-vitals --interval 0.5
npx yf-vitals --full
npx yf-vitals --process
npx yf-vitals --full --process

npm install -g @yourfam/yf-vitals
yf-vitals
```

Friend one-liners: `npx @yourfam/yf-vitals` **and** `npx yf-vitals`.

`npx yf-vitals` is the unscoped alias of `@yourfam/yf-vitals` (same CLI, same version). Both are yours.

The command is `yf-vitals`. It does not need a git work tree; `cwd` can be anywhere.

## What you see

One live dashboard. Refresh every **1.0s** (or `--interval`, or **2.0s** with `--low-power`).

| Row | Meaning |
|---|---|
| **CPU** | Overall utilization 0–100%, plus physical / logical core counts |
| **RAM** | Percent used, plus used / total (`GiB` / `MiB`) |
| **GPU** | Utilization and VRAM when telemetry exists; **the row is omitted** when it does not |
| **DSK** | Read and write **rates** (KiB/s, MiB/s, GiB/s) |
| **NET** | Send ↑ and receive ↓ in **kbps / Mbps / Gbps** (decimal bits; 1 Mbps = 1e6 bit/s) |
| **C: / D: / Data** | Capacity last: one fill bar per local partition, no sparkline. Skips Google Drive, iCloud, network, FAT/USB |

Header: `yf-vitals` · hostname · OS · `NP/NL` cores · RAM total · tick interval. `--full` adds a clock.

CPU, RAM, and GPU each have a 20-cell bar and a one-line sparkline of the last 60 ticks. Capacity rows are the bar, percent, and used/total only. Unused spark slots use the lowest tick (`▁` / `_`), not blank space. Bar fill stays the row color below 50%, turns **yellow at 50%**, **red at 80%**. Sparklines stay the row color.

Disk and net each show **two** sparks (`R`/`W`, `↑`/`↓`) scaled to the **max of that pair** in the buffer (rates have no 100% ceiling). CPU / RAM / GPU sparks are percent 0–100.

First disk/net tick may show `—` while counters settle.

`NO_COLOR` turns off ANSI. `YF_VITALS_ASCII=1` forces `#`/`-` bars and `_-=#` sparks (also used when `WT_SESSION` is missing and `TERM` looks dumb).

Pipes and CI print `yf-vitals needs a terminal.` and exit 1 (no redraw loop).

## Flags

| Token | Default | Meaning |
|---|---|---|
| *(none)* | | Live dashboard, 1.0s tick |
| `--interval <seconds>` | `1` | Tick period, `0.25`–`10`. Also `--interval=1` |
| `--low-power` | off | Tick **2.0s** (wins over `--interval`) |
| `--full` | off | Taller CPU / RAM / GPU charts (4 rows, shrinking to 2 then 1 on a short window), 40-cell bars, sparks out to the window width, one heat-colored tick per logical core, header clock, GPU temperature and watts when the sample has them. Swap (`SWP`) appears under RAM only when swap is in use |
| `--process` | off | Eight rows under the meters: CPU, RAM, and NVIDIA GPU side by side (stacked when the window is under 76 columns). Grouped by process name. CPU% and GPU% use the same heat colors as the bars. Refreshed about every 2s and does not block the first paint. The GPU column is omitted when `nvidia-smi` has no per-process sample |
| `--help` / `-h` | | Usage. Exit 0 |
| `--version` / `-V` | | Package version. Exit 0 |

`--full` and `--process` combine: tall meters, then the process block. On a short window the charts shrink first, then process rows drop from the bottom.

Quit: `q` / `Q` / Ctrl+C. The terminal is restored (cursor on, no leftover alt-screen).

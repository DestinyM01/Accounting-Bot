# Security and Versions Roadmap (2026-09-26)

The project code review of 2026-09-26 raised 14 findings. The user also asked to move to Node 24 (Node 20 is end-of-life) and to upgrade MongoDB from 4.4.

The work ships as four rounds, **A → B → C → D**. Each round has its own spec, plan, review and deploy.

| Round | Scope | Findings |
|---|---|---|
| **A — CI hardening** | Builds on GitHub-hosted runners, not the self-hosted LXC runner; the api tests gate every image push; the retired bot's image is no longer built | 1, 7 |
| **B — Code-review fixes** | JWT owner check, DKIM-verified bank mail, safe entity decoding, clean shutdown, an ingestion watermark, a Dashboard refresh that survives an error, server-side search, budget validation, safe CSV cells, Statistics chart cleanup, ordinals | 2, 4, 5, 6 (shutdown), 8–14 |
| **C — Node 24 and framework upgrades** | Node 24 in the images and CI; NestJS 10→11; Angular 17→18→19→20 with Material; TypeScript; current pnpm and nginx | — |
| **D — MongoDB upgrade and hardening** | AVX check (5.0+ needs it; a Proxmox VM needs CPU type `host`); backup; 4.4→5.0→6.0→7.0→8.0 with `setFeatureCompatibilityVersion` at each step; authentication; a NetworkPolicy; a single-node replica set, then transactions for a row and its balance change | 3, 6 (atomicity) |

**Why this order:**
- **A first:** tests gate every later change, and no code from the internet runs on the LAN during the upgrades.
- **B before C:** bugs are fixed on the known stack first.
- **D last:** it changes data, needs the user at the console, and lays the foundation for transactions.

**AVX check,** for the user to run before D:

```bash
kubectl -n accounting-bot exec mongodb-0 -- grep -m1 -o -w avx /proc/cpuinfo
```

It prints `avx` when the CPU supports it, and nothing when it doesn't.

## AVX check result (2026-09-26)

- **The k3s node that runs MongoDB** (`k3scontrolnode`) is a **KVM VM**. `systemd-detect-virt` gives `kvm`, and its CPU shows as "Common KVM processor", Proxmox's generic `kvm64` type. `grep avx /proc/cpuinfo` finds nothing, so **AVX is hidden**.
- **The Proxmox host has AVX.** `grep -m1 -o -w avx /proc/cpuinfo` prints `avx`.
- **Round D's first step:**
  1. Set that VM's CPU type to `host` (Proxmox → the VM → Hardware → Processors → Type).
  2. Fully **shut down and start** the VM; a reboot from inside isn't enough.
  3. Check that `avx` appears in the MongoDB pod.
  4. Only then upgrade past 4.4.
- **Other nodes.** If other k3s nodes could run MongoDB, either pin MongoDB to this node or give those VMs the same CPU type.

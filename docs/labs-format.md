# Guided lab format

Guided labs are short, hands-on exercises with automatic checking. A lab is one
static JSON file. The checker looks at the state of the simulated network, not
at the commands the learner typed, so any correct way to reach the goal passes.

- Lab files live in `public/labs/<id>.json` and are served from `labs/<id>.json`.
- The list shown in the panel (id, title, level, minutes, summary) is a short
  index in `src/features/guided-labs/domain/catalog.ts`. A lab file is fetched
  with one plain same-origin GET when the learner starts it. There are no query
  strings, cookies or identifiers, and nothing else leaves the browser.
- Progress (which tasks passed) is stored only in the browser, in the storage
  slot `netsim.guided-labs.progress.v1`.
- Lab text must stay vendor neutral: no trademarks and no certification names in
  titles or descriptions. Use the documentation address ranges `192.0.2.0/24`,
  `198.51.100.0/24` and `203.0.113.0/24`.

## File layout

```json
{
  "formatVersion": 1,
  "id": "vlans-and-trunks",
  "title": "VLANs and trunking",
  "level": "beginner",
  "minutes": 20,
  "summary": "One sentence for the lab list.",
  "objectives": ["What the learner will practise"],
  "setup": {
    "devices": [{ "name": "SW1", "model": "Huawei-S5700-28TP" }],
    "links": [{ "from": "SW1:GE0/0/24", "to": "SW2:GE0/0/24" }],
    "ports": [{ "device": "PC1", "port": "eth0", "ip": "192.0.2.11", "prefix": 24 }]
  },
  "tasks": [
    {
      "id": "create-vlans",
      "title": "Create the VLANs",
      "description": "What to achieve, in plain words.",
      "hints": ["Gentle hint", "More explicit hint", "Example commands"],
      "criteria": [
        { "type": "vlan-exists", "device": "SW1", "vlan": 10, "label": "VLAN 10 exists on SW1" }
      ]
    }
  ]
}
```

| Field | Rules |
|---|---|
| `formatVersion` | Must be `1`. |
| `id` | `a-z`, `0-9` and `-`, at most 48 characters; must equal the file name and be listed in the catalog. |
| `level` | `beginner`, `intermediate` or `advanced`. |
| `setup.devices` | Up to 12; `name` is the host name on the canvas and is unique; `model` is a catalog model (`PC` for hosts). |
| `setup.links` | Up to 24 cables, `"<device>:<port>"` on both ends. Port names match as written in the console (`GE0/0/1`, `GigabitEthernet 0/0/1`). |
| `setup.ports` | Initial settings: `ip` with `prefix`, and/or an access `vlan`. |
| `tasks` | Up to 12, in order. Each has up to 6 `hints` (gentle first) and 1 to 16 `criteria`. A task passes when all its criteria pass. |

A lab passes when every task passes. Files are validated by `parseGuidedLab`:
size limit 40 000 bytes, unknown keys dropped, every criterion must name devices
that exist in the lab.

## Criteria

Each criterion has a `type` and a `label` (shown next to its pass or fail mark).
When it fails, the checker adds a short observation such as "SW2 has no VLAN 10".

| `type` | Fields | Passes when |
|---|---|---|
| `vlan-exists` | `device`, `vlan` | The VLAN is in the device's VLAN table. |
| `port-access-vlan` | `device`, `port`, `vlan` | The port is an access port in that VLAN. |
| `trunk-allows` | `device`, `port`, `vlan` | The port is a trunk (or hybrid) port that carries the VLAN. |
| `l2-reachable` | `a`, `b`, `expected` (default `true`) | Frames can travel between the two devices over the VLAN-aware switching graph, honouring access and trunk ports, VLAN tables and ports blocked by spanning tree. |
| `stp-enabled` | `device` | Spanning tree is enabled on the switch. |
| `stp-root` | `device` | The device is the only elected root bridge. |
| `stp-blocked-ports` | `count` | Exactly that many ports are blocked by spanning tree. |
| `ospf-enabled` | `device` | OSPF is running on the router. |
| `ospf-adjacency` | `a`, `b` | The two routers are OSPF neighbours. |
| `ospf-route` | `device`, `prefix` (`198.51.100.0/30`) | The router learned the prefix from another router through OSPF. |

## How criteria read the network

The simulator stores configuration (VLAN tables, port modes, spanning tree
settings, OSPF settings, addresses) but does not run the protocols. The checker
therefore derives protocol state from that configuration in
`src/features/guided-labs/domain/network.ts`, a pure function of the devices and
cables:

- **Spanning tree**: bridge ID is priority then MAC address; the lowest wins per
  group of connected switches. Port cost is 20000 (2000 for 10G ports). Each
  other switch picks its root port by path cost, then neighbour bridge ID, then
  port name. On every link the end closer to the root is designated; the far end
  is the root port or is blocked.
- **VLANs**: a port carries a VLAN when it is up and enabled, the switch knows
  the VLAN, and the port is an access port in it or a trunk that allows it (or
  uses it as native VLAN).
- **OSPF** (single area): a port takes part when OSPF is enabled and one of the
  device's network statements covers its address. Two routers are neighbours when
  they share a link, the interface addresses are in the same subnet and area,
  router IDs are set and different, and hello and dead timers match. A router
  learns every prefix advertised by routers in its neighbour group.

OSPF is configured with single-line commands in system view:
`ospf <id>`, `ospf <id> router-id <ip>` and
`ospf <id> area <area> network <ip> <wildcard>`. Statements are kept as
`network` entries in the device's `ospfLsdb`.

The feature also registers the existing `port link-type`, `port default vlan`,
`port trunk allow-pass vlan` and `stp` commands (see `feature.commands.ts`),
which the command library already contained but the executor did not register.
In the consoles an interface is selected by its short name, for example
`interface GE0/0/1`.

## Adding a criterion type

1. Add it to `Criterion` and `CRITERION_TYPES` in `domain/types.ts`.
2. Parse its fields in `parseCriterion` (`domain/guards.ts`).
3. Evaluate it in `evaluateCriterion` (`domain/criteria.ts`), deriving any new
   state in `domain/network.ts`.
4. Add a row to the table above and tests for a solved and an unsolved state.

## Adding a lab

1. Write `public/labs/<id>.json` and add its entry to `LAB_LISTINGS`.
2. Add a console solution to `SOLUTIONS` in `src/tests/features/guided-labs/fixtures.ts`
   and tests for the untouched topology, the solved one and at least one near miss.
   The test suite also checks the vendor-neutral wording and the address ranges.

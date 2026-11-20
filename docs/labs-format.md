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
    "ports": [{ "device": "PC1", "port": "eth0", "ip": "192.0.2.11", "prefix": 24 }],
    "vlans": [{ "device": "SW1", "vlans": [10, 20] }],
    "routes": [{ "device": "R1", "prefix": "203.0.113.0/24", "nextHop": "198.51.100.2" }]
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
| `setup.ports` | Initial settings: `ip` with `prefix`, an access `vlan`, a `gateway` (hosts), a port `mode` (`access` or `trunk`) and, for a trunk, `allowedVlans`. |
| `setup.vlans` | Optional. VLANs that already exist on a switch: `{ "device", "vlans": [10, 20] }`. For labs that start from a prebuilt (broken) network. |
| `setup.routes` | Optional. Static routes that already exist: `{ "device", "prefix": "203.0.113.0/24", "nextHop" }`. |
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
| `static-route` | `device`, `prefix`, `nextHop` | The device has that static route. |
| `ip-reachable` | `from`, `address`, `expected` (default `true`) | A ping from the device to the address works, request and reply, following connected networks, static routes, default gateways, VLAN interfaces and access lists. |
| `service-reachable` | `from`, `address`, `protocol` (`tcp` or `udp`), `port`, `expected` (default `true`) | Like `ip-reachable`, but the request is a TCP or UDP flow to that port (from a high source port) and the reply comes back from it, so access list rules that match a protocol or port apply. |
| `vlanif-address` | `device`, `vlan`, `address`, `prefix` | The VLAN interface has that address. |
| `eth-trunk-mode` | `device`, `trunk`, `mode` (`static`, `active`, `passive` or `lacp` for either LACP mode) | The Eth-Trunk is in that mode. |
| `eth-trunk-members` | `device`, `trunk`, `count` | The Eth-Trunk has at least that many member ports. |
| `eth-trunk-up` | `a`, `b`, `trunk`, `count` | At least that many cables are bundled between the two switches: the far ports are members of an Eth-Trunk on the other switch whose mode can negotiate (static with static, or LACP with at least one active side). |
| `port-feature` | `device`, `port`, `feature` (`portfast`, `bpdu-guard`, `port-security`), `enabled` (default `true`), `maxMacs` (port security only) | The feature is on (or off, when `enabled` is `false`) for the port. |

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
- **OSPF**: a port takes part when OSPF is enabled and one of the device's network
  statements covers its address (the first matching statement gives the area).
  Two routers are neighbours when they share a link, the interface addresses are
  in the same subnet and area, router IDs are set and different, and hello and
  dead timers match. Routers share what they know inside an area. A router with
  an interface in area 0 (an area border router) passes routes between area 0 and
  its other areas; areas that do not touch area 0 do not exchange routes. Each
  learned route keeps the neighbour address on the link it came from as next hop
  and the lowest hop count wins. The simulator does not model link costs, stub
  areas or route filtering.

OSPF is configured with single-line commands in system view:
`ospf <id>`, `ospf <id> router-id <ip>` and
`ospf <id> area <area> network <ip> <wildcard>`. Statements are kept as
`network` entries in the device's `ospfLsdb`.

- **IP reachability** (`domain/l3.ts`): a packet is followed hop by hop. A device
  uses the longest matching prefix among its connected networks, the routes it
  learned through OSPF, its static routes and its default gateway (on equal
  prefix lengths the earlier of that list wins, and among static routes the
  first one written). A static route to 0.0.0.0/0 acts as a default route. The next hop must be an address on a shared
  segment: a direct cable, switches in the same VLAN between the two, or a VLAN
  interface of the switch the host is cabled to. Access list rules are matched
  in order like the simulator does (first match; only `deny` blocks) on the
  outgoing port of one device and the incoming port of the next. A plain ping has
  no protocol or port, so it only matches rules whose protocol is `any`; a
  `service-reachable` flow also matches `protocol=` and `dstport=` / `srcport=`.
- **Link aggregation**: see `eth-trunk-up` above.

The simulator does not model DHCP leases (the address allocation helper is a
stub), so there is no DHCP lab.

The feature also registers commands that the command library already contained
but the executor did not register (see `feature.commands.ts`): `port link-type`,
`port default vlan`, `port trunk allow-pass vlan`, `stp`, `portfast`,
`bpdu guard`, `port-security`, `eth-trunk <id>` (add a port to a group),
`ip route-static` and `acl rule add` / `acl rule delete`. The library had no
command to remove a static route, so the labs add `undo ip route-static <network>
<mask> [<next-hop>]`. Two are wrapped:
`ip route-static` also accepts a dotted mask, and `acl rule add` takes the port
name (for example `GE0/0/1`) instead of an internal port id.
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

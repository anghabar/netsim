import type { Flashcard, FlashcardDeck } from '../domain/types';

export const BUILT_IN_DECKS: readonly FlashcardDeck[] = [
  {
    id: 'addressing',
    name: 'IPv4 addressing',
    description: 'Prefixes, masks and subnet arithmetic.',
    cards: [
      {
        id: 'addr-usable-26',
        front: 'How many usable host addresses does a /26 IPv4 subnet have?',
        back: '62. A /26 leaves 6 host bits: 2^6 = 64 addresses, minus the network and broadcast addresses.',
        hint: 'Usable hosts = 2^(32 - prefix) - 2.',
        difficulty: 'easy',
        tags: ['subnetting'],
      },
      {
        id: 'addr-mask-27',
        front: 'Write the dotted-decimal mask of a /27 prefix.',
        back: '255.255.255.224\nThe last octet keeps its three high bits: 128 + 64 + 32 = 224.',
        difficulty: 'easy',
        tags: ['subnetting'],
      },
      {
        id: 'addr-network-77',
        front: 'What is the network address of 192.0.2.77/27?',
        back: '192.0.2.64\nA /27 uses blocks of 32 addresses (0, 32, 64, 96, ...) and 77 falls in the block that starts at 64.',
        hint: 'Find the block size first: 2^(32 - 27).',
        difficulty: 'medium',
        tags: ['subnetting'],
      },
      {
        id: 'addr-broadcast-26',
        front: 'What is the broadcast address of 198.51.100.64/26?',
        back: '198.51.100.127\nThe block holds 64 addresses, from .64 to .127; the last one is the broadcast address.',
        difficulty: 'medium',
        tags: ['subnetting'],
      },
      {
        id: 'addr-p2p-31',
        front: 'Which prefix length saves addresses on point-to-point links, and how many addresses does it hold?',
        back: '/31: two addresses, both usable on a point-to-point link.\nA /30 holds four addresses, of which two are usable.',
        difficulty: 'hard',
        tags: ['subnetting', 'design'],
      },
    ],
  },
  {
    id: 'switching',
    name: 'Switching',
    description: 'VLANs, spanning tree and link aggregation.',
    cards: [
      {
        id: 'sw-dot1q-range',
        front: 'How many bits does the 802.1Q VLAN ID use, and which IDs can be assigned?',
        back: '12 bits. IDs 1 to 4094 can be assigned; 0 and 4095 are reserved.',
        difficulty: 'medium',
        tags: ['vlan'],
      },
      {
        id: 'sw-access-trunk',
        front: 'What is the difference between an access port and a trunk port?',
        back: 'An access port belongs to one VLAN and exchanges untagged frames.\nA trunk port carries several VLANs and marks each frame with an 802.1Q tag.',
        difficulty: 'easy',
        tags: ['vlan', 'trunk'],
      },
      {
        id: 'sw-stp-root',
        front: 'How does spanning tree choose the root bridge?',
        back: 'The lowest bridge ID wins: priority first (default 32768), then the lowest MAC address as tie-breaker.',
        difficulty: 'medium',
        tags: ['stp'],
      },
      {
        id: 'sw-rstp-states',
        front: 'Which port states does Rapid Spanning Tree use?',
        back: 'Discarding, learning and forwarding.\nDiscarding replaces the disabled, blocking and listening states of the original protocol.',
        difficulty: 'medium',
        tags: ['stp'],
      },
      {
        id: 'sw-lacp-modes',
        front: 'LACP: what is the difference between active and passive mode?',
        back: 'Active ports send LACPDUs on their own; passive ports only answer.\nTwo passive ends never form a bundle.',
        difficulty: 'medium',
        tags: ['lacp'],
      },
    ],
  },
  {
    id: 'routing-services',
    name: 'Routing and services',
    description: 'Route selection, OSPF, DHCP and gateway redundancy.',
    cards: [
      {
        id: 'rt-longest-prefix',
        front: 'Several routes match a destination address. Which one does the router use?',
        back: 'The one with the longest matching prefix (the most specific route).\nPreference and metric only decide between routes to the same prefix.',
        difficulty: 'easy',
        tags: ['routing-table'],
      },
      {
        id: 'rt-ospf-hello',
        front: 'What are OSPF Hello packets for, and what are the default timers on a broadcast link?',
        back: 'They discover neighbours and keep adjacencies alive.\nDefault on broadcast links: Hello every 10 s, dead interval 40 s.',
        difficulty: 'easy',
        tags: ['ospf'],
      },
      {
        id: 'rt-ospf-dr',
        front: 'On an OSPF broadcast segment, with which routers does a router become fully adjacent?',
        back: 'Only with the designated router (DR) and the backup designated router (BDR).\nOther neighbours stay in the 2-Way state.',
        difficulty: 'medium',
        tags: ['ospf'],
      },
      {
        id: 'rt-dhcp-exchange',
        front: 'Name the four messages of a DHCP address assignment, in order.',
        back: 'Discover, Offer, Request, Acknowledge.',
        hint: 'The initials spell DORA.',
        difficulty: 'easy',
        tags: ['dhcp'],
      },
      {
        id: 'rt-vrrp-master',
        front: 'Which router becomes the VRRP master, and what is the default priority?',
        back: 'The router with the highest priority (default 100; the owner of the virtual address uses 255).\nOn a tie, the highest primary IP address wins.',
        difficulty: 'medium',
        tags: ['vrrp'],
      },
    ],
  },
  {
    id: 'troubleshooting',
    name: 'Troubleshooting',
    description: 'Typical symptoms and the first thing to check.',
    cards: [
      {
        id: 'ts-inter-vlan',
        front: 'Two hosts on the same switch but in different VLANs cannot ping each other. What is missing?',
        back: 'A layer-3 gateway between the VLANs (VLAN interfaces or a router) and the matching default gateway on each host.',
        difficulty: 'easy',
        tags: ['vlan', 'routing'],
      },
      {
        id: 'ts-ospf-exstart',
        front: 'Two OSPF neighbours never get past ExStart/Exchange. What is the usual cause?',
        back: 'An interface MTU mismatch, so database description packets are rejected.\nAlso check for duplicate router IDs.',
        difficulty: 'hard',
        tags: ['ospf'],
      },
      {
        id: 'ts-trunk-vlan',
        front: 'A trunk forwards VLAN 10 but not VLAN 20. What do you check first?',
        back: 'That VLAN 20 exists on both switches and is in the allowed list on both ends of the trunk.',
        difficulty: 'medium',
        tags: ['vlan', 'trunk'],
      },
      {
        id: 'ts-dhcp-relay',
        front: 'Clients behind a router get no lease from a DHCP server in another subnet. What is missing?',
        back: 'A DHCP relay on the gateway interface facing the clients, pointing at the server.\nDiscover messages are broadcasts and do not cross a router on their own.',
        difficulty: 'medium',
        tags: ['dhcp'],
      },
      {
        id: 'ts-default-gateway',
        front: 'A host can ping addresses in its own subnet but nothing beyond it. What do you check first?',
        back: 'The default gateway configured on the host: it must be the router address inside the host subnet.\nThen check that the far side has a route back.',
        difficulty: 'easy',
        tags: ['routing'],
      },
    ],
  },
];

export const ALL_CARDS: readonly Flashcard[] = BUILT_IN_DECKS.flatMap((deck) => deck.cards);

const CARD_INDEX: ReadonlyMap<string, Flashcard> = new Map(
  ALL_CARDS.map((card): [string, Flashcard] => [card.id, card]),
);

export function findCard(id: string): Flashcard | null {
  return CARD_INDEX.get(id) ?? null;
}

/** Cards of one deck, every card when `deckId` is null, or null for an unknown deck. */
export function cardsOfDeck(deckId: string | null): readonly Flashcard[] | null {
  if (deckId === null) return ALL_CARDS;
  return BUILT_IN_DECKS.find((deck) => deck.id === deckId)?.cards ?? null;
}

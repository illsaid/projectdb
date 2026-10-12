import { pick, rngFor } from '@/audio/random';
import type { SeedHex } from '@/patch/types';

const FIRST = [
  'Amber', 'Ashen', 'Blue', 'Brass', 'Cinder', 'Cobalt', 'Copper', 'Dim', 'Distant', 'Dusk', 'Faint', 'Fallow',
  'Feral', 'Frost', 'Gilded', 'Glass', 'Grey', 'Hollow', 'Idle', 'Indigo', 'Iron', 'Ivory', 'Late', 'Lunar',
  'Low', 'Milk', 'Mute', 'Night', 'North', 'Opal', 'Pale', 'Quiet', 'Rust', 'Salt', 'Silver', 'Slow',
  'Soft', 'Still', 'Stone', 'Sunken', 'Tidal', 'Velvet', 'Warm', 'White', 'Wild', 'Winter', 'Woven', 'Young',
];

const SECOND = [
  'Archive', 'Atlas', 'Basin', 'Bell', 'Choir', 'Circuit', 'Current', 'Delta', 'Drift', 'Dune', 'Echo', 'Engine',
  'Field', 'Fjord', 'Garden', 'Glacier', 'Harbor', 'Haze', 'Horizon', 'Lantern', 'Ledger', 'Marsh', 'Meridian', 'Mirror',
  'Moth', 'Orbit', 'Pier', 'Prism', 'Quarry', 'Relay', 'Reservoir', 'Ridge', 'River', 'Shore', 'Signal', 'Static',
  'Station', 'Swarm', 'Terrace', 'Thread', 'Tide', 'Tower', 'Tundra', 'Valley', 'Vessel', 'Weather', 'Window', 'Wire',
];

export function driftName(seed: SeedHex): string {
  const rng = rngFor(seed, 'name');
  return `${pick(rng, FIRST)} ${pick(rng, SECOND)}`;
}

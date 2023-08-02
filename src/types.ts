interface SlashEvent {
  blockHeight: number;
  address: string;
  power: number;
  reason: string;
}

export type { SlashEvent };

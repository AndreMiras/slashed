/**
 * Logging utilities.
 */
import _ from "lodash";

import { decodeBlockEvent2Array, decodeSlashEvents } from "./events";
import { BlockEvent } from "./types";

const logBlockEvent = (blockEvent: BlockEvent) => {
  const attributes = decodeBlockEvent2Array(blockEvent);
  attributes.forEach((attribute) => {
    const { key, value } = attribute;
    console.log("Key:", key, "Value:", value);
  });
};

const logSlashEvents = (slashEvents: Record<number, BlockEvent[]>) => {
  const slashHeights = _.sortBy(Object.keys(slashEvents).map(Number));
  slashHeights.forEach((slashHeight: number) => {
    console.log("Slash event(s) at block", slashHeight);
    slashEvents[slashHeight].forEach((slashEvent) => logBlockEvent(slashEvent));
  });
};

const logDecodeSlashEvents = (slashEvents: Record<number, BlockEvent[]>) => {
  const slashHeights = _.sortBy(Object.keys(slashEvents).map(Number));
  slashHeights.forEach((slashHeight: number) => {
    console.log("Slash event(s) at block", slashHeight);
    const decodedSlashEvents = decodeSlashEvents(
      slashEvents[slashHeight],
      slashHeight,
    );
    console.log({ decodedSlashEvents });
  });
};
export { logBlockEvent, logDecodeSlashEvents, logSlashEvents };

/**
 * Functions to process, decode, and filter block events (e.g., slashing events).
 */
import assert from "assert";
import _ from "lodash";

import {
  BlockEvent,
  BlockEventAttribute,
  BlockResultsResponse,
  BlockResultsResponse37,
  BlockResultsResponse38,
  SlashEvent,
} from "./types";

/**
 * Type guard for CometBFT 0.38+ and 1.x responses.
 * These have finalizeBlockEvents instead of beginBlockEvents/endBlockEvents.
 */
const isBlockResultsResponse38 = (
  obj: BlockResultsResponse,
): obj is BlockResultsResponse38 => {
  return "finalizeBlockEvents" in obj;
};

/**
 * Type guard for Tendermint 0.37 responses.
 * These have beginBlockEvents/endBlockEvents with string attribute keys.
 */
const isBlockResultsResponse37 = (
  obj: BlockResultsResponse,
): obj is BlockResultsResponse37 => {
  return "beginBlockEvents" in obj;
};

/**
 * Decode an event attribute to key/value strings.
 * Modern cosmjs versions (0.34+) already return string attributes.
 */
const decodeAttribute = (attribute: BlockEventAttribute) => {
  return { key: attribute.key, value: attribute.value };
};

const decodeBlockEvent2Array = (
  blockEvent: BlockEvent,
): Record<string, string>[] => {
  const { attributes } = blockEvent;
  return attributes.map((attribute) =>
    decodeAttribute(attribute as BlockEventAttribute),
  );
};

const decodeBlockEvent2Object = (
  blockEvent: BlockEvent,
): Record<string, string> =>
  _.chain(decodeBlockEvent2Array(blockEvent))
    .keyBy("key")
    .mapValues("value")
    .value();

const beginBlockEventsFilter = (event: BlockEvent) =>
  event.type === "slash" && event.attributes.length >= 3;

const decodeSlashEvent = (
  slashEvent: BlockEvent,
  slashHeight: number,
): SlashEvent => {
  const decodedSlashEvent = decodeBlockEvent2Object(slashEvent);
  const { address, power: rawPower, reason } = decodedSlashEvent;
  assert.ok(address && rawPower && reason);
  const power = Number(rawPower);
  return { blockHeight: slashHeight, address, power, reason };
};

const decodeSlashEvents = (
  slashEvents: BlockEvent[],
  slashHeight: number,
): SlashEvent[] =>
  slashEvents.map((slashEvent) => decodeSlashEvent(slashEvent, slashHeight));

export {
  beginBlockEventsFilter,
  decodeAttribute,
  decodeBlockEvent2Array,
  decodeBlockEvent2Object,
  decodeSlashEvent,
  decodeSlashEvents,
  isBlockResultsResponse37,
  isBlockResultsResponse38,
};

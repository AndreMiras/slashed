/**
 * Functions to process, decode, and filter block events (e.g., slashing events).
 */
import { BlockResultsResponse as BlockResultsResponse34 } from "@cosmjs/tendermint-rpc";
import { BlockResultsResponse as BlockResultsResponse37 } from "@cosmjs/tendermint-rpc/build/tendermint37/responses";
import assert from "assert";
import _ from "lodash";
import { TextDecoder } from "util";

import {
  BlockEvent,
  BlockEventAttribute,
  BlockResultsResponse,
  SlashEvent,
} from "./types";

const isBlockResultsResponse34 = (
  obj: BlockResultsResponse,
): obj is BlockResultsResponse34 => {
  const attributeKey = obj.beginBlockEvents[0]?.attributes[0]?.key;
  // if obj.beginBlockEvents has no events then we are OK with it being any type since we can't
  // go through it anyway
  return (
    obj?.beginBlockEvents !== undefined &&
    (attributeKey === undefined || attributeKey instanceof Uint8Array)
  );
};

const isBlockResultsResponse37 = (
  obj: BlockResultsResponse,
): obj is BlockResultsResponse37 =>
  typeof obj.beginBlockEvents[0]?.attributes[0]?.key === "string";

const decodeAttribute = (
  decoder: TextDecoder,
  attribute: BlockEventAttribute,
) => {
  const key =
    attribute.key instanceof Uint8Array
      ? decoder.decode(attribute.key)
      : attribute.key;
  const value =
    attribute.value instanceof Uint8Array
      ? decoder.decode(attribute.value)
      : attribute.value;
  return { key, value };
};

const decodeBlockEvent2Array = (
  blockEvent: BlockEvent,
): Record<string, string>[] => {
  const { attributes } = blockEvent;
  const decoder = new TextDecoder();
  return attributes.map((attribute) => decodeAttribute(decoder, attribute));
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
  isBlockResultsResponse34,
  isBlockResultsResponse37,
};

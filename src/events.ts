/**
 * Functions to process, decode, and filter block events (e.g., slashing events).
 */
import _ from "lodash";
import { TextDecoder } from "util";

import { BlockEvent, BlockEventAttribute } from "./types";

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

export {
  beginBlockEventsFilter,
  decodeAttribute,
  decodeBlockEvent2Array,
  decodeBlockEvent2Object,
};

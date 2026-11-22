// SPDX-License-Identifier: MPL-2.0

import type * as Foxglove from "@foxglove/extension";
import type { MessageDefinitionField } from "@foxglove/message-definition";
import * as _ from "lodash-es";

import { Immutable } from "@lichtblick/suite";
import { MessageEvent } from "@lichtblick/suite-base/players/types";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

import { ProcessMessages, ScriptRegistration } from "./types";

/**
 * A Foxglove `type: "topic"` message converter registered by an extension. Topic converters are a
 * Foxglove extension API; Lichtblick runs them like user scripts (see UserScriptPlayer).
 */
export type InstalledTopicConverter = {
  extensionId: string;
  converter: Foxglove.RegisterMessageConverterArgsTopic;
};

const PRIMITIVE_TYPES = new Map<string, string>([
  ["string", "string"],
  ["number", "float64"],
  ["bool", "bool"],
  ["byte", "uint8"],
] satisfies [Foxglove.MessageSchemaField, string][]);

/** Turn a Foxglove MessageSchemaDescription into datatypes so the output topic has a schema. */
export function schemaDescriptionToDatatypes(
  schemaName: string,
  description: Immutable<Foxglove.MessageSchemaDescription>,
): RosDatatypes {
  const datatypes: RosDatatypes = new Map();
  const add = (name: string, desc: Immutable<Foxglove.MessageSchemaDescription>) => {
    const definitions: MessageDefinitionField[] = [];
    for (const [field, value] of Object.entries(desc)) {
      // Extension input: validate the shape instead of trusting the types.
      const isArray = Array.isArray(value);
      const item: unknown = isArray ? (value as readonly unknown[])[0] : value;
      if (typeof item === "string") {
        const type = PRIMITIVE_TYPES.get(item);
        if (type != undefined) {
          definitions.push({ name: field, type, isArray });
        }
      } else if (typeof item === "object" && item != undefined) {
        const nestedName = `${name}.${field}`;
        add(nestedName, item as Immutable<Foxglove.MessageSchemaDescription>);
        definitions.push({ name: field, type: nestedName, isComplex: true, isArray });
      }
    }
    datatypes.set(name, { name, definitions });
  };
  add(schemaName, description);
  return datatypes;
}

/** Output topic of a topic converter; empty when the extension did not give a usable one. */
export function topicConverterOutput(
  converter: Immutable<Foxglove.RegisterMessageConverterArgsTopic>,
): {
  topic: string;
  schemaName: string;
} {
  // Extension input: older converters only set the deprecated `schemaName`.
  const { outputTopic, outputSchemaName, schemaName } = converter as {
    outputTopic?: unknown;
    outputSchemaName?: unknown;
    schemaName?: unknown;
  };
  const name = outputSchemaName ?? schemaName;
  return {
    topic: typeof outputTopic === "string" ? outputTopic : "",
    schemaName: typeof name === "string" ? name : "",
  };
}

/**
 * Build a script registration that runs the converter in this thread. Every message processor
 * gets its own converter instance (converters may keep state), created lazily on the first input
 * and recreated when a watched global variable changes.
 */
export function buildTopicConverterRegistration(
  { extensionId, converter }: Immutable<InstalledTopicConverter>,
  onError: (error: unknown) => void,
): ScriptRegistration {
  const { topic: outputTopic, schemaName } = topicConverterOutput(converter);
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const description = converter.outputSchemaDescription ?? converter.schemaDescription;
  const inputs = Array.isArray(converter.inputTopics) ? converter.inputTopics : [];
  const watchVariables = converter.watchVariables ?? [];

  const buildMessageProcessor = () => {
    let convert: ReturnType<typeof converter.create> | undefined;
    let createdWith: unknown[] = [];
    let failed = false;

    const processMessages: ProcessMessages = async (msgEvents, globalVariables) => {
      const outputs: MessageEvent[] = [];
      try {
        const watched = watchVariables.map((name) => globalVariables[name]);
        if (!convert || !_.isEqual(watched, createdWith)) {
          convert = converter.create(globalVariables);
          createdWith = watched;
        }
        for (const msgEvent of msgEvents) {
          const result = convert(msgEvent);
          if (result == undefined) {
            continue;
          }
          for (const message of Array.isArray(result) ? result : [result]) {
            outputs.push({
              topic: outputTopic,
              schemaName,
              receiveTime: msgEvent.receiveTime,
              publishTime: msgEvent.publishTime,
              message,
              sizeInBytes: msgEvent.sizeInBytes,
            });
          }
        }
      } catch (err: unknown) {
        failed = true;
        onError(err);
      }
      return outputs;
    };

    return {
      processMessages,
      terminate: () => {
        convert = undefined;
      },
      failed: () => failed,
    };
  };

  const processor = buildMessageProcessor();
  return {
    scriptId: `topic-converter:${extensionId}:${outputTopic}`,
    // Topic converters are not user scripts; only the fields UserScriptPlayer reads are meaningful.
    scriptData: {
      name: outputTopic,
      sourceCode: "",
      transpiledCode: "",
      projectCode: undefined,
      diagnostics: [],
      inputTopics: inputs,
      outputTopic,
      outputDatatype: schemaName,
      datatypes: description ? schemaDescriptionToDatatypes(schemaName, description) : new Map(),
      rosLib: "",
      typesLib: "",
      globalVariables: watchVariables,
    },
    inputs,
    output: { name: outputTopic, schemaName },
    processMessages: processor.processMessages,
    buildMessageProcessor,
    terminate: processor.terminate,
  };
}

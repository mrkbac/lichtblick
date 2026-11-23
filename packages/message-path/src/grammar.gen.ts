// @ts-nocheck
// Generated automatically by nearley, version 2.20.1
// http://github.com/Hardmath123/nearley
// Bypasses TS6133. Allow declared but unused functions.
// @ts-ignore
function id(d: any[]): any {
  return d[0];
}

interface NearleyToken {
  value: any;
  [key: string]: any;
}

interface NearleyLexer {
  reset: (chunk: string, info: any) => void;
  next: () => NearleyToken | undefined;
  save: () => any;
  formatError: (token: never) => string;
  has: (tokenType: string) => boolean;
}

interface NearleyRule {
  name: string;
  symbols: NearleySymbol[];
  postprocess?: (d: any[], loc?: number, reject?: {}) => any;
}

type NearleySymbol = string | { literal: any } | { test: (token: any) => boolean };

interface Grammar {
  Lexer: NearleyLexer | undefined;
  ParserRules: NearleyRule[];
  ParserStart: string;
}

const grammar: Grammar = {
  Lexer: undefined,
  ParserRules: [
    { name: "main$ebnf$1", symbols: ["messagePath"], postprocess: id },
    { name: "main$ebnf$1", symbols: [], postprocess: () => null },
    {
      name: "main",
      symbols: ["topicName", "main$ebnf$1"],
      postprocess: (d) => ({
        topicName: d[0].value,
        topicNameRepr: d[0].repr,
        messagePath: d[1] || [],
        modifier: null,
      }),
    },
    { name: "id$ebnf$1", symbols: [/[a-zA-Z0-9_-]/] },
    {
      name: "id$ebnf$1",
      symbols: ["id$ebnf$1", /[a-zA-Z0-9_-]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    { name: "id", symbols: ["id$ebnf$1"], postprocess: (d) => d[0].join("") },
    { name: "integer$ebnf$1", symbols: [{ literal: "-" }], postprocess: id },
    { name: "integer$ebnf$1", symbols: [], postprocess: () => null },
    { name: "integer$ebnf$2", symbols: [/[0-9]/] },
    {
      name: "integer$ebnf$2",
      symbols: ["integer$ebnf$2", /[0-9]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: "integer",
      symbols: ["integer$ebnf$1", "integer$ebnf$2"],
      postprocess: (d) => ({
        value: BigInt((d[0] ?? "") + d[1].join("")),
        repr: (d[0] ?? "") + d[1].join(""),
      }),
    },
    { name: "string$ebnf$1", symbols: [] },
    {
      name: "string$ebnf$1",
      symbols: ["string$ebnf$1", /[^']/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: "string",
      symbols: [{ literal: "'" }, "string$ebnf$1", { literal: "'" }],
      postprocess: (d) => ({ value: d[1].join(""), repr: `'${d[1].join("")}'` }),
    },
    { name: "string$ebnf$2", symbols: [] },
    {
      name: "string$ebnf$2",
      symbols: ["string$ebnf$2", /[^"]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: "string",
      symbols: [{ literal: '"' }, "string$ebnf$2", { literal: '"' }],
      postprocess: (d) => ({ value: d[1].join(""), repr: `"${d[1].join("")}"` }),
    },
    { name: "variable$ebnf$1", symbols: ["id"], postprocess: id },
    { name: "variable$ebnf$1", symbols: [], postprocess: () => null },
    {
      name: "variable",
      symbols: [{ literal: "$" }, "variable$ebnf$1"],
      postprocess: (d, loc) => ({
        value: { variableName: d[1] || "", startLoc: loc },
        repr: `$${d[1] || ""}`,
      }),
    },
    { name: "decimal$ebnf$1", symbols: [{ literal: "-" }], postprocess: id },
    { name: "decimal$ebnf$1", symbols: [], postprocess: () => null },
    { name: "decimal$ebnf$2", symbols: [/[0-9]/] },
    {
      name: "decimal$ebnf$2",
      symbols: ["decimal$ebnf$2", /[0-9]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    { name: "decimal$ebnf$3", symbols: [/[0-9]/] },
    {
      name: "decimal$ebnf$3",
      symbols: ["decimal$ebnf$3", /[0-9]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: "decimal",
      symbols: ["decimal$ebnf$1", "decimal$ebnf$2", { literal: "." }, "decimal$ebnf$3"],
      postprocess: (d) => {
        const repr = (d[0] ?? "") + d[1].join("") + "." + d[3].join("");
        return { value: Number(repr), repr };
      },
    },
    { name: "value", symbols: ["integer"], postprocess: (d) => d[0] },
    { name: "value", symbols: ["decimal"], postprocess: (d) => d[0] },
    { name: "value", symbols: ["string"], postprocess: (d) => d[0] },
    {
      name: "value$string$1",
      symbols: [{ literal: "t" }, { literal: "r" }, { literal: "u" }, { literal: "e" }],
      postprocess: (d) => d.join(""),
    },
    {
      name: "value",
      symbols: ["value$string$1"],
      postprocess: (d) => ({ value: true, repr: "true" }),
    },
    {
      name: "value$string$2",
      symbols: [
        { literal: "f" },
        { literal: "a" },
        { literal: "l" },
        { literal: "s" },
        { literal: "e" },
      ],
      postprocess: (d) => d.join(""),
    },
    {
      name: "value",
      symbols: ["value$string$2"],
      postprocess: (d) => ({ value: false, repr: "false" }),
    },
    { name: "value", symbols: ["variable"], postprocess: (d) => d[0] },
    {
      name: "comparisonOperator$string$1",
      symbols: [{ literal: "=" }, { literal: "=" }],
      postprocess: (d) => d.join(""),
    },
    {
      name: "comparisonOperator",
      symbols: ["comparisonOperator$string$1"],
      postprocess: () => "==",
    },
    {
      name: "comparisonOperator$string$2",
      symbols: [{ literal: "!" }, { literal: "=" }],
      postprocess: (d) => d.join(""),
    },
    {
      name: "comparisonOperator",
      symbols: ["comparisonOperator$string$2"],
      postprocess: () => "!=",
    },
    {
      name: "comparisonOperator$string$3",
      symbols: [{ literal: ">" }, { literal: "=" }],
      postprocess: (d) => d.join(""),
    },
    {
      name: "comparisonOperator",
      symbols: ["comparisonOperator$string$3"],
      postprocess: () => ">=",
    },
    {
      name: "comparisonOperator$string$4",
      symbols: [{ literal: "<" }, { literal: "=" }],
      postprocess: (d) => d.join(""),
    },
    {
      name: "comparisonOperator",
      symbols: ["comparisonOperator$string$4"],
      postprocess: () => "<=",
    },
    { name: "comparisonOperator", symbols: [{ literal: ">" }], postprocess: () => ">" },
    { name: "comparisonOperator", symbols: [{ literal: "<" }], postprocess: () => "<" },
    { name: "topicName$ebnf$1", symbols: ["slashID"] },
    {
      name: "topicName$ebnf$1",
      symbols: ["topicName$ebnf$1", "slashID"],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: "topicName",
      symbols: ["topicName$ebnf$1"],
      postprocess: (d) => ({ value: d[0].join(""), repr: d[0].join("") }),
    },
    { name: "topicName$ebnf$2", symbols: [] },
    {
      name: "topicName$ebnf$2",
      symbols: ["topicName$ebnf$2", "slashID"],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: "topicName",
      symbols: ["id", "topicName$ebnf$2"],
      postprocess: (d) => ({ value: d[0] + d[1].join(""), repr: d[0] + d[1].join("") }),
    },
    { name: "topicName", symbols: ["quotedString"], postprocess: id },
    { name: "slashID$ebnf$1", symbols: ["id"], postprocess: id },
    { name: "slashID$ebnf$1", symbols: [], postprocess: () => null },
    {
      name: "slashID",
      symbols: [{ literal: "/" }, "slashID$ebnf$1"],
      postprocess: (d) => d.join(""),
    },
    { name: "quotedString$ebnf$1", symbols: [] },
    { name: "quotedString$ebnf$1$subexpression$1", symbols: [/[^"\\]/] },
    {
      name: "quotedString$ebnf$1$subexpression$1$string$1",
      symbols: [{ literal: "\\" }, { literal: "\\" }],
      postprocess: (d) => d.join(""),
    },
    {
      name: "quotedString$ebnf$1$subexpression$1",
      symbols: ["quotedString$ebnf$1$subexpression$1$string$1"],
      postprocess: (d) => "\\",
    },
    {
      name: "quotedString$ebnf$1$subexpression$1$string$2",
      symbols: [{ literal: "\\" }, { literal: '"' }],
      postprocess: (d) => d.join(""),
    },
    {
      name: "quotedString$ebnf$1$subexpression$1",
      symbols: ["quotedString$ebnf$1$subexpression$1$string$2"],
      postprocess: (d) => `"`,
    },
    {
      name: "quotedString$ebnf$1",
      symbols: ["quotedString$ebnf$1", "quotedString$ebnf$1$subexpression$1"],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: "quotedString",
      symbols: [{ literal: '"' }, "quotedString$ebnf$1", { literal: '"' }],
      postprocess: (d) => ({
        value: d[1].join(""),
        repr: `"${d[1].join("").replace(/[\\"]/g, (char) => `\\${char}`)}"`,
      }),
    },
    { name: "messagePath$ebnf$1", symbols: [] },
    {
      name: "messagePath$ebnf$1",
      symbols: ["messagePath$ebnf$1", "messagePathElement"],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    { name: "messagePath$ebnf$2", symbols: [{ literal: "." }], postprocess: id },
    { name: "messagePath$ebnf$2", symbols: [], postprocess: () => null },
    {
      name: "messagePath",
      symbols: ["messagePath$ebnf$1", "messagePath$ebnf$2"],
      postprocess: (d) =>
        d[0]
          .reduce((acc, arr) => acc.concat(arr), [])
          .concat(d[1] ? [{ type: "name", name: "", repr: "" }] : []),
    },
    { name: "messagePathElement$ebnf$1", symbols: ["slice"], postprocess: id },
    { name: "messagePathElement$ebnf$1", symbols: [], postprocess: () => null },
    { name: "messagePathElement$ebnf$2", symbols: ["filter"], postprocess: id },
    { name: "messagePathElement$ebnf$2", symbols: [], postprocess: () => null },
    {
      name: "messagePathElement",
      symbols: [{ literal: "." }, "name", "messagePathElement$ebnf$1", "messagePathElement$ebnf$2"],
      postprocess: (d) => [d[1], d[2], d[3]].filter((x) => x !== null),
    },
    { name: "messagePathElement", symbols: ["filter"], postprocess: id },
    { name: "messagePathElement", symbols: ["modifier"], postprocess: id },
    {
      name: "name",
      symbols: ["id"],
      postprocess: (d) => ({ type: "name", name: d[0], repr: d[0] }),
    },
    {
      name: "name",
      symbols: ["quotedString"],
      postprocess: (d) => ({ type: "name", name: d[0].value, repr: d[0].repr }),
    },
    { name: "sliceVal", symbols: ["integer"], postprocess: (d) => Number(d[0].value) },
    { name: "sliceVal", symbols: ["variable"], postprocess: (d) => d[0].value },
    {
      name: "slice",
      symbols: [{ literal: "[" }, "sliceVal", { literal: "]" }],
      postprocess: (d) => ({ type: "slice", start: d[1], end: d[1] }),
    },
    { name: "slice$ebnf$1", symbols: ["sliceVal"], postprocess: id },
    { name: "slice$ebnf$1", symbols: [], postprocess: () => null },
    { name: "slice$ebnf$2", symbols: ["sliceVal"], postprocess: id },
    { name: "slice$ebnf$2", symbols: [], postprocess: () => null },
    {
      name: "slice",
      symbols: [
        { literal: "[" },
        "slice$ebnf$1",
        { literal: ":" },
        "slice$ebnf$2",
        { literal: "]" },
      ],
      postprocess: (d) => ({
        type: "slice",
        start: d[1] === null ? 0 : d[1],
        end: d[3] === null ? Infinity : d[3],
      }),
    },
    { name: "simplePath$ebnf$1", symbols: [] },
    { name: "simplePath$ebnf$1$subexpression$1", symbols: [{ literal: "." }, "id"] },
    {
      name: "simplePath$ebnf$1",
      symbols: ["simplePath$ebnf$1", "simplePath$ebnf$1$subexpression$1"],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: "simplePath",
      symbols: ["id", "simplePath$ebnf$1"],
      postprocess: (d) => [d[0]].concat(d[1].map((d) => d[1])),
    },
    { name: "filter$ebnf$1", symbols: ["simplePath"], postprocess: id },
    { name: "filter$ebnf$1", symbols: [], postprocess: () => null },
    {
      name: "filter",
      symbols: [{ literal: "{" }, "filter$ebnf$1", { literal: "}" }],
      postprocess: (d, loc) => ({
        type: "filter",
        path: d[1] || [],
        value: undefined,
        nameLoc: loc + 1,
        valueLoc: loc + 1,
        repr: (d[1] || []).join("."),
      }),
    },
    { name: "filter$ebnf$2", symbols: ["simplePath"], postprocess: id },
    { name: "filter$ebnf$2", symbols: [], postprocess: () => null },
    {
      name: "filter",
      symbols: [{ literal: "{" }, "filter$ebnf$2", "comparisonOperator", "value", { literal: "}" }],
      postprocess: (d, loc) => ({
        type: "filter",
        path: d[1] || [],
        operator: d[2],
        value: d[3].value,
        nameLoc: loc + 1,
        valueLoc: loc + 1 + (d[1] || []).join(".").length + d[2].length,
        repr: `${(d[1] || []).join(".")}${d[2]}${d[3].repr}`,
      }),
    },
    { name: "filter$ebnf$3", symbols: ["simplePath"], postprocess: id },
    { name: "filter$ebnf$3", symbols: [], postprocess: () => null },
    {
      name: "filter",
      symbols: [
        { literal: "{" },
        "filter$ebnf$3",
        "comparisonOperator",
        "enumName",
        { literal: "}" },
      ],
      postprocess: (d, loc) => ({
        type: "filter",
        path: d[1] || [],
        operator: d[2],
        value: d[3],
        isEnum: true,
        nameLoc: loc + 1,
        valueLoc: loc + 1 + (d[1] || []).join(".").length + d[2].length,
        repr: `${(d[1] || []).join(".")}${d[2]}${d[3]}`,
      }),
    },
    { name: "enumName$ebnf$1", symbols: [] },
    {
      name: "enumName$ebnf$1",
      symbols: ["enumName$ebnf$1", /[a-zA-Z0-9_]/],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: "enumName",
      symbols: [/[a-zA-Z_]/, "enumName$ebnf$1"],
      postprocess: (d, _loc, reject) => {
        const name = d[0] + d[1].join("");
        return name === "true" || name === "false" ? reject : name;
      },
    },
    {
      name: "modifier$string$1",
      symbols: [{ literal: "." }, { literal: "@" }],
      postprocess: (d) => d.join(""),
    },
    { name: "modifier$ebnf$1", symbols: ["id"], postprocess: id },
    { name: "modifier$ebnf$1", symbols: [], postprocess: () => null },
    { name: "modifier$ebnf$2", symbols: ["modifierArgs"], postprocess: id },
    { name: "modifier$ebnf$2", symbols: [], postprocess: () => null },
    {
      name: "modifier",
      symbols: ["modifier$string$1", "modifier$ebnf$1", "modifier$ebnf$2"],
      postprocess: (d) => {
        const name = d[1] || "";
        const args = d[2] || { args: [], repr: "" };
        return { type: "modifier", name, args: args.args, repr: name + args.repr };
      },
    },
    { name: "modifierArgs$ebnf$1", symbols: [] },
    {
      name: "modifierArgs$ebnf$1$subexpression$1",
      symbols: ["_", { literal: "," }, "_", "modifierArg"],
    },
    {
      name: "modifierArgs$ebnf$1",
      symbols: ["modifierArgs$ebnf$1", "modifierArgs$ebnf$1$subexpression$1"],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    {
      name: "modifierArgs",
      symbols: [{ literal: "(" }, "_", "modifierArg", "modifierArgs$ebnf$1", "_", { literal: ")" }],
      postprocess: (d) => {
        const all = [d[2], ...d[3].map((x) => x[3])];
        return { args: all.map((a) => a.value), repr: `(${all.map((a) => a.repr).join(", ")})` };
      },
    },
    {
      name: "modifierArg",
      symbols: ["integer"],
      postprocess: (d) => ({ value: Number(d[0].value), repr: d[0].repr }),
    },
    { name: "modifierArg", symbols: ["decimal"], postprocess: id },
    { name: "modifierArg", symbols: ["variable"], postprocess: id },
    {
      name: "modifierArg",
      symbols: ["simplePath"],
      postprocess: (d, _loc, reject) =>
        /^[0-9-]/.test(d[0][0]) ? reject : { value: d[0], repr: d[0].join(".") },
    },
    { name: "_$ebnf$1", symbols: [] },
    {
      name: "_$ebnf$1",
      symbols: ["_$ebnf$1", { literal: " " }],
      postprocess: (d) => d[0].concat([d[1]]),
    },
    { name: "_", symbols: ["_$ebnf$1"], postprocess: () => null },
  ],
  ParserStart: "main",
};

export default grammar;

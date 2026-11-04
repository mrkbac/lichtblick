#  Copyright (c) 2018-present, Cruise LLC
#
#  This source code is licensed under the Apache License, Version 2.0,
#  found in the LICENSE file in the root directory of this source tree.
#  You may not use this file except in compliance with the License.

# This grammar matches topic/message paths like this:
#
# /some/topic.sub_msgs[0].some_field
#
# The part with slashes is the topic name, and the part after that is the
# message path. This is a slight break from ROS convention, but makes it
# easier for both humans and computers to understand what's going on.
#
# For more examples, please see parseRosPath.test.js
# A time-series modifier (e.g. `.@derivative`) and the modifiers after it are moved out of
# `messagePath` by parseMessagePath.
main -> topicName messagePath:?
  {% (d) => ({ topicName: d[0].value, topicNameRepr: d[0].repr, messagePath: d[1] || [], modifier: null }) %}

## Primitives

# A typical id like `some_thing_123`.
id -> [a-zA-Z0-9_-]:+
  {% (d) => d[0].join("") %}

# Integer.
integer
   -> "-":? [0-9]:+  {% (d) => ({ value: BigInt((d[0] ?? "") + d[1].join("")), repr: (d[0] ?? "") + d[1].join("") }) %}

# String of the form 'hi' or "hi". No escaping supported.
string
   -> "'" [^']:* "'"   {% (d) => ({ value: d[1].join(""), repr: `'${d[1].join("")}'` }) %}
    | "\"" [^"]:* "\"" {% (d) => ({ value: d[1].join(""), repr: `"${d[1].join("")}"` }) %}

variable -> "$" id:? {% (d, loc) => ({ value: {variableName: d[1] || "", startLoc: loc }, repr: `$${d[1] || ""}` }) %}

# Decimal number like `0.5` or `-3.25`. Integers use `integer` to keep int64 precision.
decimal -> "-":? [0-9]:+ "." [0-9]:+
  {% (d) => { const repr = (d[0] ?? "") + d[1].join("") + "." + d[3].join(""); return { value: Number(repr), repr }; } %}

# An integer, decimal, string, or boolean.
value -> integer  {% (d) => d[0] %}
       | decimal {% (d) => d[0] %}
       | string  {% (d) => d[0] %}
       | "true"  {% (d) => ({ value: true, repr: "true" }) %}
       | "false" {% (d) => ({ value: false, repr: "false" }) %}
	   | variable {% (d) => d[0] %}

#Comparison operators
comparisonOperator -> "==" {% () => "==" %}
                    | "!=" {% () => "!=" %}
                    | ">=" {% () => ">=" %}
                    | "<=" {% () => "<=" %}
                    | ">"  {% () => ">" %}
                    | "<"  {% () => "<" %}

## Topic part. Basically an id but with (optional) slashes.
topicName -> slashID:+     {% (d) => ({ value: d[0].join(""), repr: d[0].join("") }) %}
           | id slashID:*  {% (d) => ({ value: d[0] + d[1].join(""), repr: d[0] + d[1].join("") }) %}
           | quotedString  {% id %}
slashID -> "/" id:?
  {% (d) => d.join("") %}

quotedString ->
  "\""
  (
    [^"\\]
    | "\\\\" {% d => "\\" %}
    | "\\\"" {% d => `"` %}
  ):*
  "\""
  {%
    d => ({
      value: d[1].join(''),
      repr: `"${d[1].join('').replace(/[\\"]/g, char => `\\${char}`)}"`
    })
  %}

## `messagePath` part.

# Multiple `messagePathElements`, optionally with an additional dot for autocomplete. When that
# extra dot is given, make sure to add an empty name field so the path will be marked as invalid,
# and the autocomplete is actually shown.
# Return type: `MessagePathPart[]`.
messagePath -> messagePathElement:* ".":?
  {%
    (d) =>
      d[0]
        .reduce((acc, arr) => acc.concat(arr), [])
        .concat(d[1] ? [{ type: "name", name: "", repr: "" }] : [])
  %}

# An element of the `messagePart`, of the form `field[10:20]{some_id==10}`.
# Multiple slices are not allowed (no 2d arrays in ROS).
# Return type: `MessagePathPart`.
messagePathElement ->
  "." name slice:? filter:? {% (d) => [d[1], d[2], d[3]].filter(x => x !== null) %}
  | filter {% id %}
  | modifier {% id %}

# Name part is just an id, e.g. `field`.
name ->
  id             {% (d) => ({ type: "name", name: d[0], repr: d[0] }) %}
  | quotedString {% (d) => ({ type: "name", name: d[0].value, repr: d[0].repr }) %}

# Slice part; can be a single array index `[0]` or multiple `[0:10]`, or even infinite `[:]`.
sliceVal -> integer {% (d) => Number(d[0].value) %} | variable {% (d) => (d[0].value) %}
slice -> "[" sliceVal "]"
            {% (d) => ({ type: "slice", start: d[1], end: d[1] }) %}
       | "[" sliceVal:? ":" sliceVal:? "]"
            {% (d) => ({ type: "slice", start: d[1] === null ? 0 : d[1], end: d[3] === null ? Infinity : d[3] }) %}

# For now, filters only support simple "foo.bar.baz" paths, so we need a separate rule for this.
# TODO: it would be nice if filters supported arbitrary sub-paths, such as "/diagnostics{status[0].hardware_id=='bar'}".
simplePath -> id ("." id):* {% (d) => [d[0]].concat(d[1].map((d) => d[1])) %}

# Filter part; can be empty `{}` to allow for autocomplete. Can also be half-empty,
# like `{==0}`, also to allow for autocomplete.
filter -> "{" simplePath:? "}"
            {%
              (d, loc) => ({
                type: "filter",
                path: d[1] || [],
                value: undefined,
                nameLoc: loc+1,
                valueLoc: loc+1,
                repr: (d[1] || []).join("."),
              })
            %}
        | "{" simplePath:? comparisonOperator value "}"
            {%
              (d, loc) => ({
                type: "filter",
                path: d[1] || [],
                operator: d[2],
                value: d[3].value,
                nameLoc: loc+1,
                valueLoc: loc+1+(d[1] || []).join(".").length+d[2].length,
                repr: `${(d[1] || []).join(".")}${d[2]}${d[3].repr}`,
              })
            %}
        | "{" simplePath:? comparisonOperator enumName "}"
            {%
              (d, loc) => ({
                type: "filter",
                path: d[1] || [],
                operator: d[2],
                value: d[3],
                isEnum: true,
                nameLoc: loc+1,
                valueLoc: loc+1+(d[1] || []).join(".").length+d[2].length,
                repr: `${(d[1] || []).join(".")}${d[2]}${d[3]}`,
              })
            %}

# Bare enum constant name like `MOVING`, case-sensitive. `true` and `false` are booleans.
enumName -> [a-zA-Z_] [a-zA-Z0-9_]:*
  {% (d, _loc, reject) => { const name = d[0] + d[1].join(""); return name === "true" || name === "false" ? reject : name; } %}

## Modifiers.
# Per-message modifier, e.g. `.@abs`, `.@mul(2, $scale)` or `.@product(width, height)`. The name may be
# empty to allow for autocomplete.
modifier -> ".@" id:? modifierArgs:?
  {%
    (d) => {
      const name = d[1] || "";
      const args = d[2] || { args: [], repr: "" };
      return { type: "modifier", name, args: args.args, repr: name + args.repr };
    }
  %}

modifierArgs -> "(" _ modifierArg (_ "," _ modifierArg):* _ ")"
  {%
    (d) => {
      const all = [d[2], ...d[3].map((x) => x[3])];
      return { args: all.map((a) => a.value), repr: `(${all.map((a) => a.repr).join(", ")})` };
    }
  %}

# A number, a variable, or a field path relative to the modified value.
modifierArg -> integer {% (d) => ({ value: Number(d[0].value), repr: d[0].repr }) %}
             | decimal {% id %}
             | variable {% id %}
             | simplePath
                {% (d, _loc, reject) => /^[0-9-]/.test(d[0][0]) ? reject : { value: d[0], repr: d[0].join(".") } %}

_ -> " ":* {% () => null %}

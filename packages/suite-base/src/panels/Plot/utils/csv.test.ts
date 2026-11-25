// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { generateCSV } from "./csv";

describe("csv", () => {
  describe("getCSVData", () => {
    it("should generate valid csv data", () => {
      const csv = generateCSV(
        [
          {
            label: "label",
            configIndex: 0,
            data: [
              {
                receiveTime: { sec: 0, nsec: 0 },
                x: 0,
                y: 0,
                value: 0,
              },
            ],
          },
        ],
        "timestamp",
      );
      expect(csv).toEqual(
        ["elapsed time,receive time,header.stamp,topic,value", "0,0.000000000,,label,0"].join("\n"),
      );
    });

    it("should generate valid csv data for bigint values", () => {
      const csv = generateCSV(
        [
          {
            label: "label",
            configIndex: 0,
            data: [
              {
                receiveTime: { sec: 0, nsec: 0 },
                x: 0,
                y: Number(9999999999999001n),
                value: 9999999999999001n,
              },
            ],
          },
        ],
        "timestamp",
      );
      expect(csv).toEqual(
        [
          "elapsed time,receive time,header.stamp,topic,value",
          "0,0.000000000,,label,9999999999999001",
        ].join("\n"),
      );
    });
    it("quotes cells containing commas, quotes or newlines (RFC 4180)", () => {
      const csv = generateCSV(
        [
          {
            label: '/a.b[:]{id==1, "x"}',
            configIndex: 0,
            data: [
              { receiveTime: { sec: 1, nsec: 0 }, x: 0, y: 0, value: "line1\nline2" },
              { receiveTime: { sec: 2, nsec: 0 }, x: 1, y: 0, value: "a\r\nb" },
            ],
          },
        ],
        "index",
      );
      expect(csv).toEqual(
        [
          "index,receive time,header.stamp,topic,value",
          '0,1.000000000,,"/a.b[:]{id==1, ""x""}","line1\nline2"',
          '1,2.000000000,,"/a.b[:]{id==1, ""x""}","a\r\nb"',
        ].join("\n"),
      );
    });

    it("neutralizes spreadsheet formulas but keeps negative numbers", () => {
      const csv = generateCSV(
        [
          {
            label: "=HYPERLINK(1)",
            configIndex: 0,
            data: [
              { receiveTime: { sec: 0, nsec: 0 }, x: -1.5, y: -2, value: -2 },
              { receiveTime: { sec: 0, nsec: 0 }, x: 0, y: 0, value: "+1+1" },
              { receiveTime: { sec: 0, nsec: 0 }, x: 0, y: 0, value: "-1+1" },
              { receiveTime: { sec: 0, nsec: 0 }, x: 0, y: 0, value: "@SUM(A1)" },
              { receiveTime: { sec: 0, nsec: 0 }, x: 0, y: 0, value: "\tx" },
              { receiveTime: { sec: 0, nsec: 0 }, x: 0, y: 0, value: "\rx" },
              { receiveTime: { sec: 0, nsec: 0 }, x: 0, y: 0, value: "-3" },
            ],
          },
        ],
        "index",
      );
      expect(csv.split("\n").slice(1)).toEqual([
        "-1.5,0.000000000,,'=HYPERLINK(1),-2",
        "0,0.000000000,,'=HYPERLINK(1),'+1+1",
        "0,0.000000000,,'=HYPERLINK(1),'-1+1",
        "0,0.000000000,,'=HYPERLINK(1),'@SUM(A1)",
        "0,0.000000000,,'=HYPERLINK(1),'\tx",
        "0,0.000000000,,'=HYPERLINK(1),\"'\rx\"",
        "0,0.000000000,,'=HYPERLINK(1),-3",
      ]);
    });

    it("formats time values as seconds", () => {
      const csv = generateCSV(
        [
          {
            label: "t",
            configIndex: 0,
            data: [
              {
                receiveTime: { sec: 0, nsec: 0 },
                x: 0,
                y: 1.5,
                value: { sec: 1, nsec: 500000000 },
              },
            ],
          },
        ],
        "index",
      );
      expect(csv.split("\n")[1]).toEqual("0,0.000000000,,t,1.500000000");
    });
  });
});

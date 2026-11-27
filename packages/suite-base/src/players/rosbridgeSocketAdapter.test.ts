// SPDX-License-Identifier: MPL-2.0

import roslib from "@foxglove/roslibjs";
import SocketAdapter from "@foxglove/roslibjs/src/core/SocketAdapter";

// RosbridgePlayer hands roslib a socket of its own (the proxy extension's) with roslib's own
// handlers. This guards that deep import and its contract against roslib changes.
describe("roslib SocketAdapter on a supplied socket", () => {
  it("connects, receives, and sends", () => {
    const sent: string[] = [];
    const socket = { send: (data: string) => sent.push(data), close: vi.fn() };
    const ros = new roslib.Ros({ transportLibrary: "websocket" });
    const handlers = SocketAdapter(ros);
    ros.socket = Object.assign(socket, handlers);
    const onConnection = vi.fn();
    const onMessage = vi.fn();
    ros.on("connection", onConnection);
    (ros as unknown as { on: (event: string, cb: (msg: unknown) => void) => void }).on(
      "/chatter",
      onMessage,
    );

    handlers.onopen({});
    handlers.onmessage({
      data: JSON.stringify({ op: "publish", topic: "/chatter", msg: { a: 1 } }),
    });
    new roslib.Topic({ ros, name: "/out", messageType: "std_msgs/String" }).advertise();

    expect(onConnection).toHaveBeenCalled();
    expect(onMessage).toHaveBeenCalledWith({ a: 1 });
    expect(sent.map((data) => (JSON.parse(data) as { op: string }).op)).toContain("advertise");
  });
});

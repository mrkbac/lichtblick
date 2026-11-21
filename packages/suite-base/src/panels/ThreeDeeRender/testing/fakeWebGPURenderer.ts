// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * `three/webgpu` with a fake `WebGPURenderer` (jsdom has no WebGPU). Use in tests as:
 * `vi.mock("three/webgpu", async () => await (await import("./testing/fakeWebGPURenderer")).mockThreeWebGPU());`
 * The fake initializes immediately and records nothing; tests check scene state, not pixels.
 */
import { WebGPUCoordinateSystem } from "three";

export async function mockThreeWebGPU(): Promise<Record<string, unknown>> {
  const actual = await vi.importActual<Record<string, unknown>>("three/webgpu");
  // The renderer refuses to start without WebGPU
  if (!("gpu" in navigator)) {
    const limits = { maxStorageBufferBindingSize: 1 << 30, maxBufferSize: 1 << 30 };
    Object.defineProperty(navigator, "gpu", {
      value: {
        requestAdapter: async () => ({
          limits,
          features: new Set(),
          requestDevice: async () => ({ lost: new Promise(() => {}) }),
        }),
      },
      configurable: true,
    });
  }
  return { ...actual, WebGPURenderer: FakeWebGPURenderer };
}

class FakeWebGPURenderer {
  public domElement: HTMLCanvasElement;
  public backend = { isWebGPUBackend: true, parameters: {} };
  public coordinateSystem = WebGPUCoordinateSystem;
  public info = {
    reset: vi.fn(),
    render: { calls: 0, triangles: 0 },
    memory: { textures: 0, geometries: 0 },
  };
  public shadowMap = {};
  public autoClear = true;
  public sortObjects = true;
  public onDeviceLost = (): void => {};
  #pixelRatio = 1;
  #renderTarget: unknown = null;
  #renderObjectFunction: unknown = null;

  public constructor({ canvas }: { canvas?: HTMLCanvasElement } = {}) {
    this.domElement = canvas ?? document.createElement("canvas");
  }

  public init = vi.fn(async () => this);
  public setPixelRatio = vi.fn((ratio: number) => {
    this.#pixelRatio = ratio;
  });
  public getPixelRatio = (): number => this.#pixelRatio;
  public setSize = vi.fn();
  public render = vi.fn();
  public compute = vi.fn();
  public clear = vi.fn();
  public clearDepth = vi.fn();
  public setClearColor = vi.fn();
  public getClearColor = vi.fn();
  public getClearAlpha = (): number => 1;
  public dispose = vi.fn(async () => {});
  public getDrawingBufferSize = (target: { set(x: number, y: number): unknown }): unknown =>
    target.set(100, 100);
  public setRenderTarget = (target: unknown): void => {
    this.#renderTarget = target;
  };
  public getRenderTarget = (): unknown => this.#renderTarget;
  public setRenderObjectFunction = (fn: unknown): void => {
    this.#renderObjectFunction = fn;
  };
  public getRenderObjectFunction = (): unknown => this.#renderObjectFunction;
  // Nothing drawn: an all-zero pixel decodes as "nothing picked"
  public readRenderTargetPixelsAsync = vi.fn(async () => new Uint32Array(4));
}

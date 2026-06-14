// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest';
import { CollisionPipelineApp } from './app';

/**
 * Guards the wiring between the rendered markup and `captureElements`: if any control, metric, or canvas the app
 * looks up is renamed or removed, `mount()` throws and this test fails. It mounts against a stubbed 2D context and
 * drives one full animation frame so the render and telemetry paths are exercised, not just construction.
 */

/** A no-op stand-in for CanvasRenderingContext2D: methods do nothing, property writes succeed, `.canvas` has a size. */
function stubContext(): CanvasRenderingContext2D {
  const canvas = { width: 480, height: 300 };
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'canvas') {
          return canvas;
        }
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() =>
    stubContext()) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  // Keep the render loop to a single iteration instead of recursing forever.
  window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
});

describe('CollisionPipelineApp.mount', () => {
  it('mounts and looks up every wired element without throwing', () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);

    const app = new CollisionPipelineApp(root);
    expect(() => app.mount()).not.toThrow();

    expect(root.querySelector('#collision-canvas')).not.toBeNull();
    expect(root.querySelector('#versus-canvas-a')).not.toBeNull();
    expect(root.querySelector('#stage-recall')).not.toBeNull();
  });

  it('runs one animation frame and writes live telemetry', () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);

    const app = new CollisionPipelineApp(root);
    app.mount();
    // mount() schedules the loop through the stubbed rAF; invoke one frame directly.
    expect(() => (app as unknown as { loop(timestamp: number): void }).loop(performance.now())).not.toThrow();

    const candidateCount = root.querySelector('#candidate-count');
    expect(candidateCount?.textContent).not.toBe('0');
  });
});

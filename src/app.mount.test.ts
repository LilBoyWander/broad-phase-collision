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
    expect(root.querySelector('.inspect-bar #resolve-response')).not.toBeNull();
    expect(root.querySelector('.sidebar #resolve-response')).toBeNull();
    expect(root.querySelector<HTMLInputElement>('#versus-active')?.checked).toBe(false);
    expect(root.querySelector('#versus-a-stats')?.textContent).toBe('paused');
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

  it('loads the focused high-speed CCD challenge from one control', () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);

    const app = new CollisionPipelineApp(root);
    app.mount();
    root.querySelector<HTMLButtonElement>('#ccd-challenge')?.click();

    expect(root.querySelector<HTMLSelectElement>('#scenario-select')?.value).toBe('tunneling');
    expect(root.querySelector<HTMLInputElement>('#body-slider')?.value).toBe('48');
    expect(root.querySelector<HTMLInputElement>('#resolve-ccd')?.checked).toBe(true);
  });

  it('creates fixed user geometry through the wall tool', () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);

    const app = new CollisionPipelineApp(root);
    app.mount();
    root.querySelector<HTMLButtonElement>('[data-tool="wall"]')?.click();
    const internals = app as unknown as {
      bodies: Array<{ isStatic?: boolean; isUserCreated?: boolean }>;
      applyToolAt(point: { x: number; y: number }): void;
    };
    const before = internals.bodies.length;
    internals.applyToolAt({ x: 300, y: 250 });

    expect(internals.bodies).toHaveLength(before + 1);
    expect(internals.bodies.at(-1)).toMatchObject({
      isStatic: true,
      isUserCreated: true,
    });
    expect(root.querySelector('#custom-body-count')?.textContent).toContain('1 custom');
  });

  it('does not flip sweep insight on alternating single-frame samples', () => {
    const root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);

    const app = new CollisionPipelineApp(root);
    app.mount();
    const internals = app as unknown as {
      method: string;
      stats: { orderingSwaps: number; auxiliaryChecks: number; usedFullSort: boolean };
      bodies: unknown[];
      updateInsightTelemetry(): void;
    };
    internals.method = 'sweep';
    internals.stats.usedFullSort = false;
    const titles = new Set<string>();
    for (let frame = 0; frame < 20; frame += 1) {
      internals.stats.orderingSwaps = frame % 2 === 0 ? 0 : internals.bodies.length * 1.1;
      internals.stats.auxiliaryChecks = internals.bodies.length * 8;
      internals.updateInsightTelemetry();
      titles.add(root.querySelector('#insight-title')?.textContent ?? '');
    }
    expect(titles.size).toBe(1);
  });
});

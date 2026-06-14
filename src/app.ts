import { runNaiveBroadPhase } from './broadphase/naive';
import { runSpatialHashBroadPhase } from './broadphase/spatialHash';
import { SweepAndPrune } from './broadphase/sweepAndPrune';
import {
  detectContacts,
  pairKey,
  resolveContacts,
  type NarrowPhaseResult,
  type ResponseResult,
} from './physics/collision';
import type {
  Body,
  BroadPhaseMethod,
  BroadPhaseResult,
  Contact,
  ScenarioName,
} from './physics/types';
import { createBodies, updateBodies, WORLD_BOUNDS } from './physics/world';

interface PipelineStats {
  broadDuration: number;
  narrowDuration: number;
  responseDuration: number;
  candidateCount: number;
  contactCount: number;
  falsePositiveCount: number;
  impulsesApplied: number;
  auxiliaryChecks: number;
  orderingSwaps: number;
  bucketEntries: number;
  bucketCount: number;
  maxBucketSize: number;
  usedFullSort: boolean;
}

interface AuditResult {
  oracleContacts: number;
  missedContacts: number;
  recall: number;
  duration: number;
}

interface MethodComparison {
  method: BroadPhaseMethod;
  duration: number;
  candidates: number;
  contacts: number;
  falsePositives: number;
  recall: number;
  auxiliaryChecks: number;
  orderingSwaps: number;
  usedFullSort: boolean;
}

interface AppElements {
  themeButton: HTMLButtonElement;
  notesButton: HTMLButtonElement;
  dialog: HTMLDialogElement;
  closeDialogButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  stressButton: HTMLButtonElement;
  compareButton: HTMLButtonElement;
  auditButton: HTMLButtonElement;
  pauseToggle: HTMLInputElement;
  responseToggle: HTMLInputElement;
  pairsToggle: HTMLInputElement;
  contactsToggle: HTMLInputElement;
  trailsToggle: HTMLInputElement;
  gridToggle: HTMLInputElement;
  bodySlider: HTMLInputElement;
  bodyValue: HTMLElement;
  speedSlider: HTMLInputElement;
  speedValue: HTMLElement;
  restitutionSlider: HTMLInputElement;
  restitutionValue: HTMLElement;
  cellSlider: HTMLInputElement;
  cellValue: HTMLElement;
  scenarioSelect: HTMLSelectElement;
  methodButtons: NodeListOf<HTMLButtonElement>;
  methodDescription: HTMLElement;
  canvas: HTMLCanvasElement;
  fpsBadge: HTMLElement;
  frameTime: HTMLElement;
  updateTime: HTMLElement;
  renderTime: HTMLElement;
  theoreticalPairs: HTMLElement;
  candidateCount: HTMLElement;
  contactCount: HTMLElement;
  canvasRecall: HTMLElement;
  canvasRecallLabel: HTMLElement;
  falsePositiveCount: HTMLElement;
  rejectionRate: HTMLElement;
  broadTime: HTMLElement;
  narrowTime: HTMLElement;
  responseTime: HTMLElement;
  auxiliaryChecks: HTMLElement;
  orderingSwaps: HTMLElement;
  bucketEntries: HTMLElement;
  bucketCount: HTMLElement;
  maxBucketSize: HTMLElement;
  insightTitle: HTMLElement;
  insightBody: HTMLElement;
  insightPrimaryLabel: HTMLElement;
  insightPrimaryValue: HTMLElement;
  insightSecondaryLabel: HTMLElement;
  insightSecondaryValue: HTMLElement;
  auditStatus: HTMLElement;
  auditRecall: HTMLElement;
  auditMissed: HTMLElement;
  auditOracle: HTMLElement;
  comparisonStatus: HTMLElement;
  comparisonNaiveTime: HTMLElement;
  comparisonNaiveCandidates: HTMLElement;
  comparisonNaiveRecall: HTMLElement;
  comparisonSpatialTime: HTMLElement;
  comparisonSpatialCandidates: HTMLElement;
  comparisonSpatialRecall: HTMLElement;
  comparisonSweepTime: HTMLElement;
  comparisonSweepCandidates: HTMLElement;
  comparisonSweepRecall: HTMLElement;
}

type ThemeName = 'paper' | 'midnight';

const DEFAULT_BODY_COUNT = 850;
const MAX_BODY_COUNT = 2000;
const DEFAULT_CELL_SIZE = 32;
const CANDIDATE_LINE_LIMIT = 420;

/**
 * Runs the complete collision pipeline and keeps each stage observable.
 *
 * The selected broad phase only proposes pairs. Exact circle tests confirm contacts, then a separate solver performs
 * positional correction and impulse response. Correctness audits compare candidates against an all-pairs oracle.
 */
export class CollisionPipelineApp {
  private readonly root: HTMLDivElement;
  private readonly sweep = new SweepAndPrune();
  private readonly comparisonSweep = new SweepAndPrune();

  private elements!: AppElements;
  private context!: CanvasRenderingContext2D;
  private bodies: Body[] = [];
  private contacts: Contact[] = [];
  private broadResult: BroadPhaseResult | null = null;
  private method: BroadPhaseMethod = 'spatial';
  private scenario: ScenarioName = 'uniform';
  private theme: ThemeName = 'midnight';
  private cellSize = DEFAULT_CELL_SIZE;
  private speedMultiplier = 1;
  private restitution = 0.72;
  private isPaused = false;
  private resolveResponse = true;
  private showPairs = false;
  private showContacts = true;
  private showTrails = true;
  private showGrid = true;
  private lastFrameStart = performance.now();
  private frameInterval = 1000 / 60;
  private fps = 60;
  private fpsFrames = 0;
  private fpsTime = 0;
  private updateDuration = 0;
  private renderDuration = 0;
  private countDebounceId: number | null = null;
  private auditDebounceId: number | null = null;
  private stats: PipelineStats = {
    broadDuration: 0,
    narrowDuration: 0,
    responseDuration: 0,
    candidateCount: 0,
    contactCount: 0,
    falsePositiveCount: 0,
    impulsesApplied: 0,
    auxiliaryChecks: 0,
    orderingSwaps: 0,
    bucketEntries: 0,
    bucketCount: 0,
    maxBucketSize: 0,
    usedFullSort: false,
  };
  private audit: AuditResult | null = null;
  private comparison: MethodComparison[] = [];

  constructor(root: HTMLDivElement) {
    this.root = root;
  }

  mount(): void {
    this.root.innerHTML = this.renderMarkup();
    this.elements = this.captureElements();

    const context = this.elements.canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D is not supported in this browser.');
    }
    this.context = context;

    this.theme = this.getPreferredTheme();
    this.applyTheme();
    this.resetBodies(DEFAULT_BODY_COUNT);
    this.bindEvents();
    this.syncControls();
    this.scheduleAudit(400);
    requestAnimationFrame((timestamp) => this.loop(timestamp));
  }

  private bindEvents(): void {
    this.elements.themeButton.addEventListener('click', () => {
      this.theme = this.theme === 'paper' ? 'midnight' : 'paper';
      this.applyTheme();
    });
    this.elements.notesButton.addEventListener('click', () => this.elements.dialog.showModal());
    this.elements.closeDialogButton.addEventListener('click', () => this.elements.dialog.close());
    this.elements.dialog.addEventListener('click', (event) => {
      const bounds = this.elements.dialog.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      ) {
        this.elements.dialog.close();
      }
    });

    this.elements.resetButton.addEventListener('click', () => {
      this.speedMultiplier = 1;
      this.cellSize = DEFAULT_CELL_SIZE;
      this.restitution = 0.72;
      this.scenario = 'uniform';
      this.method = 'spatial';
      this.resetBodies(DEFAULT_BODY_COUNT);
      this.audit = null;
      this.comparison = [];
      this.syncControls();
      this.updateAuditTelemetry();
      this.updateComparisonTelemetry();
      this.scheduleAudit(100);
    });

    this.elements.stressButton.addEventListener('click', () => {
      this.setBodyCount(Math.min(this.bodies.length + 250, MAX_BODY_COUNT));
    });
    this.elements.auditButton.addEventListener('click', () => void this.runAudit());
    this.elements.compareButton.addEventListener('click', () => void this.runComparison());

    this.elements.methodButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const method = button.dataset.method;
        if (method === 'naive' || method === 'spatial' || method === 'sweep') {
          this.method = method;
          this.sweep.reset();
          this.audit = null;
          this.syncControls();
          this.updateAuditTelemetry();
          this.scheduleAudit(100);
        }
      });
    });

    this.elements.bodySlider.addEventListener('input', () => {
      const count = Number.parseInt(this.elements.bodySlider.value, 10);
      this.elements.bodyValue.textContent = count.toLocaleString();
      if (this.countDebounceId !== null) {
        window.clearTimeout(this.countDebounceId);
      }
      this.countDebounceId = window.setTimeout(() => this.setBodyCount(count), 140);
    });

    this.elements.speedSlider.addEventListener('input', () => {
      this.speedMultiplier = Number.parseFloat(this.elements.speedSlider.value);
      this.elements.speedValue.textContent = `${this.speedMultiplier.toFixed(1)}x`;
    });
    this.elements.restitutionSlider.addEventListener('input', () => {
      this.restitution = Number.parseFloat(this.elements.restitutionSlider.value);
      this.elements.restitutionValue.textContent = this.restitution.toFixed(2);
    });
    this.elements.cellSlider.addEventListener('input', () => {
      this.cellSize = Number.parseInt(this.elements.cellSlider.value, 10);
      this.elements.cellValue.textContent = `${this.cellSize} px`;
      this.audit = null;
      this.updateAuditTelemetry();
      this.scheduleAudit(220);
    });
    this.elements.scenarioSelect.addEventListener('change', () => {
      const scenario = this.elements.scenarioSelect.value;
      if (
        scenario === 'uniform' ||
        scenario === 'clusters' ||
        scenario === 'horizontal' ||
        scenario === 'mixed' ||
        scenario === 'giant'
      ) {
        this.scenario = scenario;
        this.resetBodies(this.bodies.length);
        this.audit = null;
        this.comparison = [];
        this.updateAuditTelemetry();
        this.updateComparisonTelemetry();
        this.scheduleAudit(100);
      }
    });

    this.elements.pauseToggle.addEventListener('change', () => {
      this.isPaused = this.elements.pauseToggle.checked;
    });
    this.elements.responseToggle.addEventListener('change', () => {
      this.resolveResponse = this.elements.responseToggle.checked;
    });
    this.elements.pairsToggle.addEventListener('change', () => {
      this.showPairs = this.elements.pairsToggle.checked;
    });
    this.elements.contactsToggle.addEventListener('change', () => {
      this.showContacts = this.elements.contactsToggle.checked;
    });
    this.elements.trailsToggle.addEventListener('change', () => {
      this.showTrails = this.elements.trailsToggle.checked;
    });
    this.elements.gridToggle.addEventListener('change', () => {
      this.showGrid = this.elements.gridToggle.checked;
    });

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement) {
        return;
      }

      if (event.key === ' ') {
        event.preventDefault();
        this.isPaused = !this.isPaused;
        this.elements.pauseToggle.checked = this.isPaused;
      }
      if (event.key === '1' || event.key === '2' || event.key === '3') {
        this.method = event.key === '1' ? 'naive' : event.key === '2' ? 'spatial' : 'sweep';
        this.sweep.reset();
        this.audit = null;
        this.syncControls();
        this.updateAuditTelemetry();
        this.scheduleAudit(100);
      }
    });
  }

  private loop(frameStart: number): void {
    const elapsed = frameStart - this.lastFrameStart;
    this.lastFrameStart = frameStart;
    this.frameInterval = elapsed;
    const deltaTime = Math.min(elapsed / 1000, 0.05);

    if (!this.isPaused) {
      const updateStartedAt = performance.now();
      updateBodies(this.bodies, deltaTime, this.speedMultiplier);
      this.updateDuration = performance.now() - updateStartedAt;
    } else {
      this.updateDuration = 0;
    }

    this.broadResult = this.runBroadPhase(this.method);
    const narrow = detectContacts(this.bodies, this.broadResult.pairs);
    this.contacts = narrow.contacts;
    let response: ResponseResult = { duration: 0, impulsesApplied: 0 };
    if (this.resolveResponse) {
      response = resolveContacts(this.bodies, this.contacts, this.restitution);
    }

    this.stats = this.createPipelineStats(this.broadResult, narrow, response);
    const renderStartedAt = performance.now();
    this.renderCanvas();
    this.renderDuration = performance.now() - renderStartedAt;

    this.fpsFrames += 1;
    this.fpsTime += elapsed;
    if (this.fpsTime >= 300) {
      this.fps = (this.fpsFrames * 1000) / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.updateFrameTelemetry();
    }
    this.updatePipelineTelemetry();
    this.updateInsightTelemetry();

    requestAnimationFrame((timestamp) => this.loop(timestamp));
  }

  private runBroadPhase(method: BroadPhaseMethod): BroadPhaseResult {
    if (method === 'naive') {
      return runNaiveBroadPhase(this.bodies);
    }
    if (method === 'spatial') {
      return runSpatialHashBroadPhase(this.bodies, this.cellSize);
    }
    return this.sweep.run(this.bodies);
  }

  private async runAudit(): Promise<void> {
    if (this.auditDebounceId !== null) {
      window.clearTimeout(this.auditDebounceId);
      this.auditDebounceId = null;
    }
    this.elements.auditButton.disabled = true;
    this.elements.auditStatus.textContent = 'Checking every possible pair...';
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));

    const startedAt = performance.now();
    const oracleContacts = new Set<number>();
    for (let first = 0; first < this.bodies.length; first += 1) {
      for (let second = first + 1; second < this.bodies.length; second += 1) {
        const firstBody = this.bodies[first];
        const secondBody = this.bodies[second];
        const deltaX = secondBody.x - firstBody.x;
        const deltaY = secondBody.y - firstBody.y;
        const radiusSum = firstBody.radius + secondBody.radius;
        if (deltaX * deltaX + deltaY * deltaY < radiusSum * radiusSum) {
          oracleContacts.add(first * this.bodies.length + second);
        }
      }
    }

    const selected = this.runBroadPhase(this.method);
    const candidates = new Set<number>();
    for (let index = 0; index < selected.pairs.count; index += 1) {
      candidates.add(
        pairKey(
          selected.pairs.getFirst(index),
          selected.pairs.getSecond(index),
          this.bodies.length,
        ),
      );
    }

    let missedContacts = 0;
    for (const key of oracleContacts) {
      if (!candidates.has(key)) {
        missedContacts += 1;
      }
    }

    this.audit = {
      oracleContacts: oracleContacts.size,
      missedContacts,
      recall: oracleContacts.size === 0 ? 100 : ((oracleContacts.size - missedContacts) / oracleContacts.size) * 100,
      duration: performance.now() - startedAt,
    };
    this.elements.auditButton.disabled = false;
    this.updateAuditTelemetry();
  }

  private scheduleAudit(delay: number): void {
    if (this.auditDebounceId !== null) {
      window.clearTimeout(this.auditDebounceId);
    }
    this.auditDebounceId = window.setTimeout(() => {
      this.auditDebounceId = null;
      void this.runAudit();
    }, delay);
  }

  private async runComparison(): Promise<void> {
    this.elements.compareButton.disabled = true;
    this.elements.comparisonStatus.textContent = 'Running all methods on one frozen snapshot...';
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));

    const wasPaused = this.isPaused;
    this.isPaused = true;
    this.elements.pauseToggle.checked = true;

    const oracleContacts = new Set<number>();
    for (let first = 0; first < this.bodies.length; first += 1) {
      for (let second = first + 1; second < this.bodies.length; second += 1) {
        const firstBody = this.bodies[first];
        const secondBody = this.bodies[second];
        const deltaX = secondBody.x - firstBody.x;
        const deltaY = secondBody.y - firstBody.y;
        const radiusSum = firstBody.radius + secondBody.radius;
        if (deltaX * deltaX + deltaY * deltaY < radiusSum * radiusSum) {
          oracleContacts.add(first * this.bodies.length + second);
        }
      }
    }

    this.comparisonSweep.reset();
    const results: Array<{ method: BroadPhaseMethod; result: BroadPhaseResult }> = [
      { method: 'naive', result: runNaiveBroadPhase(this.bodies) },
      { method: 'spatial', result: runSpatialHashBroadPhase(this.bodies, this.cellSize) },
      { method: 'sweep', result: this.comparisonSweep.run(this.bodies) },
    ];

    this.comparison = results.map(({ method, result }) => {
      const contacts = detectContacts(this.bodies, result.pairs);
      const candidates = new Set<number>();
      for (let index = 0; index < result.pairs.count; index += 1) {
        candidates.add(
          pairKey(
            result.pairs.getFirst(index),
            result.pairs.getSecond(index),
            this.bodies.length,
          ),
        );
      }

      let missed = 0;
      for (const key of oracleContacts) {
        if (!candidates.has(key)) {
          missed += 1;
        }
      }

      return {
        method,
        duration: result.duration,
        candidates: result.pairs.count,
        contacts: contacts.contacts.length,
        falsePositives: result.pairs.count - contacts.contacts.length,
        recall: oracleContacts.size === 0 ? 100 : ((oracleContacts.size - missed) / oracleContacts.size) * 100,
        auxiliaryChecks: result.auxiliaryChecks,
        orderingSwaps: result.orderingSwaps,
        usedFullSort: result.usedFullSort,
      };
    });

    this.isPaused = wasPaused;
    this.elements.pauseToggle.checked = wasPaused;
    this.elements.compareButton.disabled = false;
    this.updateComparisonTelemetry();
  }

  private createPipelineStats(
    broad: BroadPhaseResult,
    narrow: NarrowPhaseResult,
    response: ResponseResult,
  ): PipelineStats {
    return {
      broadDuration: broad.duration,
      narrowDuration: narrow.duration,
      responseDuration: response.duration,
      candidateCount: broad.pairs.count,
      contactCount: narrow.contacts.length,
      falsePositiveCount: Math.max(0, broad.pairs.count - narrow.contacts.length),
      impulsesApplied: response.impulsesApplied,
      auxiliaryChecks: broad.auxiliaryChecks,
      orderingSwaps: broad.orderingSwaps,
      bucketEntries: broad.bucketEntries,
      bucketCount: broad.bucketCount,
      maxBucketSize: broad.maxBucketSize,
      usedFullSort: broad.usedFullSort,
    };
  }

  private resetBodies(count: number): void {
    this.bodies = createBodies(count, this.scenario);
    this.contacts = [];
    this.broadResult = null;
    this.sweep.reset();
    this.comparisonSweep.reset();
    if (this.elements) {
      this.elements.stressButton.disabled = count >= MAX_BODY_COUNT;
    }
  }

  private setBodyCount(count: number): void {
    this.resetBodies(count);
    this.elements.bodySlider.value = String(count);
    this.elements.bodyValue.textContent = count.toLocaleString();
    this.elements.stressButton.disabled = count >= MAX_BODY_COUNT;
    this.audit = null;
    this.comparison = [];
    this.updateAuditTelemetry();
    this.updateComparisonTelemetry();
    this.scheduleAudit(180);
  }

  private renderCanvas(): void {
    const context = this.context;
    const midnight = this.theme === 'midnight';
    context.fillStyle = midnight ? '#09171c' : '#f5f3ed';
    context.fillRect(0, 0, WORLD_BOUNDS.width, WORLD_BOUNDS.height);

    if (this.showGrid && this.method === 'spatial') {
      context.fillStyle = midnight ? 'rgba(115, 209, 197, 0.025)' : 'rgba(20, 127, 133, 0.035)';
      for (let row = 0; row * this.cellSize < WORLD_BOUNDS.height; row += 1) {
        for (let column = 0; column * this.cellSize < WORLD_BOUNDS.width; column += 1) {
          if ((column + row) % 2 === 0) {
            context.fillRect(
              column * this.cellSize,
              row * this.cellSize,
              this.cellSize,
              this.cellSize,
            );
          }
        }
      }
      context.strokeStyle = midnight ? 'rgba(115, 209, 197, 0.18)' : 'rgba(20, 105, 110, 0.2)';
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x <= WORLD_BOUNDS.width; x += this.cellSize) {
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, WORLD_BOUNDS.height);
      }
      for (let y = 0; y <= WORLD_BOUNDS.height; y += this.cellSize) {
        context.moveTo(0, y + 0.5);
        context.lineTo(WORLD_BOUNDS.width, y + 0.5);
      }
      context.stroke();
    }

    if (
      this.showPairs &&
      this.broadResult &&
      this.broadResult.pairs.count <= CANDIDATE_LINE_LIMIT
    ) {
      context.strokeStyle = midnight ? 'rgba(240, 143, 97, 0.28)' : 'rgba(184, 75, 33, 0.25)';
      context.lineWidth = 0.7;
      context.beginPath();
      for (let index = 0; index < this.broadResult.pairs.count; index += 1) {
        const first = this.bodies[this.broadResult.pairs.getFirst(index)];
        const second = this.bodies[this.broadResult.pairs.getSecond(index)];
        context.moveTo(first.x, first.y);
        context.lineTo(second.x, second.y);
      }
      context.stroke();
    }

    if (this.showTrails) {
      context.strokeStyle = midnight ? 'rgba(145, 184, 243, 0.24)' : 'rgba(69, 108, 168, 0.2)';
      context.lineWidth = 1;
      context.beginPath();
      for (const body of this.bodies) {
        const movementX = body.x - body.previousX;
        const movementY = body.y - body.previousY;
        context.moveTo(body.x, body.y);
        context.lineTo(body.x - movementX * 5, body.y - movementY * 5);
      }
      context.stroke();
    }

    const bodyColors = midnight
      ? ['#73d1c5', '#91b8f3', '#9be0a8']
      : ['#147f85', '#456ca8', '#3f8a58'];
    for (const body of this.bodies) {
      context.fillStyle = body.contactFrames > 0
        ? midnight ? '#f08f61' : '#b84b21'
        : bodyColors[body.colorIndex];
      context.beginPath();
      context.arc(body.x, body.y, body.radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = body.radius > 32
        ? midnight ? 'rgba(240, 143, 97, 0.78)' : 'rgba(184, 75, 33, 0.72)'
        : midnight ? 'rgba(3, 12, 16, 0.78)' : 'rgba(255, 255, 255, 0.82)';
      context.lineWidth = body.radius > 32 ? 2 : 1;
      context.stroke();
    }

    if (this.showContacts) {
      context.fillStyle = midnight ? '#ffd0b8' : '#8f3513';
      context.strokeStyle = midnight ? 'rgba(255, 208, 184, 0.78)' : 'rgba(143, 53, 19, 0.72)';
      context.lineWidth = 1;
      for (const contact of this.contacts) {
        context.beginPath();
        context.arc(contact.pointX, contact.pointY, 2.2, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.moveTo(contact.pointX, contact.pointY);
        context.lineTo(
          contact.pointX + contact.normalX * Math.min(12, contact.penetration + 4),
          contact.pointY + contact.normalY * Math.min(12, contact.penetration + 4),
        );
        context.stroke();
      }
    }
  }

  private updatePipelineTelemetry(): void {
    const theoretical = (this.bodies.length * (this.bodies.length - 1)) / 2;
    const rejected = theoretical === 0
      ? 0
      : (1 - this.stats.candidateCount / theoretical) * 100;
    this.elements.theoreticalPairs.textContent = theoretical.toLocaleString();
    this.elements.candidateCount.textContent = this.stats.candidateCount.toLocaleString();
    this.elements.contactCount.textContent = this.stats.contactCount.toLocaleString();
    this.elements.falsePositiveCount.textContent = this.stats.falsePositiveCount.toLocaleString();
    this.elements.rejectionRate.textContent = `${Math.max(0, rejected).toFixed(1)}%`;
    this.elements.broadTime.textContent = this.formatDuration(this.stats.broadDuration);
    this.elements.narrowTime.textContent = this.formatDuration(this.stats.narrowDuration);
    this.elements.responseTime.textContent = this.formatDuration(this.stats.responseDuration);
    this.elements.auxiliaryChecks.textContent = this.stats.auxiliaryChecks.toLocaleString();
    this.elements.orderingSwaps.textContent = this.method === 'sweep'
      ? this.stats.usedFullSort ? 'cold sort' : this.stats.orderingSwaps.toLocaleString()
      : '—';
    this.elements.bucketEntries.textContent = this.method === 'spatial'
      ? this.stats.bucketEntries.toLocaleString()
      : '—';
    this.elements.bucketCount.textContent = this.method === 'spatial'
      ? this.stats.bucketCount.toLocaleString()
      : '—';
    this.elements.maxBucketSize.textContent = this.method === 'spatial'
      ? this.stats.maxBucketSize.toLocaleString()
      : '—';
  }

  private formatDuration(duration: number): string {
    return duration > 0 && duration < 0.01 ? '<0.01' : duration.toFixed(2);
  }

  private updateFrameTelemetry(): void {
    this.elements.fpsBadge.textContent = `${Math.round(this.fps)} FPS`;
    this.elements.fpsBadge.className = 'fps-badge';
    if (this.fps < 40) {
      this.elements.fpsBadge.classList.add('fps-badge--bad');
    } else if (this.fps < 55) {
      this.elements.fpsBadge.classList.add('fps-badge--warn');
    }
    this.elements.frameTime.textContent = this.frameInterval.toFixed(1);
    this.elements.updateTime.textContent = this.updateDuration.toFixed(2);
    this.elements.renderTime.textContent = this.renderDuration.toFixed(2);
  }

  private updateAuditTelemetry(): void {
    if (!this.audit) {
      this.elements.auditStatus.textContent = 'Run an all-pairs oracle check against the selected broad phase.';
      this.elements.auditRecall.textContent = '—';
      this.elements.auditMissed.textContent = '—';
      this.elements.auditOracle.textContent = '—';
      this.elements.auditStatus.classList.remove('telemetry-failure');
      this.elements.auditRecall.classList.remove('telemetry-failure');
      this.elements.auditMissed.classList.remove('telemetry-failure');
      this.elements.canvasRecall.textContent = 'Not audited';
      this.elements.canvasRecallLabel.textContent = 'Snapshot recall';
      this.elements.canvasRecall.parentElement?.classList.remove('canvas-recall--pass', 'canvas-recall--fail');
      return;
    }

    const failed = this.audit.missedContacts > 0;
    this.elements.auditStatus.textContent = failed
      ? `Recall failure: ${this.audit.missedContacts.toLocaleString()} current-frame contact${this.audit.missedContacts === 1 ? '' : 's'} never reached the narrow phase.`
      : `Audited in ${this.audit.duration.toFixed(2)} ms. No current-frame contacts were missed.`;
    this.elements.auditRecall.textContent = `${this.audit.recall.toFixed(1)}%`;
    this.elements.auditMissed.textContent = this.audit.missedContacts.toLocaleString();
    this.elements.auditOracle.textContent = this.audit.oracleContacts.toLocaleString();
    this.elements.auditStatus.classList.toggle('telemetry-failure', failed);
    this.elements.auditRecall.classList.toggle('telemetry-failure', failed);
    this.elements.auditMissed.classList.toggle('telemetry-failure', failed);
    this.elements.canvasRecall.textContent = `${this.audit.recall.toFixed(1)}%`;
    this.elements.canvasRecallLabel.textContent = failed
      ? `${this.audit.missedContacts.toLocaleString()} missed`
      : 'Snapshot recall';
    this.elements.canvasRecall.parentElement?.classList.toggle('canvas-recall--pass', !failed);
    this.elements.canvasRecall.parentElement?.classList.toggle('canvas-recall--fail', failed);
  }

  private updateComparisonTelemetry(): void {
    if (this.comparison.length === 0) {
      this.elements.comparisonStatus.textContent = 'Freeze one snapshot and run every broad phase against it.';
      for (const element of [
        this.elements.comparisonNaiveTime,
        this.elements.comparisonNaiveCandidates,
        this.elements.comparisonNaiveRecall,
        this.elements.comparisonSpatialTime,
        this.elements.comparisonSpatialCandidates,
        this.elements.comparisonSpatialRecall,
        this.elements.comparisonSweepTime,
        this.elements.comparisonSweepCandidates,
        this.elements.comparisonSweepRecall,
      ]) {
        element.textContent = '—';
      }
      return;
    }

    this.elements.comparisonStatus.textContent =
      `Measured on the same ${this.bodies.length.toLocaleString()}-body snapshot.`;
    const write = (
      method: BroadPhaseMethod,
      time: HTMLElement,
      candidates: HTMLElement,
      recall: HTMLElement,
    ): void => {
      const result = this.comparison.find((entry) => entry.method === method);
      if (!result) {
        return;
      }
      time.textContent = `${result.duration.toFixed(2)} ms`;
      const swapDetail = method === 'sweep'
        ? result.usedFullSort
          ? ' · cold full sort'
          : ` · ${result.orderingSwaps.toLocaleString()} order swaps`
        : '';
      candidates.textContent =
        `${result.candidates.toLocaleString()} candidates · ${result.auxiliaryChecks.toLocaleString()} pair checks${swapDetail}`;
      recall.textContent = `${result.recall.toFixed(1)}% recall`;
      recall.classList.toggle('telemetry-failure', result.recall < 100);
    };
    write(
      'naive',
      this.elements.comparisonNaiveTime,
      this.elements.comparisonNaiveCandidates,
      this.elements.comparisonNaiveRecall,
    );
    write(
      'spatial',
      this.elements.comparisonSpatialTime,
      this.elements.comparisonSpatialCandidates,
      this.elements.comparisonSpatialRecall,
    );
    write(
      'sweep',
      this.elements.comparisonSweepTime,
      this.elements.comparisonSweepCandidates,
      this.elements.comparisonSweepRecall,
    );
  }

  private updateInsightTelemetry(): void {
    const possiblePairs = (this.bodies.length * (this.bodies.length - 1)) / 2;
    const candidateRatio = possiblePairs === 0
      ? 0
      : (this.stats.candidateCount / possiblePairs) * 100;
    const scenarioLesson: Record<ScenarioName, string> = {
      uniform: 'Evenly distributed, similarly sized bodies are friendly to fixed grids and coherent sweeps.',
      clusters: 'Dense clusters create legitimate local work, so every method must pass more pairs onward.',
      horizontal: 'Horizontal lanes keep Y overlap narrow, helping the sweep’s secondary Y filter.',
      mixed: 'Mixed radii make one hash cell size a compromise and increase multi-cell insertion.',
      giant: 'Giant bodies span many cells and expose duplicate hash work before deduplication.',
    };

    if (this.method === 'spatial') {
      const entriesPerBody = this.bodies.length === 0
        ? 0
        : this.stats.bucketEntries / this.bodies.length;
      const checksPerCandidate = this.stats.candidateCount === 0
        ? 0
        : this.stats.auxiliaryChecks / this.stats.candidateCount;
      this.elements.insightTitle.textContent = entriesPerBody > 6 || checksPerCandidate > 2.5
        ? 'The grid is paying duplication tax.'
        : 'The grid is keeping work local.';
      this.elements.insightBody.textContent =
        `${scenarioLesson[this.scenario]} Adjust cell size and watch both values below: smaller is not automatically better.`;
      this.elements.insightPrimaryLabel.textContent = 'Cell entries / body';
      this.elements.insightPrimaryValue.textContent = entriesPerBody.toFixed(1);
      this.elements.insightSecondaryLabel.textContent = 'Bucket checks / candidate';
      this.elements.insightSecondaryValue.textContent = checksPerCandidate.toFixed(1);
      return;
    }

    if (this.method === 'sweep') {
      const swapsPerBody = this.bodies.length === 0
        ? 0
        : this.stats.orderingSwaps / this.bodies.length;
      const checksPerCandidate = this.stats.candidateCount === 0
        ? 0
        : this.stats.auxiliaryChecks / this.stats.candidateCount;
      this.elements.insightTitle.textContent = this.stats.usedFullSort
        ? 'Cold start: build the X ordering.'
        : swapsPerBody < 0.5
          ? 'Temporal coherence is doing the sorting work.'
          : 'Fast motion is disrupting interval order.';
      this.elements.insightBody.textContent =
        `${scenarioLesson[this.scenario]} Live frames reuse the prior X order; the swap rate shows how much repair insertion sort needed.`;
      this.elements.insightPrimaryLabel.textContent = 'Order swaps / body';
      this.elements.insightPrimaryValue.textContent = this.stats.usedFullSort ? 'cold sort' : swapsPerBody.toFixed(2);
      this.elements.insightSecondaryLabel.textContent = 'X checks / candidate';
      this.elements.insightSecondaryValue.textContent = checksPerCandidate.toFixed(1);
      return;
    }

    this.elements.insightTitle.textContent = 'The baseline buys certainty with quadratic work.';
    this.elements.insightBody.textContent =
      `${scenarioLesson[this.scenario]} Brute force emits every possible pair, so distribution cannot reduce its broad-phase workload.`;
    this.elements.insightPrimaryLabel.textContent = 'Pairs advanced';
    this.elements.insightPrimaryValue.textContent = `${candidateRatio.toFixed(1)}%`;
    this.elements.insightSecondaryLabel.textContent = 'Pairs rejected';
    this.elements.insightSecondaryValue.textContent = '0%';
  }

  private syncControls(): void {
    this.elements.methodButtons.forEach((button) => {
      const active = button.dataset.method === this.method;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    this.elements.bodySlider.value = String(this.bodies.length);
    this.elements.bodyValue.textContent = this.bodies.length.toLocaleString();
    this.elements.speedSlider.value = String(this.speedMultiplier);
    this.elements.speedValue.textContent = `${this.speedMultiplier.toFixed(1)}x`;
    this.elements.restitutionSlider.value = String(this.restitution);
    this.elements.restitutionValue.textContent = this.restitution.toFixed(2);
    this.elements.cellSlider.value = String(this.cellSize);
    this.elements.cellValue.textContent = `${this.cellSize} px`;
    this.elements.scenarioSelect.value = this.scenario;
    this.elements.pauseToggle.checked = this.isPaused;
    this.elements.responseToggle.checked = this.resolveResponse;
    this.elements.pairsToggle.checked = this.showPairs;
    this.elements.contactsToggle.checked = this.showContacts;
    this.elements.trailsToggle.checked = this.showTrails;
    this.elements.gridToggle.checked = this.showGrid;
    this.elements.cellSlider.disabled = this.method !== 'spatial';
    this.elements.gridToggle.disabled = this.method !== 'spatial';
    this.elements.stressButton.disabled = this.bodies.length >= MAX_BODY_COUNT;
    this.elements.methodDescription.textContent = this.method === 'naive'
      ? 'Every unique body pair advances to the exact circle test. Correct, simple, and quadratic.'
      : this.method === 'spatial'
        ? 'Bodies enter every grid cell touched by their AABB. Cell size trades occupancy against duplication.'
        : 'Single-axis X intervals retain temporal order and use insertion sort; a secondary Y-AABB test removes candidates before the exact circle test.';
  }

  private getPreferredTheme(): ThemeName {
    const stored = window.localStorage.getItem('collision-pipeline-theme');
    if (stored === 'paper' || stored === 'midnight') {
      return stored;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'midnight' : 'paper';
  }

  private applyTheme(): void {
    document.documentElement.dataset.theme = this.theme;
    window.localStorage.setItem('collision-pipeline-theme', this.theme);
    if (this.elements) {
      this.elements.themeButton.textContent = this.theme === 'paper' ? 'Paper' : 'Midnight';
    }
  }

  private captureElements(): AppElements {
    return {
      themeButton: this.getElement<HTMLButtonElement>('#theme-toggle'),
      notesButton: this.getElement<HTMLButtonElement>('#study-notes'),
      dialog: this.getElement<HTMLDialogElement>('#study-dialog'),
      closeDialogButton: this.getElement<HTMLButtonElement>('#close-dialog'),
      resetButton: this.getElement<HTMLButtonElement>('#reset-demo'),
      stressButton: this.getElement<HTMLButtonElement>('#stress-demo'),
      compareButton: this.getElement<HTMLButtonElement>('#run-comparison'),
      auditButton: this.getElement<HTMLButtonElement>('#run-audit'),
      pauseToggle: this.getElement<HTMLInputElement>('#pause-sim'),
      responseToggle: this.getElement<HTMLInputElement>('#resolve-response'),
      pairsToggle: this.getElement<HTMLInputElement>('#show-pairs'),
      contactsToggle: this.getElement<HTMLInputElement>('#show-contacts'),
      trailsToggle: this.getElement<HTMLInputElement>('#show-trails'),
      gridToggle: this.getElement<HTMLInputElement>('#show-grid'),
      bodySlider: this.getElement<HTMLInputElement>('#body-slider'),
      bodyValue: this.getElement<HTMLElement>('#body-value'),
      speedSlider: this.getElement<HTMLInputElement>('#speed-slider'),
      speedValue: this.getElement<HTMLElement>('#speed-value'),
      restitutionSlider: this.getElement<HTMLInputElement>('#restitution-slider'),
      restitutionValue: this.getElement<HTMLElement>('#restitution-value'),
      cellSlider: this.getElement<HTMLInputElement>('#cell-slider'),
      cellValue: this.getElement<HTMLElement>('#cell-value'),
      scenarioSelect: this.getElement<HTMLSelectElement>('#scenario-select'),
      methodButtons: this.root.querySelectorAll<HTMLButtonElement>('[data-method]'),
      methodDescription: this.getElement<HTMLElement>('#method-description'),
      canvas: this.getElement<HTMLCanvasElement>('#collision-canvas'),
      fpsBadge: this.getElement<HTMLElement>('#fps-badge'),
      frameTime: this.getElement<HTMLElement>('#frame-time'),
      updateTime: this.getElement<HTMLElement>('#update-time'),
      renderTime: this.getElement<HTMLElement>('#render-time'),
      theoreticalPairs: this.getElement<HTMLElement>('#theoretical-pairs'),
      candidateCount: this.getElement<HTMLElement>('#candidate-count'),
      contactCount: this.getElement<HTMLElement>('#contact-count'),
      canvasRecall: this.getElement<HTMLElement>('#canvas-recall'),
      canvasRecallLabel: this.getElement<HTMLElement>('#canvas-recall-label'),
      falsePositiveCount: this.getElement<HTMLElement>('#false-positive-count'),
      rejectionRate: this.getElement<HTMLElement>('#rejection-rate'),
      broadTime: this.getElement<HTMLElement>('#broad-time'),
      narrowTime: this.getElement<HTMLElement>('#narrow-time'),
      responseTime: this.getElement<HTMLElement>('#response-time'),
      auxiliaryChecks: this.getElement<HTMLElement>('#auxiliary-checks'),
      orderingSwaps: this.getElement<HTMLElement>('#ordering-swaps'),
      bucketEntries: this.getElement<HTMLElement>('#bucket-entries'),
      bucketCount: this.getElement<HTMLElement>('#bucket-count'),
      maxBucketSize: this.getElement<HTMLElement>('#max-bucket-size'),
      insightTitle: this.getElement<HTMLElement>('#insight-title'),
      insightBody: this.getElement<HTMLElement>('#insight-body'),
      insightPrimaryLabel: this.getElement<HTMLElement>('#insight-primary-label'),
      insightPrimaryValue: this.getElement<HTMLElement>('#insight-primary-value'),
      insightSecondaryLabel: this.getElement<HTMLElement>('#insight-secondary-label'),
      insightSecondaryValue: this.getElement<HTMLElement>('#insight-secondary-value'),
      auditStatus: this.getElement<HTMLElement>('#audit-status'),
      auditRecall: this.getElement<HTMLElement>('#audit-recall'),
      auditMissed: this.getElement<HTMLElement>('#audit-missed'),
      auditOracle: this.getElement<HTMLElement>('#audit-oracle'),
      comparisonStatus: this.getElement<HTMLElement>('#comparison-status'),
      comparisonNaiveTime: this.getElement<HTMLElement>('#comparison-naive-time'),
      comparisonNaiveCandidates: this.getElement<HTMLElement>('#comparison-naive-candidates'),
      comparisonNaiveRecall: this.getElement<HTMLElement>('#comparison-naive-recall'),
      comparisonSpatialTime: this.getElement<HTMLElement>('#comparison-spatial-time'),
      comparisonSpatialCandidates: this.getElement<HTMLElement>('#comparison-spatial-candidates'),
      comparisonSpatialRecall: this.getElement<HTMLElement>('#comparison-spatial-recall'),
      comparisonSweepTime: this.getElement<HTMLElement>('#comparison-sweep-time'),
      comparisonSweepCandidates: this.getElement<HTMLElement>('#comparison-sweep-candidates'),
      comparisonSweepRecall: this.getElement<HTMLElement>('#comparison-sweep-recall'),
    };
  }

  private getElement<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Expected element ${selector}.`);
    }
    return element;
  }

  private renderMarkup(): string {
    return `
      <main class="shell">
        <header class="hero">
          <div class="hero__copy">
            <div class="brand-mark" aria-hidden="true"><span></span><span></span></div>
            <div>
              <div class="hero__meta">
                <div class="eyebrow">Physics systems · Case study 003</div>
                <span class="repo-badge">Public project</span>
              </div>
              <h1>Collision <span>Pipeline</span></h1>
              <div class="hero__subtitle">From millions of possible pairs to resolved contacts</div>
              <p>
                An interactive TypeScript case study comparing brute force, spatial hashing, and sweep-and-prune before
                exact circle detection and measured impulse response.
              </p>
              <div class="hero__proof">
                <span><i class="language-dot language-dot--typescript"></i>TypeScript</span>
                <span><i class="language-dot language-dot--physics"></i>Circle physics</span>
                <span>Audited recall</span>
                <span>2M possible pairs</span>
              </div>
            </div>
          </div>
          <div class="hero__actions">
            <a class="button button--source" href="https://github.com/LilBoyWander/broad-phase-collision" target="_blank" rel="noreferrer"><span class="source-mark">&lt;/&gt;</span>View source</a>
            <button class="button button--theme" id="theme-toggle" type="button">Midnight</button>
            <button class="button" id="study-notes" type="button"><span class="button__spark"></span>Study notes</button>
          </div>
        </header>

        <section class="workspace">
          <section class="stage" aria-labelledby="demo-title">
            <div class="stage__toolbar">
              <div class="stage__meta">
                <div class="stage__index">CP</div>
                <div>
                  <div class="stage__path">demo / dynamic-circle-collisions</div>
                  <h2 id="demo-title">Live collision pipeline</h2>
                  <div class="microcopy">Candidate generation, exact contact tests, and physical response.</div>
                </div>
              </div>
              <div class="stage__actions">
                <button class="button button--quiet" id="reset-demo" type="button">Reset</button>
                <button class="button button--primary" id="stress-demo" type="button">Stress +250</button>
              </div>
            </div>

            <div class="method-switch" aria-label="Broad-phase method">
              <button data-method="naive" type="button"><span>Brute force</span><small>Every pair · O(n²)</small></button>
              <button data-method="spatial" class="is-active" type="button"><span>Spatial hash</span><small>Fixed grid buckets</small></button>
              <button data-method="sweep" type="button"><span>Sweep and prune</span><small>Coherent X intervals</small></button>
            </div>
            <p class="method-description" id="method-description"></p>

            <section class="insight-bar" aria-live="polite">
              <div class="insight-bar__copy">
                <div class="panel__kicker">Key insight</div>
                <h3 id="insight-title">Reading the current frame</h3>
                <p id="insight-body">The selected method and scenario determine which kind of broad-phase work dominates.</p>
              </div>
              <div class="insight-signals">
                <div><span id="insight-primary-label">Primary signal</span><strong id="insight-primary-value">—</strong></div>
                <div><span id="insight-secondary-label">Secondary signal</span><strong id="insight-secondary-value">—</strong></div>
              </div>
            </section>

            <div class="canvas-shell">
              <canvas id="collision-canvas" width="${WORLD_BOUNDS.width}" height="${WORLD_BOUNDS.height}" aria-label="Dynamic circle collision simulation"></canvas>
              <div class="canvas-hud">
                <div><span>Possible</span><strong id="theoretical-pairs">0</strong></div>
                <i></i>
                <div><span>Broad candidates</span><strong id="candidate-count">0</strong></div>
                <i></i>
                <div class="canvas-hud__accent"><span>Exact contacts</span><strong id="contact-count">0</strong></div>
              </div>
              <div class="pipeline-strip">
                <span><b>01</b> Broad phase</span><i></i><span><b>02</b> Narrow phase</span><i></i><span><b>03</b> Response</span>
              </div>
              <div class="canvas-recall">
                <span id="canvas-recall-label">Snapshot recall</span>
                <strong id="canvas-recall">Not audited</strong>
              </div>
            </div>
            <div class="stage-foot">
              <span><b>Correctness rule</b> broad phase may over-report, but must never miss a real contact</span>
              <span><kbd>1</kbd> brute <kbd>2</kbd> hash <kbd>3</kbd> sweep <kbd>Space</kbd> pause</span>
            </div>
          </section>

          <aside class="sidebar">
            <section class="panel panel--performance">
              <div class="panel__header"><div><div class="panel__kicker">Live telemetry</div><h3>Frame health</h3></div><output class="fps-badge" id="fps-badge">60 FPS</output></div>
              <div class="metric metric--wide"><div><b>Frame interval</b><small>Actual time between frames</small></div><strong><span id="frame-time">0.0</span> ms</strong></div>
              <div class="metric-grid">
                <div class="metric"><b>Motion update</b><strong><span id="update-time">0.00</span> ms</strong></div>
                <div class="metric"><b>Canvas render</b><strong><span id="render-time">0.00</span> ms</strong></div>
              </div>
            </section>

            <section class="panel">
              <div class="panel__header"><div><div class="panel__kicker">Workload</div><h3>Simulation</h3></div></div>
              <div class="control-stack">
                <label class="range-row"><span><b>Body count</b><small>Brute force reaches millions of possible pairs</small></span><output id="body-value">850</output><input id="body-slider" type="range" min="100" max="${MAX_BODY_COUNT}" step="50" value="${DEFAULT_BODY_COUNT}" /></label>
                <label class="range-row"><span><b>Motion speed</b><small>Higher movement reduces sweep coherence</small></span><output id="speed-value">1.0x</output><input id="speed-slider" type="range" min="0.2" max="2.5" step="0.1" value="1" /></label>
                <label class="select-row"><span><b>Scenario</b><small>Each distribution stresses methods differently</small></span><select id="scenario-select"><option value="uniform">Uniform small bodies</option><option value="clusters">Dense clusters</option><option value="horizontal">Horizontal lanes</option><option value="mixed">Mixed body sizes</option><option value="giant">Giant bodies</option></select></label>
                <label class="range-row"><span><b>Restitution</b><small>Energy retained by resolved impacts</small></span><output id="restitution-value">0.72</output><input id="restitution-slider" type="range" min="0" max="1" step="0.02" value="0.72" /></label>
                <label class="range-row"><span><b>Hash cell size</b><small>Occupancy versus multi-cell duplication</small></span><output id="cell-value">32 px</output><input id="cell-slider" type="range" min="16" max="128" step="8" value="${DEFAULT_CELL_SIZE}" /></label>
              </div>
              <div class="scope-note"><b>Discrete detection</b> Fast bodies can cross between frames. Recall audits current-frame overlaps, not swept paths.</div>
            </section>

            <section class="panel">
              <div class="panel__header"><div><div class="panel__kicker">Pipeline cost</div><h3>Measured stages</h3></div></div>
              <dl class="stats-grid stats-grid--accent">
                <dt>Broad phase</dt><dd><span id="broad-time">0.00</span> ms</dd>
                <dt>Narrow phase</dt><dd><span id="narrow-time">0.00</span> ms</dd>
                <dt>Response</dt><dd><span id="response-time">0.00</span> ms</dd>
                <dt>False positives</dt><dd id="false-positive-count">0</dd>
                <dt>Pairs rejected</dt><dd id="rejection-rate">0.0%</dd>
                <dt>Broad pair checks</dt><dd id="auxiliary-checks">0</dd>
                <dt>Sweep order swaps</dt><dd id="ordering-swaps">—</dd>
                <dt>Hash cell entries</dt><dd id="bucket-entries">—</dd>
                <dt>Hash buckets</dt><dd id="bucket-count">0</dd>
                <dt>Max bucket</dt><dd id="max-bucket-size">0</dd>
              </dl>
            </section>

            <section class="panel">
              <div class="panel__header"><div><div class="panel__kicker">Inspect</div><h3>Debug and response</h3></div></div>
              <div class="toggle-stack">
                <label class="toggle"><span><b>Resolve contacts</b><small>Apply correction and impulses</small></span><span class="switch"><input id="resolve-response" type="checkbox" checked /><i></i></span></label>
                <label class="toggle"><span><b>Candidate lines</b><small>Shown when candidate count is manageable</small></span><span class="switch"><input id="show-pairs" type="checkbox" /><i></i></span></label>
                <label class="toggle"><span><b>Contact normals</b><small>Exact narrow-phase result</small></span><span class="switch"><input id="show-contacts" type="checkbox" checked /><i></i></span></label>
                <label class="toggle"><span><b>Motion ticks</b><small>Short per-frame trails without accumulation</small></span><span class="switch"><input id="show-trails" type="checkbox" checked /><i></i></span></label>
                <label class="toggle"><span><b>Spatial grid</b><small>Available in hash mode</small></span><span class="switch"><input id="show-grid" type="checkbox" checked /><i></i></span></label>
                <label class="toggle"><span><b>Pause simulation</b><small>Inspect one stable snapshot</small></span><span class="switch"><input id="pause-sim" type="checkbox" /><i></i></span></label>
              </div>
            </section>
          </aside>
        </section>

        <section class="audit">
          <div class="audit__intro">
            <div class="eyebrow">Correctness audit</div>
            <h2>Fast is irrelevant if it misses.</h2>
            <p id="audit-status">Run an all-pairs oracle check against the selected broad phase.</p>
            <button class="button button--primary" id="run-audit" type="button">Audit contact recall</button>
          </div>
          <div class="audit__metrics">
            <div><span>Contact recall</span><strong id="audit-recall">—</strong></div>
            <div><span>Missed contacts</span><strong id="audit-missed">—</strong></div>
            <div><span>Oracle contacts</span><strong id="audit-oracle">—</strong></div>
          </div>
        </section>

        <section class="comparison">
          <div class="comparison__intro">
            <div class="eyebrow">Same-snapshot benchmark</div>
            <h2>Distribution decides the winner.</h2>
            <p id="comparison-status">Freeze one snapshot and run every broad phase against it.</p>
            <p class="comparison-note">Candidate counts are not identical work units: hash candidates share a cell; sweep candidates already passed X and Y AABB filters. The one-shot sweep timing includes its cold-start sort.</p>
            <button class="button button--primary" id="run-comparison" type="button">Compare all methods</button>
          </div>
          <div class="comparison__cards">
            <article><div><span>Brute force</span><b>Every theoretical pair</b></div><strong id="comparison-naive-time">—</strong><small id="comparison-naive-candidates">—</small><em id="comparison-naive-recall">—</em></article>
            <article class="comparison__featured"><div><span>Spatial hash</span><b>Tunable fixed grid</b></div><strong id="comparison-spatial-time">—</strong><small id="comparison-spatial-candidates">—</small><em id="comparison-spatial-recall">—</em></article>
            <article><div><span>Sweep and prune</span><b>Coherent intervals</b></div><strong id="comparison-sweep-time">—</strong><small id="comparison-sweep-candidates">—</small><em id="comparison-sweep-recall">—</em></article>
          </div>
        </section>

        <section class="explanation">
          <div class="explanation__intro"><div class="eyebrow">Collision pipeline</div><h2>Reduce, confirm, resolve.</h2><p>No broad phase detects the final collision. It only decides which exact tests are worth paying for.</p></div>
          <ol class="pipeline">
            <li><span>01</span><div><b>Broad phase</b><p>Generate a conservative set of potentially overlapping bodies.</p></div></li>
            <li><span>02</span><div><b>Narrow phase</b><p>Run exact circle tests and construct contact normals and penetration depth.</p></div></li>
            <li><span>03</span><div><b>Response</b><p>Correct overlap and apply mass-weighted restitution impulses.</p></div></li>
          </ol>
        </section>

        <section class="tradeoffs">
          <article><span>Spatial hash</span><h3>Local density matters</h3><p>Excellent for similarly sized, spatially distributed bodies. Dense buckets and giant multi-cell bodies increase duplicate work.</p></article>
          <article><span>Sweep and prune</span><h3>Coherence matters</h3><p>Strong when interval ordering changes slowly. One-axis overlap can become weak when many bodies share the same projection.</p></article>
          <article><span>Brute force</span><h3>Simplicity has value</h3><p>Useful as a correctness oracle and for tiny body counts, but its quadratic pair count dominates quickly.</p></article>
        </section>

        <footer class="footer"><span>Case study 003 · Candidate generation, exact contacts, and impulse response</span><a href="https://github.com/LilBoyWander/broad-phase-collision" target="_blank" rel="noreferrer">View the source on GitHub</a></footer>

        <dialog class="dialog" id="study-dialog">
          <div class="dialog__accent"></div>
          <div class="dialog__body">
            <div class="panel__kicker">Study notes</div>
            <h3>What this case study proves</h3>
            <p>A broad phase is a conservative filter. Its job is to reject impossible pairs cheaply without losing any pair that the exact narrow phase would confirm.</p>
            <ul>
              <li>Brute force is retained as both a baseline and the contact-recall oracle.</li>
              <li>Spatial hashing inserts each circle into every cell touched by its AABB.</li>
              <li>Sweep and prune retains X-interval order between live frames and repairs it with insertion sort.</li>
              <li>Narrow-phase and response durations are measured separately.</li>
              <li>Scenario presets demonstrate that no broad phase wins every distribution.</li>
              <li>The canvas is fully cleared each frame; crisp outlines separate dense bodies without accumulating trails.</li>
              <li>Collision detection is discrete, so sufficiently fast bodies can tunnel between frames.</li>
            </ul>
          </div>
          <div class="dialog__actions"><button class="button" id="close-dialog" type="button">Close</button></div>
        </dialog>
      </main>
    `;
  }
}

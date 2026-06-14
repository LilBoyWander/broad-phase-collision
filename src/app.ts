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
import { resolveTunneling } from './physics/continuous';
import type {
  Body,
  BroadPhaseMethod,
  BroadPhaseResult,
  Contact,
  ScenarioName,
} from './physics/types';
import { createBodies, createBody, updateBodies, WORLD_BOUNDS } from './physics/world';

interface PipelineStats {
  broadDuration: number;
  narrowDuration: number;
  continuousDuration: number;
  responseDuration: number;
  candidateCount: number;
  contactCount: number;
  falsePositiveCount: number;
  tunnelingSaves: number;
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

interface ScalingPoint {
  count: number;
  duration: number;
}

interface ScalingSeries {
  method: BroadPhaseMethod;
  points: ScalingPoint[];
}

interface VersusPanelResult {
  candidates: number;
  contacts: number;
  duration: number;
}

interface MethodRaceSample {
  duration: number;
  candidates: number;
  contacts: number;
  checks: number;
}

type InteractionTool = 'launch' | 'spray' | 'wall' | 'erase';
type SweepInsightState = 'coherent' | 'overlap' | 'churn';

interface AppElements {
  themeButton: HTMLButtonElement;
  notesButton: HTMLButtonElement;
  dialog: HTMLDialogElement;
  closeDialogButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  stressButton: HTMLButtonElement;
  ccdChallengeButton: HTMLButtonElement;
  compareButton: HTMLButtonElement;
  auditButton: HTMLButtonElement;
  pauseToggle: HTMLInputElement;
  responseToggle: HTMLInputElement;
  ccdToggle: HTMLInputElement;
  pairsToggle: HTMLInputElement;
  contactsToggle: HTMLInputElement;
  trailsToggle: HTMLInputElement;
  gridToggle: HTMLInputElement;
  toolButtons: NodeListOf<HTMLButtonElement>;
  brushSlider: HTMLInputElement;
  brushValue: HTMLElement;
  clearCustomButton: HTMLButtonElement;
  customBodyCount: HTMLElement;
  interactionHint: HTMLElement;
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
  candidateVisibility: HTMLElement;
  ccdStatus: HTMLElement;
  falsePositiveCount: HTMLElement;
  falsePositiveRate: HTMLElement;
  tunnelingSaves: HTMLElement;
  stageRecall: HTMLElement;
  stageMissed: HTMLElement;
  rejectionRate: HTMLElement;
  broadTime: HTMLElement;
  narrowTime: HTMLElement;
  continuousTime: HTMLElement;
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
  lessonBest: HTMLElement;
  lessonRisk: HTMLElement;
  lessonVerdict: HTMLElement;
  raceSpatialTime: HTMLElement;
  raceSpatialWork: HTMLElement;
  raceSweepTime: HTMLElement;
  raceSweepWork: HTMLElement;
  raceVerdict: HTMLElement;
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
  versusActiveToggle: HTMLInputElement;
  versusSelectA: HTMLSelectElement;
  versusSelectB: HTMLSelectElement;
  versusCanvasA: HTMLCanvasElement;
  versusCanvasB: HTMLCanvasElement;
  versusNameA: HTMLElement;
  versusNameB: HTMLElement;
  versusStatsA: HTMLElement;
  versusStatsB: HTMLElement;
  versusVerdict: HTMLElement;
  scalingButton: HTMLButtonElement;
  scalingStatus: HTMLElement;
  scalingCanvas: HTMLCanvasElement;
}

type ThemeName = 'paper' | 'midnight';

const DEFAULT_BODY_COUNT = 850;
const MAX_BODY_COUNT = 2000;
const DEFAULT_CELL_SIZE = 32;
const CANDIDATE_LINE_LIMIT = 420;
const SCALING_COUNTS = [100, 300, 600, 1000, 1500, 2000];
const METHOD_RACE_INTERVAL = 12;
const INSIGHT_STABILITY_FRAMES = 24;

/** Rounds an axis maximum up to a clean 1/2/5 × 10ⁿ value so chart gridlines read well. */
function niceCeil(value: number): number {
  if (value <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

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
  private readonly versusSweepA = new SweepAndPrune();
  private readonly versusSweepB = new SweepAndPrune();
  private readonly raceSweep = new SweepAndPrune();

  private elements!: AppElements;
  private context!: CanvasRenderingContext2D;
  private versusContextA: CanvasRenderingContext2D | null = null;
  private versusContextB: CanvasRenderingContext2D | null = null;
  private versusActive = false;
  private versusMethodA: BroadPhaseMethod = 'spatial';
  private versusMethodB: BroadPhaseMethod = 'sweep';
  private bodies: Body[] = [];
  private contacts: Contact[] = [];
  private continuousContacts: Contact[] = [];
  private broadResult: BroadPhaseResult | null = null;
  private method: BroadPhaseMethod = 'spatial';
  private scenario: ScenarioName = 'uniform';
  private theme: ThemeName = 'midnight';
  private cellSize = DEFAULT_CELL_SIZE;
  private speedMultiplier = 1;
  private restitution = 0.72;
  private isPaused = false;
  private resolveResponse = true;
  private ccd = false;
  private showPairs = false;
  private showContacts = true;
  private showTrails = true;
  private showGrid = true;
  private interactionTool: InteractionTool = 'launch';
  private brushRadius = 12;
  private pointerActive = false;
  private pointerStart: { x: number; y: number } | null = null;
  private pointerCurrent: { x: number; y: number } | null = null;
  private lastPaintPoint: { x: number; y: number } | null = null;
  private nextBodyId = 0;
  private lastFrameStart = performance.now();
  private frameInterval = 1000 / 60;
  private fps = 60;
  private fpsFrames = 0;
  private fpsTime = 0;
  private updateDuration = 0;
  private renderDuration = 0;
  private cumulativeTunnelingSaves = 0;
  private countDebounceId: number | null = null;
  private auditDebounceId: number | null = null;
  private raceFrame = METHOD_RACE_INTERVAL - 1;
  private raceSpatial: MethodRaceSample | null = null;
  private raceSweepSample: MethodRaceSample | null = null;
  private smoothedSweepSwapsPerBody = 0;
  private smoothedSweepChecksPerBody = 0;
  private sweepInsightInitialized = false;
  private sweepInsightState: SweepInsightState = 'coherent';
  private pendingSweepInsightState: SweepInsightState = 'coherent';
  private pendingSweepInsightFrames = 0;
  private stats: PipelineStats = {
    broadDuration: 0,
    narrowDuration: 0,
    continuousDuration: 0,
    responseDuration: 0,
    candidateCount: 0,
    contactCount: 0,
    falsePositiveCount: 0,
    tunnelingSaves: 0,
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
  private scaling: ScalingSeries[] | null = null;
  private scalingContext: CanvasRenderingContext2D | null = null;

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
    this.versusContextA = this.elements.versusCanvasA.getContext('2d');
    this.versusContextB = this.elements.versusCanvasB.getContext('2d');
    this.scalingContext = this.elements.scalingCanvas.getContext('2d');

    this.theme = this.getPreferredTheme();
    this.applyTheme();
    this.resetBodies(DEFAULT_BODY_COUNT);
    this.bindEvents();
    this.syncControls();
    this.syncVersusLabels();
    this.clearVersusPanels();
    this.renderScalingChart();
    this.scheduleAudit(400);
    requestAnimationFrame((timestamp) => this.loop(timestamp));
  }

  private bindEvents(): void {
    this.elements.themeButton.addEventListener('click', () => {
      this.theme = this.theme === 'paper' ? 'midnight' : 'paper';
      this.applyTheme();
      this.renderScalingChart();
    });
    this.elements.scalingButton.addEventListener('click', () => void this.runScaling());
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
      this.ccd = false;
      this.resetBodies(DEFAULT_BODY_COUNT);
      this.audit = null;
      this.comparison = [];
      this.resetScaling();
      this.syncControls();
      this.updateAuditTelemetry();
      this.updateComparisonTelemetry();
      this.scheduleAudit(100);
    });

    this.elements.stressButton.addEventListener('click', () => {
      this.setBodyCount(Math.min(this.bodies.length + 250, MAX_BODY_COUNT));
    });
    this.elements.ccdChallengeButton.addEventListener('click', () => {
      this.scenario = 'tunneling';
      this.method = 'spatial';
      this.speedMultiplier = 1;
      this.ccd = true;
      this.showTrails = true;
      this.showPairs = false;
      this.setBodyCount(48);
      this.syncControls();
    });
    this.elements.auditButton.addEventListener('click', () => void this.runAudit());
    this.elements.compareButton.addEventListener('click', () => void this.runComparison());

    this.elements.methodButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const method = button.dataset.method;
        if (method === 'naive' || method === 'spatial' || method === 'sweep') {
          this.method = method;
          this.sweep.reset();
          this.resetInsightSmoothing();
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
        scenario === 'giant' ||
        scenario === 'tunneling'
      ) {
        this.scenario = scenario;
        this.resetBodies(scenario === 'tunneling' ? 48 : this.bodies.length);
        this.audit = null;
        this.comparison = [];
        this.resetScaling();
        this.syncControls();
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
    this.elements.ccdToggle.addEventListener('change', () => {
      this.ccd = this.elements.ccdToggle.checked;
      this.cumulativeTunnelingSaves = 0;
      this.continuousContacts = [];
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
    this.elements.toolButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const tool = button.dataset.tool;
        if (tool === 'launch' || tool === 'spray' || tool === 'wall' || tool === 'erase') {
          this.interactionTool = tool;
          this.syncInteractionControls();
        }
      });
    });
    this.elements.brushSlider.addEventListener('input', () => {
      this.brushRadius = Number.parseInt(this.elements.brushSlider.value, 10);
      this.syncInteractionControls();
    });
    this.elements.clearCustomButton.addEventListener('click', () => {
      this.bodies = this.bodies.filter((body) => !body.isUserCreated);
      this.afterBodiesEdited();
      this.scheduleAudit(180);
    });
    this.elements.canvas.addEventListener('pointerdown', (event) => this.beginCanvasInteraction(event));
    this.elements.canvas.addEventListener('pointermove', (event) => this.moveCanvasInteraction(event));
    this.elements.canvas.addEventListener('pointerup', (event) => this.endCanvasInteraction(event));
    this.elements.canvas.addEventListener('pointercancel', () => this.cancelCanvasInteraction());
    this.elements.canvas.addEventListener('pointerleave', () => {
      if (!this.pointerActive) {
        this.pointerCurrent = null;
      }
    });

    this.elements.versusActiveToggle.addEventListener('change', () => {
      this.versusActive = this.elements.versusActiveToggle.checked;
      if (!this.versusActive) {
        this.clearVersusPanels();
      }
    });
    this.elements.versusSelectA.addEventListener('change', () => {
      const method = this.elements.versusSelectA.value;
      if (method === 'naive' || method === 'spatial' || method === 'sweep') {
        this.versusMethodA = method;
        this.versusSweepA.reset();
        this.syncVersusLabels();
      }
    });
    this.elements.versusSelectB.addEventListener('change', () => {
      const method = this.elements.versusSelectB.value;
      if (method === 'naive' || method === 'spatial' || method === 'sweep') {
        this.versusMethodB = method;
        this.versusSweepB.reset();
        this.syncVersusLabels();
      }
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
        this.resetInsightSmoothing();
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
    this.continuousContacts = [];
    let tunnelingSaves = 0;
    let continuousDuration = 0;
    if (this.ccd && !this.isPaused) {
      const continuous = resolveTunneling(this.bodies, this.broadResult.pairs, narrow.contacts);
      tunnelingSaves = continuous.saves;
      continuousDuration = continuous.duration;
      this.continuousContacts = continuous.contacts;
      if (continuous.contacts.length > 0) {
        this.contacts = narrow.contacts.concat(continuous.contacts);
      }
    }
    let response: ResponseResult = { duration: 0, impulsesApplied: 0 };
    if (this.resolveResponse) {
      response = resolveContacts(this.bodies, this.contacts, this.restitution);
    }

    this.stats = this.createPipelineStats(this.broadResult, narrow, response);
    this.stats.tunnelingSaves = tunnelingSaves;
    this.stats.continuousDuration = continuousDuration;
    this.stats.contactCount = this.contacts.length;
    this.stats.falsePositiveCount = Math.max(0, this.stats.candidateCount - this.contacts.length);
    this.cumulativeTunnelingSaves += tunnelingSaves;
    const renderStartedAt = performance.now();
    this.renderCanvas();
    this.renderDuration = performance.now() - renderStartedAt;
    this.updateMethodRace();
    this.renderVersus();

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
      return runSpatialHashBroadPhase(this.bodies, this.cellSize, this.ccd);
    }
    return this.sweep.run(this.bodies, this.ccd);
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
        if (firstBody.inverseMass === 0 && secondBody.inverseMass === 0) {
          continue;
        }
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
        if (firstBody.inverseMass === 0 && secondBody.inverseMass === 0) {
          continue;
        }
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
      { method: 'spatial', result: runSpatialHashBroadPhase(this.bodies, this.cellSize, this.ccd) },
      { method: 'sweep', result: this.comparisonSweep.run(this.bodies, this.ccd) },
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
      continuousDuration: 0,
      responseDuration: response.duration,
      candidateCount: broad.pairs.count,
      contactCount: narrow.contacts.length,
      falsePositiveCount: Math.max(0, broad.pairs.count - narrow.contacts.length),
      tunnelingSaves: 0,
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
    this.nextBodyId = count;
    this.contacts = [];
    this.continuousContacts = [];
    this.cumulativeTunnelingSaves = 0;
    this.broadResult = null;
    this.sweep.reset();
    this.comparisonSweep.reset();
    this.versusSweepA.reset();
    this.versusSweepB.reset();
    this.raceSweep.reset();
    this.raceSpatial = null;
    this.raceSweepSample = null;
    this.raceFrame = METHOD_RACE_INTERVAL - 1;
    this.resetInsightSmoothing();
    if (this.elements) {
      this.elements.stressButton.disabled = count >= MAX_BODY_COUNT;
      this.syncInteractionControls();
      this.updateMethodRaceTelemetry();
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

  private beginCanvasInteraction(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const point = this.canvasPoint(event);
    this.pointerActive = true;
    this.pointerStart = point;
    this.pointerCurrent = point;
    this.lastPaintPoint = null;
    this.elements.canvas.setPointerCapture?.(event.pointerId);
    if (this.interactionTool !== 'launch') {
      this.paintAlongPath(point);
    }
  }

  private moveCanvasInteraction(event: PointerEvent): void {
    const point = this.canvasPoint(event);
    this.pointerCurrent = point;
    if (!this.pointerActive) {
      return;
    }
    event.preventDefault();
    if (this.interactionTool !== 'launch') {
      this.paintAlongPath(point);
    }
  }

  private endCanvasInteraction(event: PointerEvent): void {
    if (!this.pointerActive) {
      return;
    }
    event.preventDefault();
    const point = this.canvasPoint(event);
    if (this.interactionTool === 'launch' && this.pointerStart) {
      this.launchBody(this.pointerStart, point);
    } else {
      this.paintAlongPath(point);
    }
    this.elements.canvas.releasePointerCapture?.(event.pointerId);
    this.cancelCanvasInteraction();
    this.scheduleAudit(350);
  }

  private cancelCanvasInteraction(): void {
    this.pointerActive = false;
    this.pointerStart = null;
    this.lastPaintPoint = null;
  }

  private canvasPoint(event: PointerEvent): { x: number; y: number } {
    const bounds = this.elements.canvas.getBoundingClientRect();
    const width = bounds.width || this.elements.canvas.width;
    const height = bounds.height || this.elements.canvas.height;
    return {
      x: Math.max(0, Math.min(WORLD_BOUNDS.width, (event.clientX - bounds.left) * (this.elements.canvas.width / width))),
      y: Math.max(0, Math.min(WORLD_BOUNDS.height, (event.clientY - bounds.top) * (this.elements.canvas.height / height))),
    };
  }

  private paintAlongPath(point: { x: number; y: number }): void {
    const spacing = this.interactionTool === 'wall'
      ? this.brushRadius * 2.15
      : Math.max(5, this.brushRadius * 0.75);
    if (!this.lastPaintPoint) {
      this.applyToolAt(point);
      this.lastPaintPoint = point;
      return;
    }

    const deltaX = point.x - this.lastPaintPoint.x;
    const deltaY = point.y - this.lastPaintPoint.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < spacing) {
      return;
    }
    const steps = Math.floor(distance / spacing);
    for (let step = 1; step <= steps; step += 1) {
      const progress = (step * spacing) / distance;
      this.applyToolAt({
        x: this.lastPaintPoint.x + deltaX * progress,
        y: this.lastPaintPoint.y + deltaY * progress,
      });
    }
    this.lastPaintPoint = {
      x: this.lastPaintPoint.x + deltaX * ((steps * spacing) / distance),
      y: this.lastPaintPoint.y + deltaY * ((steps * spacing) / distance),
    };
  }

  private applyToolAt(point: { x: number; y: number }): void {
    if (this.interactionTool === 'erase') {
      const before = this.bodies.length;
      this.bodies = this.bodies.filter(
        (body) => Math.hypot(body.x - point.x, body.y - point.y) > this.brushRadius + body.radius,
      );
      if (this.bodies.length !== before) {
        this.afterBodiesEdited();
      }
      return;
    }
    if (this.bodies.length >= MAX_BODY_COUNT) {
      return;
    }
    if (this.interactionTool === 'wall') {
      this.bodies.push(createBody({
        id: this.nextBodyId,
        x: point.x,
        y: point.y,
        radius: this.brushRadius,
        colorIndex: 0,
        isStatic: true,
        isUserCreated: true,
      }));
      this.nextBodyId += 1;
      this.afterBodiesEdited();
      return;
    }
    if (this.interactionTool === 'spray') {
      const available = Math.min(4, MAX_BODY_COUNT - this.bodies.length);
      for (let index = 0; index < available; index += 1) {
        const id = this.nextBodyId;
        const angle = id * 2.399963229728653;
        const jitter = this.brushRadius * (0.15 + (id % 5) * 0.12);
        const speed = 35 + (id * 29) % 95;
        this.bodies.push(createBody({
          id,
          x: point.x + Math.cos(angle) * jitter,
          y: point.y + Math.sin(angle) * jitter,
          radius: Math.max(3, this.brushRadius * 0.42),
          velocityX: Math.cos(angle) * speed,
          velocityY: Math.sin(angle) * speed,
          colorIndex: id % 3,
          isUserCreated: true,
        }));
        this.nextBodyId += 1;
      }
      this.afterBodiesEdited();
    }
  }

  private launchBody(start: { x: number; y: number }, end: { x: number; y: number }): void {
    if (this.bodies.length >= MAX_BODY_COUNT) {
      return;
    }
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const drag = Math.hypot(deltaX, deltaY);
    const scale = drag > 3 ? Math.min(3.2, 700 / drag) : 0;
    const id = this.nextBodyId;
    this.bodies.push(createBody({
      id,
      x: start.x,
      y: start.y,
      radius: this.brushRadius,
      velocityX: scale > 0 ? deltaX * scale : 70 * Math.cos(id * 2.4),
      velocityY: scale > 0 ? deltaY * scale : 70 * Math.sin(id * 2.4),
      colorIndex: id % 3,
      isUserCreated: true,
    }));
    this.nextBodyId += 1;
    this.afterBodiesEdited();
  }

  private afterBodiesEdited(): void {
    this.contacts = [];
    this.continuousContacts = [];
    this.sweep.reset();
    this.comparisonSweep.reset();
    this.versusSweepA.reset();
    this.versusSweepB.reset();
    this.raceSweep.reset();
    this.raceSpatial = null;
    this.raceSweepSample = null;
    this.raceFrame = METHOD_RACE_INTERVAL - 1;
    this.audit = null;
    this.comparison = [];
    this.elements.bodySlider.value = String(this.bodies.length);
    this.elements.bodyValue.textContent = this.bodies.length.toLocaleString();
    this.elements.stressButton.disabled = this.bodies.length >= MAX_BODY_COUNT;
    this.updateAuditTelemetry();
    this.updateComparisonTelemetry();
    this.updateMethodRaceTelemetry();
    this.syncInteractionControls();
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

    this.elements.candidateVisibility.className = 'canvas-mode';
    if (this.showPairs && this.broadResult) {
      const pairCount = this.broadResult.pairs.count;
      const step = Math.max(1, Math.ceil(pairCount / CANDIDATE_LINE_LIMIT));
      const drawnCount = pairCount === 0 ? 0 : Math.ceil(pairCount / step);
      context.strokeStyle = midnight ? 'rgba(240, 143, 97, 0.28)' : 'rgba(184, 75, 33, 0.25)';
      context.lineWidth = 0.7;
      context.beginPath();
      for (let index = 0; index < pairCount; index += step) {
        const first = this.bodies[this.broadResult.pairs.getFirst(index)];
        const second = this.bodies[this.broadResult.pairs.getSecond(index)];
        context.moveTo(first.x, first.y);
        context.lineTo(second.x, second.y);
      }
      context.stroke();
      this.elements.candidateVisibility.textContent = step > 1
        ? `${drawnCount.toLocaleString()} of ${pairCount.toLocaleString()} candidate lines sampled`
        : `${pairCount.toLocaleString()} candidate line${pairCount === 1 ? '' : 's'} shown`;
      this.elements.candidateVisibility.classList.add('canvas-mode--active');
    } else {
      this.elements.candidateVisibility.textContent = 'Candidate overlay off';
    }

    if (this.showTrails) {
      context.strokeStyle = midnight ? 'rgba(145, 184, 243, 0.24)' : 'rgba(69, 108, 168, 0.2)';
      context.lineWidth = 1;
      context.beginPath();
      for (const body of this.bodies) {
        if (body.isStatic) {
          continue;
        }
        const movementX = body.x - body.previousX;
        const movementY = body.y - body.previousY;
        context.moveTo(body.x, body.y);
        context.lineTo(body.x - movementX * 5, body.y - movementY * 5);
      }
      context.stroke();
    }

    if (this.ccd) {
      context.strokeStyle = midnight ? 'rgba(241, 194, 92, 0.34)' : 'rgba(166, 105, 0, 0.3)';
      context.lineWidth = 1.2;
      context.beginPath();
      for (const body of this.bodies) {
        if (Math.hypot(body.x - body.previousX, body.y - body.previousY) < body.radius) {
          continue;
        }
        context.moveTo(body.previousX, body.previousY);
        context.lineTo(body.x, body.y);
      }
      context.stroke();
    }

    const bodyColors = midnight
      ? ['#73d1c5', '#91b8f3', '#9be0a8']
      : ['#147f85', '#456ca8', '#3f8a58'];
    for (const body of this.bodies) {
      context.fillStyle = body.isStatic
        ? midnight ? '#243940' : '#d7d7cf'
        : body.contactFrames > 0
        ? midnight ? '#f08f61' : '#b84b21'
        : bodyColors[body.colorIndex];
      context.beginPath();
      context.arc(body.x, body.y, body.radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = body.isStatic
        ? midnight ? '#ffd166' : '#8d5d05'
        : body.radius > 32
        ? midnight ? 'rgba(240, 143, 97, 0.78)' : 'rgba(184, 75, 33, 0.72)'
        : midnight ? 'rgba(3, 12, 16, 0.78)' : 'rgba(255, 255, 255, 0.82)';
      context.lineWidth = body.isStatic || body.radius > 32 ? 2 : 1;
      context.stroke();
      if (body.isStatic && body.radius >= 8) {
        context.beginPath();
        context.moveTo(body.x - body.radius * 0.45, body.y);
        context.lineTo(body.x + body.radius * 0.45, body.y);
        context.moveTo(body.x, body.y - body.radius * 0.45);
        context.lineTo(body.x, body.y + body.radius * 0.45);
        context.stroke();
      }
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

    if (this.continuousContacts.length > 0) {
      context.strokeStyle = midnight ? '#ffd166' : '#9b6200';
      context.lineWidth = 2.4;
      for (const contact of this.continuousContacts) {
        for (const bodyIndex of [contact.a, contact.b]) {
          const body = this.bodies[bodyIndex];
          context.beginPath();
          context.arc(body.x, body.y, body.radius + 4, 0, Math.PI * 2);
          context.stroke();
        }
      }
    }

    if (this.pointerCurrent) {
      context.strokeStyle = midnight ? 'rgba(255, 209, 102, 0.92)' : 'rgba(141, 93, 5, 0.9)';
      context.lineWidth = 1.5;
      context.setLineDash([5, 4]);
      context.beginPath();
      context.arc(this.pointerCurrent.x, this.pointerCurrent.y, this.brushRadius, 0, Math.PI * 2);
      context.stroke();
      if (this.pointerActive && this.interactionTool === 'launch' && this.pointerStart) {
        context.beginPath();
        context.moveTo(this.pointerStart.x, this.pointerStart.y);
        context.lineTo(this.pointerCurrent.x, this.pointerCurrent.y);
        context.stroke();
      }
      context.setLineDash([]);
    }
  }

  /** Draws the same live bodies through two independently chosen broad phases so their candidate sets can be compared. */
  private renderVersus(): void {
    if (!this.versusActive) {
      return;
    }
    let left: VersusPanelResult | null = null;
    let right: VersusPanelResult | null = null;
    if (this.versusContextA) {
      left = this.renderVersusPanel(this.versusContextA, this.versusMethodA, this.versusSweepA, this.elements.versusStatsA);
    }
    if (this.versusContextB) {
      right = this.renderVersusPanel(this.versusContextB, this.versusMethodB, this.versusSweepB, this.elements.versusStatsB);
    }
    if (left && right) {
      if (this.versusMethodA === this.versusMethodB) {
        this.elements.versusVerdict.textContent = 'Choose two different methods to expose how their filters change the work.';
      } else {
        const leaner = left.candidates <= right.candidates
          ? { name: this.methodLabel(this.versusMethodA), count: left.candidates, other: right.candidates }
          : { name: this.methodLabel(this.versusMethodB), count: right.candidates, other: left.candidates };
        const difference = leaner.other - leaner.count;
        this.elements.versusVerdict.textContent =
          `${leaner.name} forwards ${difference.toLocaleString()} fewer pairs on this frame. Both still confirm ${Math.max(left.contacts, right.contacts).toLocaleString()} exact contacts.`;
      }
    }
  }

  private updateMethodRace(): void {
    this.raceFrame += 1;
    if (this.raceFrame < METHOD_RACE_INTERVAL) {
      return;
    }
    this.raceFrame = 0;

    const spatialResult = runSpatialHashBroadPhase(this.bodies, this.cellSize, this.ccd);
    const sweepResult = this.raceSweep.run(this.bodies, this.ccd);
    const exactContacts = this.contacts.length;
    this.raceSpatial = this.smoothRaceSample(this.raceSpatial, {
      duration: spatialResult.duration,
      candidates: spatialResult.pairs.count,
      contacts: exactContacts,
      checks: spatialResult.auxiliaryChecks,
    });
    this.raceSweepSample = this.smoothRaceSample(this.raceSweepSample, {
      duration: sweepResult.duration,
      candidates: sweepResult.pairs.count,
      contacts: exactContacts,
      checks: sweepResult.auxiliaryChecks,
    });
    this.updateMethodRaceTelemetry();
  }

  private smoothRaceSample(
    previous: MethodRaceSample | null,
    current: MethodRaceSample,
  ): MethodRaceSample {
    if (!previous) {
      return current;
    }
    const weight = 0.22;
    return {
      duration: previous.duration + (current.duration - previous.duration) * weight,
      candidates: current.candidates,
      contacts: current.contacts,
      checks: current.checks,
    };
  }

  private updateMethodRaceTelemetry(): void {
    if (!this.raceSpatial || !this.raceSweepSample) {
      this.elements.raceSpatialTime.textContent = '—';
      this.elements.raceSpatialWork.textContent = 'Waiting for a sample';
      this.elements.raceSweepTime.textContent = '—';
      this.elements.raceSweepWork.textContent = 'Waiting for a sample';
      this.elements.raceVerdict.textContent = 'Build or reshape the world, then watch both methods rerun on the same bodies.';
      return;
    }

    const spatial = this.raceSpatial;
    const sweep = this.raceSweepSample;
    this.elements.raceSpatialTime.textContent = `${this.formatDuration(spatial.duration)} ms`;
    this.elements.raceSpatialWork.textContent =
      `${spatial.candidates.toLocaleString()} candidates · ${spatial.checks.toLocaleString()} bucket checks`;
    this.elements.raceSweepTime.textContent = `${this.formatDuration(sweep.duration)} ms`;
    this.elements.raceSweepWork.textContent =
      `${sweep.candidates.toLocaleString()} candidates · ${sweep.checks.toLocaleString()} X-overlap checks`;

    const contactAgreement = spatial.contacts === sweep.contacts;
    const faster = spatial.duration <= sweep.duration ? 'Spatial hash' : 'Sweep and prune';
    const lowerWork = spatial.checks <= sweep.checks ? 'Spatial hash' : 'Sweep and prune';
    const durationGap = Math.abs(spatial.duration - sweep.duration);
    const timingRead = durationGap < 0.03
      ? 'Timing is effectively tied in this browser sample.'
      : `${faster} currently has the lower rolling broad-phase time.`;
    this.elements.raceVerdict.textContent = contactAgreement
      ? `${timingRead} ${lowerWork} performs fewer internal pair checks. Both feed the same ${spatial.contacts.toLocaleString()} exact contacts into shared narrow-phase and response math.`
      : `Correctness warning: the methods disagree on exact-contact count (${spatial.contacts.toLocaleString()} vs ${sweep.contacts.toLocaleString()}).`;
    this.elements.raceVerdict.classList.toggle('telemetry-failure', !contactAgreement);
  }

  private renderVersusPanel(
    context: CanvasRenderingContext2D,
    method: BroadPhaseMethod,
    sweep: SweepAndPrune,
    statsElement: HTMLElement,
  ): VersusPanelResult {
    const result = method === 'naive'
      ? runNaiveBroadPhase(this.bodies)
      : method === 'spatial'
        ? runSpatialHashBroadPhase(this.bodies, this.cellSize, this.ccd)
        : sweep.run(this.bodies, this.ccd);
    const midnight = this.theme === 'midnight';
    const scale = context.canvas.width / WORLD_BOUNDS.width;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = midnight ? '#09171c' : '#f5f3ed';
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    context.setTransform(scale, 0, 0, scale, 0, 0);

    // Candidate webbing over identical bodies makes each method's filter strength directly comparable.
    const lineLimit = 900;
    const step = Math.max(1, Math.ceil(result.pairs.count / lineLimit));
    context.strokeStyle = midnight ? 'rgba(240, 143, 97, 0.24)' : 'rgba(184, 75, 33, 0.22)';
    context.lineWidth = 0.6 / scale;
    context.beginPath();
    for (let index = 0; index < result.pairs.count; index += step) {
      const first = this.bodies[result.pairs.getFirst(index)];
      const second = this.bodies[result.pairs.getSecond(index)];
      context.moveTo(first.x, first.y);
      context.lineTo(second.x, second.y);
    }
    context.stroke();

    const colors = midnight
      ? ['#73d1c5', '#91b8f3', '#9be0a8']
      : ['#147f85', '#456ca8', '#3f8a58'];
    context.strokeStyle = midnight ? 'rgba(3, 12, 16, 0.82)' : 'rgba(255, 255, 255, 0.88)';
    context.lineWidth = 1 / scale;
    for (const body of this.bodies) {
      context.fillStyle = body.isStatic
        ? midnight ? '#243940' : '#d7d7cf'
        : body.contactFrames > 0
        ? midnight ? '#f08f61' : '#b84b21'
        : colors[body.colorIndex];
      context.beginPath();
      context.arc(body.x, body.y, Math.max(body.radius, 1.6), 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = body.isStatic
        ? midnight ? '#ffd166' : '#8d5d05'
        : midnight ? 'rgba(3, 12, 16, 0.82)' : 'rgba(255, 255, 255, 0.88)';
      context.stroke();
    }

    context.strokeStyle = midnight ? '#ffd0b8' : '#8f3513';
    context.lineWidth = 1.4 / scale;
    for (const contact of this.contacts) {
      context.beginPath();
      context.arc(contact.pointX, contact.pointY, 3 / scale, 0, Math.PI * 2);
      context.stroke();
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    const precision = result.pairs.count === 0
      ? 100
      : (this.contacts.length / result.pairs.count) * 100;
    statsElement.textContent =
      `${result.pairs.count.toLocaleString()} cand · ${this.contacts.length.toLocaleString()} contacts · ${precision.toFixed(1)}% useful · ${this.formatDuration(result.duration)} ms`;
    return {
      candidates: result.pairs.count,
      contacts: this.contacts.length,
      duration: result.duration,
    };
  }

  private clearVersusPanels(): void {
    for (const context of [this.versusContextA, this.versusContextB]) {
      if (!context) {
        continue;
      }
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = this.theme === 'midnight' ? '#09171c' : '#f5f3ed';
      context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    }
    this.elements.versusStatsA.textContent = 'paused';
    this.elements.versusStatsB.textContent = 'paused';
    this.elements.versusVerdict.textContent = 'Side-by-side rendering is paused.';
  }

  private syncVersusLabels(): void {
    this.elements.versusNameA.textContent = this.methodLabel(this.versusMethodA);
    this.elements.versusNameB.textContent = this.methodLabel(this.versusMethodB);
    this.elements.versusSelectA.value = this.versusMethodA;
    this.elements.versusSelectB.value = this.versusMethodB;
  }

  private methodLabel(method: BroadPhaseMethod): string {
    return method === 'naive' ? 'Brute force' : method === 'spatial' ? 'Spatial hash' : 'Sweep and prune';
  }

  private scenarioLabel(): string {
    const labels: Record<ScenarioName, string> = {
      uniform: 'uniform',
      clusters: 'dense clusters',
      horizontal: 'horizontal lanes',
      mixed: 'mixed sizes',
      giant: 'giant bodies',
      tunneling: 'high-speed crossing',
    };
    return labels[this.scenario];
  }

  private async runScaling(): Promise<void> {
    this.elements.scalingButton.disabled = true;
    this.elements.scalingStatus.textContent = 'Measuring each method across growing body counts...';
    // Yield so the disabled state and status text paint before the synchronous measurement loop runs.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));

    this.scaling = this.measureScaling();
    this.elements.scalingButton.disabled = false;

    const naive = this.scaling.find((series) => series.method === 'naive');
    const peak = naive ? naive.points[naive.points.length - 1] : null;
    this.elements.scalingStatus.textContent = peak
      ? `Brute force hit ${peak.duration.toFixed(2)} ms at ${peak.count.toLocaleString()} bodies on the ${this.scenarioLabel()} scenario.`
      : `Measured on the ${this.scenarioLabel()} scenario.`;
    this.renderScalingChart();
  }

  private resetScaling(): void {
    this.scaling = null;
    this.elements.scalingStatus.textContent = 'Plot broad-phase time against body count from 100 to 2,000.';
    this.renderScalingChart();
  }

  /**
   * Measures broad-phase cost at increasing body counts on fresh snapshots of the active scenario. Each point is the
   * fastest of several runs to suppress GC and scheduler jitter; sweep-and-prune is warmed first so it is measured in
   * its steady, temporally coherent state rather than its cold-start sort.
   */
  private measureScaling(): ScalingSeries[] {
    const runs = 4;
    const methods: BroadPhaseMethod[] = ['naive', 'spatial', 'sweep'];
    const series: ScalingSeries[] = methods.map((method) => ({ method, points: [] }));

    for (const count of SCALING_COUNTS) {
      const bodies = createBodies(count, this.scenario);
      for (const entry of series) {
        let best = Number.POSITIVE_INFINITY;
        if (entry.method === 'sweep') {
          const sweep = new SweepAndPrune();
          sweep.run(bodies);
          for (let run = 0; run < runs; run += 1) {
            best = Math.min(best, sweep.run(bodies).duration);
          }
        } else {
          for (let run = 0; run < runs; run += 1) {
            const result = entry.method === 'naive'
              ? runNaiveBroadPhase(bodies)
              : runSpatialHashBroadPhase(bodies, this.cellSize);
            best = Math.min(best, result.duration);
          }
        }
        entry.points.push({ count, duration: best });
      }
    }

    return series;
  }

  private renderScalingChart(): void {
    const context = this.scalingContext;
    if (!context) {
      return;
    }
    const midnight = this.theme === 'midnight';
    const width = context.canvas.width;
    const height = context.canvas.height;
    const padLeft = 56;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 40;
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;

    const textColor = midnight ? '#91a5a7' : '#657075';
    const axisColor = midnight ? 'rgba(145, 184, 243, 0.28)' : 'rgba(20, 40, 46, 0.22)';
    const gridColor = midnight ? 'rgba(145, 184, 243, 0.08)' : 'rgba(20, 40, 46, 0.07)';

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = midnight ? '#0d1b20' : '#faf9f5';
    context.fillRect(0, 0, width, height);

    const xMax = SCALING_COUNTS[SCALING_COUNTS.length - 1];
    let yMax = 0.01;
    if (this.scaling) {
      for (const series of this.scaling) {
        for (const point of series.points) {
          yMax = Math.max(yMax, point.duration);
        }
      }
    }
    yMax = niceCeil(yMax);

    const xOf = (count: number): number => padLeft + (count / xMax) * plotWidth;
    const yOf = (ms: number): number => padTop + plotHeight - (ms / yMax) * plotHeight;

    context.font = '10px "DM Mono", monospace';
    context.textBaseline = 'middle';
    context.textAlign = 'right';
    const yTicks = 5;
    for (let tick = 0; tick <= yTicks; tick += 1) {
      const value = (yMax / yTicks) * tick;
      const y = yOf(value);
      context.strokeStyle = gridColor;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(padLeft, y + 0.5);
      context.lineTo(width - padRight, y + 0.5);
      context.stroke();
      context.fillStyle = textColor;
      context.fillText(value.toFixed(value < 1 ? 2 : value < 10 ? 1 : 0), padLeft - 9, y);
    }

    context.textAlign = 'center';
    context.textBaseline = 'top';
    for (const count of SCALING_COUNTS) {
      context.fillStyle = textColor;
      context.fillText(count.toLocaleString(), xOf(count), height - padBottom + 9);
    }

    context.strokeStyle = axisColor;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(padLeft + 0.5, padTop);
    context.lineTo(padLeft + 0.5, padTop + plotHeight);
    context.lineTo(width - padRight, padTop + plotHeight);
    context.stroke();

    context.fillStyle = textColor;
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.fillText('Body count', padLeft + plotWidth / 2, height - 8);
    context.save();
    context.translate(15, padTop + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.fillText('Broad-phase ms', 0, 0);
    context.restore();

    if (!this.scaling) {
      context.fillStyle = textColor;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('Run "Measure scaling" to plot each method.', padLeft + plotWidth / 2, padTop + plotHeight / 2);
      return;
    }

    const colors: Record<BroadPhaseMethod, string> = {
      naive: midnight ? '#f08f61' : '#b84b21',
      spatial: midnight ? '#73d1c5' : '#147f85',
      sweep: midnight ? '#91b8f3' : '#456ca8',
    };
    for (const series of this.scaling) {
      context.strokeStyle = colors[series.method];
      context.lineWidth = 2;
      context.beginPath();
      series.points.forEach((point, index) => {
        const x = xOf(point.count);
        const y = yOf(point.duration);
        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });
      context.stroke();
      context.fillStyle = colors[series.method];
      for (const point of series.points) {
        context.beginPath();
        context.arc(xOf(point.count), yOf(point.duration), 3, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  private updatePipelineTelemetry(): void {
    const theoretical = (this.bodies.length * (this.bodies.length - 1)) / 2;
    const rejected = theoretical === 0
      ? 0
      : (1 - this.stats.candidateCount / theoretical) * 100;
    const falsePositiveRate = this.stats.candidateCount === 0
      ? 0
      : (this.stats.falsePositiveCount / this.stats.candidateCount) * 100;
    this.elements.theoreticalPairs.textContent = theoretical.toLocaleString();
    this.elements.candidateCount.textContent = this.stats.candidateCount.toLocaleString();
    this.elements.contactCount.textContent = this.stats.contactCount.toLocaleString();
    this.elements.falsePositiveCount.textContent = this.stats.falsePositiveCount.toLocaleString();
    this.elements.falsePositiveRate.textContent = `${falsePositiveRate.toFixed(1)}%`;
    this.elements.tunnelingSaves.textContent = this.ccd
      ? this.cumulativeTunnelingSaves.toLocaleString()
      : '—';
    this.elements.tunnelingSaves.classList.toggle('telemetry-pass', this.ccd && this.cumulativeTunnelingSaves > 0);
    this.elements.rejectionRate.textContent = `${Math.max(0, rejected).toFixed(1)}%`;
    this.elements.broadTime.textContent = this.formatDuration(this.stats.broadDuration);
    this.elements.narrowTime.textContent = this.formatDuration(this.stats.narrowDuration);
    this.elements.continuousTime.textContent = this.ccd
      ? `${this.formatDuration(this.stats.continuousDuration)} ms`
      : '—';
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
    this.elements.ccdStatus.className = 'canvas-mode canvas-mode--ccd';
    if (!this.ccd) {
      this.elements.ccdStatus.textContent = 'Discrete sampling';
    } else if (this.stats.tunnelingSaves > 0) {
      this.elements.ccdStatus.textContent =
        `CCD recovered ${this.stats.tunnelingSaves.toLocaleString()} crossing${this.stats.tunnelingSaves === 1 ? '' : 's'} this frame`;
      this.elements.ccdStatus.classList.add('canvas-mode--save');
    } else {
      this.elements.ccdStatus.textContent = `CCD armed · ${this.cumulativeTunnelingSaves.toLocaleString()} recovered this run`;
      this.elements.ccdStatus.classList.add('canvas-mode--active');
    }
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
      this.elements.stageRecall.textContent = '—';
      this.elements.stageMissed.textContent = '—';
      this.elements.stageRecall.classList.remove('telemetry-failure', 'telemetry-pass');
      this.elements.stageMissed.classList.remove('telemetry-failure');
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
    this.elements.stageRecall.textContent = `${this.audit.recall.toFixed(1)}%`;
    this.elements.stageMissed.textContent = this.audit.missedContacts.toLocaleString();
    this.elements.stageRecall.classList.toggle('telemetry-failure', failed);
    this.elements.stageRecall.classList.toggle('telemetry-pass', !failed);
    this.elements.stageMissed.classList.toggle('telemetry-failure', failed);
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
      tunneling: 'Fast opposing pairs travel farther than their diameter, exposing what end-of-frame sampling misses.',
    };
    const methodBest: Record<BroadPhaseMethod, string> = {
      naive: 'Tiny sets, debugging, and oracle truth.',
      spatial: 'Similar sizes with even spatial distribution.',
      sweep: 'Large dynamic sets with coherent motion and an axis that separates most bounds.',
    };
    const methodRisk: Record<BroadPhaseMethod, string> = {
      naive: 'Every added body increases quadratic pair work.',
      spatial: 'Uneven density, oversized objects, and poor cell sizing crowd buckets or duplicate inserts.',
      sweep: 'Heavy interval overlap or rapidly changing order grows the active set and can approach quadratic work.',
    };
    const expectedFit: Record<ScenarioName, string> = {
      uniform: 'Spatial hash should be a strong fit; sweep also benefits from coherence.',
      clusters: 'Expect more real local work. Compare checks, not candidate count alone.',
      horizontal: 'Sweep should benefit from stable X order and a selective Y test.',
      mixed: 'Sweep avoids choosing one cell size for incompatible radii.',
      giant: 'Sweep avoids the hash duplication caused by giant multi-cell bodies.',
      tunneling: 'CCD is the deciding feature; the broad phase must use swept bounds first.',
    };
    this.elements.lessonBest.textContent = methodBest[this.method];
    this.elements.lessonRisk.textContent = methodRisk[this.method];
    const customCount = this.bodies.reduce(
      (count, body) => count + (body.isUserCreated ? 1 : 0),
      0,
    );
    this.elements.lessonVerdict.textContent = customCount > 0
      ? `You reshaped this workload with ${customCount.toLocaleString()} custom bodies. Use the live method race to judge the distribution you actually built; the selected filter rejects ${(100 - candidateRatio).toFixed(1)}% of theoretical pairs.`
      : `${expectedFit[this.scenario]} Current filter rejects ${(100 - candidateRatio).toFixed(1)}% of theoretical pairs.`;

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
      const checksPerBody = this.bodies.length === 0
        ? 0
        : this.stats.auxiliaryChecks / this.bodies.length;
      if (!this.stats.usedFullSort) {
        this.updateSweepInsightState(swapsPerBody, checksPerBody);
      }
      const titles: Record<SweepInsightState, string> = {
        coherent: 'Ordering is stable; sweep repair is cheap.',
        overlap: 'Broad interval overlap is growing the active set.',
        churn: 'Motion is forcing more ordering repair.',
      };
      const explanations: Record<SweepInsightState, string> = {
        coherent: 'Temporal coherence is the core advantage: most bounds stay near their previous sorted position.',
        overlap: 'Sweep loses efficiency when many projected bounds overlap, because the active set must compare more possible pairs even when final contacts stay sparse.',
        churn: 'Large jumps, teleports, or chaotic motion weaken temporal coherence and increase the work needed to restore sorted order.',
      };
      this.elements.insightTitle.textContent = titles[this.sweepInsightState];
      this.elements.insightBody.textContent =
        `${explanations[this.sweepInsightState]} ${scenarioLesson[this.scenario]} Demo note: this implementation sorts X and applies Y as a secondary AABB filter.`;
      this.elements.insightPrimaryLabel.textContent = 'Rolling order repairs / body';
      this.elements.insightPrimaryValue.textContent = this.smoothedSweepSwapsPerBody.toFixed(2);
      this.elements.insightSecondaryLabel.textContent = 'Rolling X overlaps / body';
      this.elements.insightSecondaryValue.textContent = this.smoothedSweepChecksPerBody.toFixed(1);
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

  private updateSweepInsightState(swapsPerBody: number, checksPerBody: number): void {
    if (!this.sweepInsightInitialized) {
      this.smoothedSweepSwapsPerBody = swapsPerBody;
      this.smoothedSweepChecksPerBody = checksPerBody;
      this.sweepInsightInitialized = true;
    } else {
      const weight = 0.08;
      this.smoothedSweepSwapsPerBody +=
        (swapsPerBody - this.smoothedSweepSwapsPerBody) * weight;
      this.smoothedSweepChecksPerBody +=
        (checksPerBody - this.smoothedSweepChecksPerBody) * weight;
    }

    let nextState: SweepInsightState = 'coherent';
    if (this.smoothedSweepChecksPerBody > 14) {
      nextState = 'overlap';
    } else if (this.smoothedSweepSwapsPerBody > 0.85) {
      nextState = 'churn';
    }
    if (nextState === this.sweepInsightState) {
      this.pendingSweepInsightState = nextState;
      this.pendingSweepInsightFrames = 0;
      return;
    }
    if (nextState !== this.pendingSweepInsightState) {
      this.pendingSweepInsightState = nextState;
      this.pendingSweepInsightFrames = 1;
      return;
    }
    this.pendingSweepInsightFrames += 1;
    if (this.pendingSweepInsightFrames >= INSIGHT_STABILITY_FRAMES) {
      this.sweepInsightState = nextState;
      this.pendingSweepInsightFrames = 0;
    }
  }

  private resetInsightSmoothing(): void {
    this.smoothedSweepSwapsPerBody = 0;
    this.smoothedSweepChecksPerBody = 0;
    this.sweepInsightInitialized = false;
    this.sweepInsightState = 'coherent';
    this.pendingSweepInsightState = 'coherent';
    this.pendingSweepInsightFrames = 0;
  }

  private syncInteractionControls(): void {
    if (!this.elements) {
      return;
    }
    this.elements.toolButtons.forEach((button) => {
      const active = button.dataset.tool === this.interactionTool;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    this.elements.brushSlider.value = String(this.brushRadius);
    this.elements.brushValue.textContent = `${this.brushRadius} px`;
    const customCount = this.bodies.reduce(
      (count, body) => count + (body.isUserCreated ? 1 : 0),
      0,
    );
    const staticCount = this.bodies.reduce(
      (count, body) => count + (body.isUserCreated && body.isStatic ? 1 : 0),
      0,
    );
    this.elements.customBodyCount.textContent =
      `${customCount.toLocaleString()} custom · ${staticCount.toLocaleString()} static`;
    this.elements.clearCustomButton.disabled = customCount === 0;
    const hints: Record<InteractionTool, string> = {
      launch: 'Drag from the spawn point toward the direction of travel. A click drops a moving body.',
      spray: 'Drag to inject compact moving clusters and increase local density quickly.',
      wall: 'Drag to paint fixed circles into walls, funnels, pockets, or narrow channels.',
      erase: 'Drag across the canvas to remove both generated and custom bodies.',
    };
    this.elements.interactionHint.textContent = hints[this.interactionTool];
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
    this.elements.ccdToggle.checked = this.ccd;
    this.elements.pairsToggle.checked = this.showPairs;
    this.elements.contactsToggle.checked = this.showContacts;
    this.elements.trailsToggle.checked = this.showTrails;
    this.elements.gridToggle.checked = this.showGrid;
    this.elements.cellSlider.disabled = this.method !== 'spatial';
    this.elements.gridToggle.disabled = this.method !== 'spatial';
    this.elements.stressButton.disabled = this.bodies.length >= MAX_BODY_COUNT;
    this.syncInteractionControls();
    this.elements.methodDescription.textContent = this.method === 'naive'
      ? 'Every unique body pair advances to the exact circle test. Correct, simple, and quadratic.'
      : this.method === 'spatial'
        ? 'Bodies enter every grid cell touched by their AABB. Cell size trades occupancy against duplication.'
        : 'Sweep and prune reuses sorted interval order, then scans only overlapping bounds. Demo note: this implementation sorts X and applies Y as a secondary AABB filter.';
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
      ccdChallengeButton: this.getElement<HTMLButtonElement>('#ccd-challenge'),
      compareButton: this.getElement<HTMLButtonElement>('#run-comparison'),
      auditButton: this.getElement<HTMLButtonElement>('#run-audit'),
      pauseToggle: this.getElement<HTMLInputElement>('#pause-sim'),
      responseToggle: this.getElement<HTMLInputElement>('#resolve-response'),
      ccdToggle: this.getElement<HTMLInputElement>('#resolve-ccd'),
      pairsToggle: this.getElement<HTMLInputElement>('#show-pairs'),
      contactsToggle: this.getElement<HTMLInputElement>('#show-contacts'),
      trailsToggle: this.getElement<HTMLInputElement>('#show-trails'),
      gridToggle: this.getElement<HTMLInputElement>('#show-grid'),
      toolButtons: this.root.querySelectorAll<HTMLButtonElement>('[data-tool]'),
      brushSlider: this.getElement<HTMLInputElement>('#brush-size'),
      brushValue: this.getElement<HTMLElement>('#brush-value'),
      clearCustomButton: this.getElement<HTMLButtonElement>('#clear-custom'),
      customBodyCount: this.getElement<HTMLElement>('#custom-body-count'),
      interactionHint: this.getElement<HTMLElement>('#interaction-hint'),
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
      candidateVisibility: this.getElement<HTMLElement>('#candidate-visibility'),
      ccdStatus: this.getElement<HTMLElement>('#ccd-status'),
      falsePositiveCount: this.getElement<HTMLElement>('#false-positive-count'),
      falsePositiveRate: this.getElement<HTMLElement>('#false-positive-rate'),
      tunnelingSaves: this.getElement<HTMLElement>('#tunneling-saves'),
      stageRecall: this.getElement<HTMLElement>('#stage-recall'),
      stageMissed: this.getElement<HTMLElement>('#stage-missed'),
      rejectionRate: this.getElement<HTMLElement>('#rejection-rate'),
      broadTime: this.getElement<HTMLElement>('#broad-time'),
      narrowTime: this.getElement<HTMLElement>('#narrow-time'),
      continuousTime: this.getElement<HTMLElement>('#continuous-time'),
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
      lessonBest: this.getElement<HTMLElement>('#lesson-best'),
      lessonRisk: this.getElement<HTMLElement>('#lesson-risk'),
      lessonVerdict: this.getElement<HTMLElement>('#lesson-verdict'),
      raceSpatialTime: this.getElement<HTMLElement>('#race-spatial-time'),
      raceSpatialWork: this.getElement<HTMLElement>('#race-spatial-work'),
      raceSweepTime: this.getElement<HTMLElement>('#race-sweep-time'),
      raceSweepWork: this.getElement<HTMLElement>('#race-sweep-work'),
      raceVerdict: this.getElement<HTMLElement>('#race-verdict'),
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
      versusActiveToggle: this.getElement<HTMLInputElement>('#versus-active'),
      versusSelectA: this.getElement<HTMLSelectElement>('#versus-a'),
      versusSelectB: this.getElement<HTMLSelectElement>('#versus-b'),
      versusCanvasA: this.getElement<HTMLCanvasElement>('#versus-canvas-a'),
      versusCanvasB: this.getElement<HTMLCanvasElement>('#versus-canvas-b'),
      versusNameA: this.getElement<HTMLElement>('#versus-a-name'),
      versusNameB: this.getElement<HTMLElement>('#versus-b-name'),
      versusStatsA: this.getElement<HTMLElement>('#versus-a-stats'),
      versusStatsB: this.getElement<HTMLElement>('#versus-b-stats'),
      versusVerdict: this.getElement<HTMLElement>('#versus-verdict'),
      scalingButton: this.getElement<HTMLButtonElement>('#run-scaling'),
      scalingStatus: this.getElement<HTMLElement>('#scaling-status'),
      scalingCanvas: this.getElement<HTMLCanvasElement>('#scaling-canvas'),
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
                <button class="button button--quiet" id="ccd-challenge" type="button">Run CCD challenge</button>
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

            <section class="lesson-strip" aria-label="How to interpret the selected method">
              <div><span>Wins when</span><strong id="lesson-best">—</strong></div>
              <div><span>Loses when</span><strong id="lesson-risk">—</strong></div>
              <div class="lesson-strip__verdict"><span>Read this frame</span><strong id="lesson-verdict">—</strong></div>
            </section>

            <section class="play-lab" aria-label="Interactive workload builder">
              <div class="play-tools">
                <div class="play-tools__header">
                  <div><div class="panel__kicker">Build the workload</div><h3>Shape the simulation directly</h3></div>
                  <strong id="custom-body-count">0 custom · 0 static</strong>
                </div>
                <div class="tool-switch" aria-label="Canvas interaction tool">
                  <button class="is-active" data-tool="launch" type="button">Launch</button>
                  <button data-tool="spray" type="button">Dynamic spray</button>
                  <button data-tool="wall" type="button">Static wall</button>
                  <button data-tool="erase" type="button">Erase</button>
                </div>
                <div class="play-tools__settings">
                  <label><span>Body / brush size</span><output id="brush-value">12 px</output><input id="brush-size" type="range" min="4" max="42" step="1" value="12" /></label>
                  <button class="button button--quiet" id="clear-custom" type="button" disabled>Clear custom</button>
                </div>
                <p id="interaction-hint">Drag from the spawn point toward the direction of travel. A click drops a moving body.</p>
              </div>
              <div class="method-race">
                <div class="method-race__header"><div><div class="panel__kicker">Live method race</div><h3>Same world, rolling broad-phase cost</h3></div><span>Updates at 5 Hz</span></div>
                <div class="method-race__cards">
                  <article><span>Spatial hash</span><strong id="race-spatial-time">—</strong><small id="race-spatial-work">Waiting for a sample</small></article>
                  <article><span>Sweep and prune</span><strong id="race-sweep-time">—</strong><small id="race-sweep-work">Waiting for a sample</small></article>
                </div>
                <p id="race-verdict">Build or reshape the world, then watch both methods rerun on the same bodies.</p>
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
              <div class="canvas-mode" id="candidate-visibility">Candidate overlay off</div>
              <div class="canvas-mode canvas-mode--ccd" id="ccd-status">Discrete sampling</div>
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
                <label class="range-row"><span><b>Body count</b><small>Set zero to build a workload entirely by hand</small></span><output id="body-value">850</output><input id="body-slider" type="range" min="0" max="${MAX_BODY_COUNT}" step="10" value="${DEFAULT_BODY_COUNT}" /></label>
                <label class="range-row"><span><b>Motion speed</b><small>Higher movement reduces sweep coherence</small></span><output id="speed-value">1.0x</output><input id="speed-slider" type="range" min="0.2" max="2.5" step="0.1" value="1" /></label>
                <label class="select-row"><span><b>Scenario</b><small>Each distribution stresses methods differently</small></span><select id="scenario-select"><option value="uniform">Uniform small bodies</option><option value="clusters">Dense clusters</option><option value="horizontal">Horizontal lanes</option><option value="mixed">Mixed body sizes</option><option value="giant">Giant bodies</option><option value="tunneling">High-speed CCD crossing</option></select></label>
                <label class="range-row"><span><b>Restitution</b><small>Energy retained by resolved impacts</small></span><output id="restitution-value">0.72</output><input id="restitution-slider" type="range" min="0" max="1" step="0.02" value="0.72" /></label>
                <label class="range-row"><span><b>Hash cell size</b><small>Occupancy versus multi-cell duplication</small></span><output id="cell-value">32 px</output><input id="cell-slider" type="range" min="16" max="128" step="8" value="${DEFAULT_CELL_SIZE}" /></label>
              </div>
              <div class="scope-note"><b>CCD challenge</b> The high-speed preset makes opposing circles travel farther than their diameter per frame. Toggle CCD to compare end-position sampling with swept time of impact.</div>
            </section>

            <section class="panel">
              <div class="panel__header"><div><div class="panel__kicker">Pipeline cost</div><h3>Measured stages</h3></div></div>
              <div class="metric-group">
                <div class="metric-group__label"><span class="metric-group__dot metric-group__dot--correct"></span>Correctness · is the contract upheld?</div>
                <dl class="stats-grid">
                  <dt>Contact recall</dt><dd id="stage-recall">—</dd>
                  <dt>Missed contacts</dt><dd id="stage-missed">—</dd>
                  <dt>False positives</dt><dd id="false-positive-count">0</dd>
                  <dt>False-positive rate</dt><dd id="false-positive-rate">0.0%</dd>
                  <dt>CCD saves this run</dt><dd id="tunneling-saves">—</dd>
                </dl>
              </div>
              <div class="metric-group">
                <div class="metric-group__label"><span class="metric-group__dot metric-group__dot--perf"></span>Performance · what does it cost?</div>
                <dl class="stats-grid">
                  <dt>Broad phase</dt><dd><span id="broad-time">0.00</span> ms</dd>
                  <dt>Narrow phase</dt><dd><span id="narrow-time">0.00</span> ms</dd>
                  <dt>Continuous test</dt><dd id="continuous-time">—</dd>
                  <dt>Response</dt><dd><span id="response-time">0.00</span> ms</dd>
                  <dt>Pairs rejected</dt><dd id="rejection-rate">0.0%</dd>
                  <dt>Broad pair checks</dt><dd id="auxiliary-checks">0</dd>
                  <dt>Sweep order swaps</dt><dd id="ordering-swaps">—</dd>
                  <dt>Hash cell entries</dt><dd id="bucket-entries">—</dd>
                  <dt>Hash buckets</dt><dd id="bucket-count">0</dd>
                  <dt>Max bucket</dt><dd id="max-bucket-size">0</dd>
                </dl>
              </div>
            </section>

          </aside>
        </section>

        <section class="inspect-bar">
          <div class="inspect-bar__intro">
            <div class="panel__kicker">Inspect</div>
            <h3>Debug and response</h3>
          </div>
          <div class="inspect-bar__controls">
            <label class="toggle"><span><b>Resolve contacts</b><small>Correction and impulses</small></span><span class="switch"><input id="resolve-response" type="checkbox" checked /><i></i></span></label>
            <label class="toggle"><span><b>Continuous (CCD)</b><small>Swept tunneling test</small></span><span class="switch"><input id="resolve-ccd" type="checkbox" /><i></i></span></label>
            <label class="toggle"><span><b>Candidate lines</b><small>Sample broad pairs</small></span><span class="switch"><input id="show-pairs" type="checkbox" /><i></i></span></label>
            <label class="toggle"><span><b>Contact normals</b><small>Exact contact result</small></span><span class="switch"><input id="show-contacts" type="checkbox" checked /><i></i></span></label>
            <label class="toggle"><span><b>Motion ticks</b><small>Per-frame trails</small></span><span class="switch"><input id="show-trails" type="checkbox" checked /><i></i></span></label>
            <label class="toggle"><span><b>Spatial grid</b><small>Hash mode only</small></span><span class="switch"><input id="show-grid" type="checkbox" checked /><i></i></span></label>
            <label class="toggle"><span><b>Pause simulation</b><small>Hold this snapshot</small></span><span class="switch"><input id="pause-sim" type="checkbox" /><i></i></span></label>
          </div>
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

        <section class="scaling">
          <div class="scaling__intro">
            <div class="eyebrow">Scaling behavior</div>
            <h2>Quadratic shows its shape.</h2>
            <p>Measure broad-phase cost across growing body counts on fresh snapshots of the current scenario. Brute force traces an n² curve while the partitioned methods stay far flatter.</p>
            <div class="scaling__legend">
              <span class="legend-chip legend-chip--naive">Brute force</span>
              <span class="legend-chip legend-chip--spatial">Spatial hash</span>
              <span class="legend-chip legend-chip--sweep">Sweep and prune</span>
            </div>
            <p id="scaling-status" class="scaling-status">Plot broad-phase time against body count from 100 to 2,000.</p>
            <button class="button button--primary" id="run-scaling" type="button">Measure scaling</button>
          </div>
          <div class="scaling__chart">
            <canvas id="scaling-canvas" width="760" height="360" aria-label="Broad-phase duration versus body count"></canvas>
          </div>
        </section>

        <section class="versus">
          <div class="versus__intro">
            <div class="eyebrow">Side-by-side</div>
            <h2>Same frame, two strategies.</h2>
            <p>Both panels animate the identical live simulation. Watch the chosen broad phases propose different candidate sets from exactly the same bodies, frame after frame.</p>
            <div class="versus__controls">
              <label class="select-inline"><span>Left</span><select id="versus-a"><option value="naive">Brute force</option><option value="spatial" selected>Spatial hash</option><option value="sweep">Sweep and prune</option></select></label>
              <label class="select-inline"><span>Right</span><select id="versus-b"><option value="naive">Brute force</option><option value="spatial">Spatial hash</option><option value="sweep" selected>Sweep and prune</option></select></label>
              <label class="toggle toggle--inline"><span><b>Animate</b><small>Runs two extra broad phases each frame</small></span><span class="switch"><input id="versus-active" type="checkbox" /><i></i></span></label>
            </div>
            <p class="versus-note" id="versus-verdict">Candidate lines are sampled over identical bodies; the live verdict compares how many pairs each method forwards.</p>
          </div>
          <div class="versus__stage">
            <figure class="versus__panel">
              <div class="versus__tag versus__tag--a"><span id="versus-a-name">Spatial hash</span><b id="versus-a-stats">—</b></div>
              <canvas id="versus-canvas-a" width="480" height="300" aria-label="Left broad-phase comparison"></canvas>
            </figure>
            <figure class="versus__panel">
              <div class="versus__tag versus__tag--b"><span id="versus-b-name">Sweep and prune</span><b id="versus-b-stats">—</b></div>
              <canvas id="versus-canvas-b" width="480" height="300" aria-label="Right broad-phase comparison"></canvas>
            </figure>
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
          <article><span>Sweep and prune</span><h3>Coherence and separation matter</h3><p>Strong when bounds stay ordered and projections reject most pairs. It loses when interval overlap or rapid reordering grows work toward quadratic behavior.<small>Demo note: X is sorted; Y is a secondary AABB filter.</small></p></article>
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
              <li>Discrete mode can tunnel; optional CCD widens broad-phase bounds, orders impacts by time, and resolves the earliest crossing per body.</li>
            </ul>
          </div>
          <div class="dialog__actions"><button class="button" id="close-dialog" type="button">Close</button></div>
        </dialog>
      </main>
    `;
  }
}

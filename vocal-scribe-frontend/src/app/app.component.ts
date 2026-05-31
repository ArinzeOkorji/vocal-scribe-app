import { Component, ElementRef, ViewChild, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AudioProcessorService } from './audio-processor.service';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import Soundfont from 'soundfont-player';

type SoundfontPlayer = Awaited<ReturnType<typeof Soundfont.instrument>>;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="container py-5">
      <header class="text-center mb-5">
        <h1 class="display-4 fw-bold text-dark">VocalScribe Studio</h1>
        <p class="lead text-muted">Hum your melody, generate your professional orchestration score sheet.</p>
      </header>

      <!-- Recording Controls -->
      <div class="card shadow-sm border-0 bg-light p-4 mb-4">
        <div class="row g-3 align-items-center justify-content-center">
          <div class="col-md-4 col-sm-12">
            <select [(ngModel)]="selectedStyle" [disabled]="isRecording || isProcessing" class="form-select form-select-lg">
              <option value="Standard Classical Lead Sheet">Standard Lead Sheet</option>
              <option value="Chopin Romantic Piano Accompaniment">Chopin Piano Sonata</option>
              <option value="Miles Davis Jazz Comping Quintet">Modern Jazz Quintet</option>
            </select>
          </div>

          <div class="col-md-auto col-sm-12 text-center">
            <button *ngIf="!isRecording" (click)="startRecording()" [disabled]="isProcessing" class="btn btn-danger btn-lg px-4 fw-semibold">
              🔴 Record Melody
            </button>
            <button *ngIf="isRecording" (click)="stopRecording()" class="btn btn-dark btn-lg px-4 fw-semibold">
              ⏹ Stop &amp; Process
            </button>
          </div>
        </div>

        <!-- Error / Rate-limit Banner -->
        <div *ngIf="errorMessage" class="alert alert-warning mt-3 mb-0 d-flex align-items-center gap-2" role="alert">
          <span>⚠️ {{ errorMessage }}</span>
          <span *ngIf="rateLimitCountdown > 0" class="badge bg-warning text-dark ms-auto">Retry in {{ rateLimitCountdown }}s</span>
        </div>

        <!-- Processing Progress Bars -->
        <div *ngIf="isProcessing" class="row mt-3">
          <div class="col text-center">
            <div *ngIf="!isCallingApi">
              <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
              <span class="text-secondary fw-medium">Processing local audio parameters: {{ processingProgress }}%</span>
              <div class="progress mt-2" style="height: 8px;">
                <div class="progress-bar progress-bar-striped progress-bar-animated bg-primary"
                     role="progressbar"
                     [style.width.%]="processingProgress"
                     [attr.aria-valuenow]="processingProgress"
                     aria-valuemin="0"
                     aria-valuemax="100">
                </div>
              </div>
            </div>
            <div *ngIf="isCallingApi">
              <div class="spinner-border spinner-border-sm text-success me-2" role="status"></div>
              <span class="text-success fw-medium">Generating score sheets with AI (Gemini)...</span>
              <div class="progress mt-2" style="height: 8px;">
                <div class="progress-bar progress-bar-striped progress-bar-animated bg-success"
                     role="progressbar"
                     style="width: 100%"
                     aria-valuenow="100"
                     aria-valuemin="0"
                     aria-valuemax="100">
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Your Recording Playback -->
      <div *ngIf="recordingUrl" class="card shadow-sm border-0 p-3 mb-3">
        <div class="d-flex align-items-center gap-3 flex-wrap">
          <span class="fw-semibold text-secondary">🎙️ Your Recording</span>
          <audio #audioPlayback [src]="recordingUrl" controls class="flex-grow-1" style="height:36px; min-width:200px;"></audio>
          <span class="badge bg-light text-secondary border">{{ recordingDuration }}</span>
        </div>
      </div>

      <!-- Sheet Music Canvas -->
      <div class="card shadow-sm border-0 p-4 mb-3">
        <div *ngIf="!hasNotes && !isProcessing" class="text-center text-muted py-5">
          <p class="fs-5">🎵 Your score will appear here after recording.</p>
        </div>
        <div #sheetCanvas class="w-100 bg-white style-sheet-output" [style.display]="hasNotes ? 'block' : 'none'" style="min-height: 300px;"></div>
      </div>

      <!-- Score Playback Bar -->
      <div *ngIf="hasNotes" class="card shadow border-0 p-3">
        <div class="d-flex align-items-center gap-3 flex-wrap">

          <!-- Instrument Selector -->
          <div class="d-flex gap-2">
            <button
              id="btn-piano"
              (click)="selectInstrument('acoustic_grand_piano')"
              [class.active]="selectedInstrument === 'acoustic_grand_piano'"
              class="btn btn-outline-secondary instrument-btn"
              [disabled]="isPlaying"
              title="Piano">
              🎹 Piano
            </button>
            <button
              id="btn-guitar"
              (click)="selectInstrument('acoustic_guitar_nylon')"
              [class.active]="selectedInstrument === 'acoustic_guitar_nylon'"
              class="btn btn-outline-secondary instrument-btn"
              [disabled]="isPlaying"
              title="Guitar">
              🎸 Guitar
            </button>
          </div>

          <!-- Play / Stop -->
          <button
            id="btn-play"
            (click)="togglePlayback()"
            [disabled]="isLoadingInstrument"
            class="btn btn-primary btn-playback px-4 fw-semibold">
            <span *ngIf="isLoadingInstrument">
              <span class="spinner-border spinner-border-sm me-1" role="status"></span> Loading…
            </span>
            <span *ngIf="!isLoadingInstrument && !isPlaying">▶ Play Score</span>
            <span *ngIf="!isLoadingInstrument && isPlaying">⏹ Stop</span>
          </button>

          <!-- Note count badge -->
          <span class="badge bg-light text-secondary border">{{ scoreNoteCount }} notes in score</span>

          <!-- Duration label -->
          <span class="text-muted small ms-auto">
            {{ playbackPosition | number:'1.1-1' }}s / {{ totalDuration | number:'1.1-1' }}s
          </span>

          <!-- Playback progress bar -->
          <div class="progress flex-grow-1" style="height: 8px; min-width: 120px;">
            <div class="progress-bar bg-primary"
                 role="progressbar"
                 [style.width.%]="playbackPercent"
                 [attr.aria-valuenow]="playbackPercent"
                 aria-valuemin="0"
                 aria-valuemax="100">
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .instrument-btn { border-radius: 20px; font-size: 0.85rem; padding: 0.3rem 0.9rem; }
    .instrument-btn.active { background-color: #0d6efd; color: #fff; border-color: #0d6efd; }
    .btn-playback { border-radius: 20px; min-width: 130px; }
    audio { border-radius: 8px; outline: none; }
  `]
})
export class AppComponent implements OnDestroy {
  @ViewChild('sheetCanvas', { static: true }) sheetCanvas!: ElementRef;

  selectedStyle = 'Standard Classical Lead Sheet';
  isRecording = false;
  isProcessing = false;
  processingProgress = 0;
  isCallingApi = false;
  errorMessage = '';
  rateLimitCountdown = 0;

  // Raw recording
  recordingUrl: string | null = null;
  recordingDuration = '';
  private recordingStartTime = 0;

  // Playback state
  hasNotes = false;
  isPlaying = false;
  isLoadingInstrument = false;
  selectedInstrument: 'acoustic_grand_piano' | 'acoustic_guitar_nylon' = 'acoustic_grand_piano';
  playbackPosition = 0;
  totalDuration = 0;
  playbackPercent = 0;
  scoreNoteCount = 0;

  private mediaRecorder?: MediaRecorder;
  private audioChunks: Blob[] = [];
  private osmdRenderer?: OpenSheetMusicDisplay;

  // Soundfont playback internals
  private playbackAudioContext?: AudioContext;
  private sfPlayer?: SoundfontPlayer;
  private loadedInstrumentName = '';
  private playbackStartTime = 0;
  private playbackTimers: ReturnType<typeof setTimeout>[] = [];
  private progressInterval?: ReturnType<typeof setInterval>;
  private scheduledNodes: { stop: (when?: number) => void }[] = [];
  private rateLimitTimer?: ReturnType<typeof setInterval>;
  private prevRecordingUrl: string | null = null;

  constructor(private processor: AudioProcessorService, private cdr: ChangeDetectorRef) { }

  ngOnDestroy() {
    this.stopPlayback();
    this.clearRateLimitTimer();
    this.revokeRecordingUrl();
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  async startRecording() {
    this.audioChunks = [];
    this.recordingStartTime = Date.now();
    this.revokeRecordingUrl();
    this.recordingUrl = null;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(stream);

    this.mediaRecorder.ondataavailable = (event) => this.audioChunks.push(event.data);
    this.mediaRecorder.onstop = async () => {
      // Stop all mic tracks
      stream.getTracks().forEach(t => t.stop());
      await this.handleAudioProcessing();
    };

    this.mediaRecorder.start();
    this.isRecording = true;
  }

  stopRecording() {
    if (this.mediaRecorder?.state === 'recording') {
      const durationMs = Date.now() - this.recordingStartTime;
      const secs = Math.floor(durationMs / 1000);
      const mins = Math.floor(secs / 60);
      this.recordingDuration = `${mins}:${String(secs % 60).padStart(2, '0')}`;
      this.mediaRecorder.stop();
    }
    this.isRecording = false;
  }

  private async handleAudioProcessing() {
    this.isProcessing = true;
    this.isCallingApi = false;
    this.processingProgress = 0;
    this.hasNotes = false;
    this.errorMessage = '';
    this.stopPlayback();
    this.clearRateLimitTimer();

    try {
      const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });

      // Create a playable URL for the raw recording immediately
      this.recordingUrl = URL.createObjectURL(audioBlob);
      this.cdr.detectChanges();

      const xmlResult = await this.processor.processAudioAndCompose(
        audioBlob,
        this.selectedStyle,
        (pct) => {
          this.processingProgress = pct;
          this.cdr.detectChanges();
        },
        () => {
          this.isCallingApi = true;
          this.cdr.detectChanges();
        }
      );

      // Use score notes (parsed from MusicXML) for accurate playback
      const scoreNotes = this.processor.lastScoreNotes;
      console.log('Score notes for playback:', scoreNotes);

      if (scoreNotes.length > 0) {
        const last = scoreNotes[scoreNotes.length - 1];
        this.totalDuration = last.startTimeSeconds + last.durationSeconds;
        this.scoreNoteCount = scoreNotes.length;
        this.hasNotes = true;
        this.playbackPosition = 0;
        this.playbackPercent = 0;
        // Pre-load the instrument in the background
        this.ensureInstrumentLoaded();
      } else if (this.processor.lastProcessedNotes.length > 0) {
        // Fallback: XML parse yielded nothing, use BasicPitch notes
        const bpNotes = this.processor.lastProcessedNotes;
        const last = bpNotes[bpNotes.length - 1];
        this.totalDuration = last.startTimeSeconds + last.durationSeconds;
        this.scoreNoteCount = bpNotes.length;
        this.hasNotes = true;
        this.ensureInstrumentLoaded();
      }

      await this.renderSheetMusic(xmlResult);
    } catch (err: any) {
      console.error('Execution Pipeline Failed', err);

      const body = err instanceof HttpErrorResponse ? err.error : err;
      const status = err instanceof HttpErrorResponse ? err.status : (err?.status ?? 0);

      if (status === 429) {
        const retryAfter: number = body?.retryAfterSeconds ?? 10;
        this.errorMessage = body?.error ?? 'Gemini rate limit reached. Please wait before retrying.';
        this.rateLimitCountdown = retryAfter;
        this.rateLimitTimer = setInterval(() => {
          this.rateLimitCountdown--;
          if (this.rateLimitCountdown <= 0) {
            this.clearRateLimitTimer();
            this.errorMessage = 'Ready to record again!';
          }
          this.cdr.detectChanges();
        }, 1000);
      } else {
        this.errorMessage = 'Something went wrong. Please try again.';
      }
    } finally {
      this.isProcessing = false;
      this.isCallingApi = false;
      this.cdr.detectChanges();
    }
  }

  // ── Instrument Loading ─────────────────────────────────────────────────────

  selectInstrument(name: 'acoustic_grand_piano' | 'acoustic_guitar_nylon') {
    this.selectedInstrument = name;
    this.sfPlayer = undefined; // force reload on next play
  }

  private async ensureInstrumentLoaded(): Promise<void> {
    if (this.sfPlayer && this.loadedInstrumentName === this.selectedInstrument) return;

    this.isLoadingInstrument = true;
    this.cdr.detectChanges();

    if (!this.playbackAudioContext || this.playbackAudioContext.state === 'closed') {
      this.playbackAudioContext = new AudioContext();
    }

    try {
      this.sfPlayer = await Soundfont.instrument(
        this.playbackAudioContext,
        this.selectedInstrument as any,
        { soundfont: 'MusyngKite' }
      );
      this.loadedInstrumentName = this.selectedInstrument;
    } catch (e) {
      console.error('Failed to load soundfont instrument:', e);
    } finally {
      this.isLoadingInstrument = false;
      this.cdr.detectChanges();
    }
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  async togglePlayback() {
    if (this.isPlaying) {
      this.stopPlayback();
    } else {
      await this.startPlayback();
    }
  }

  private async startPlayback() {
    await this.ensureInstrumentLoaded();
    if (!this.sfPlayer || !this.playbackAudioContext) return;

    if (this.playbackAudioContext.state === 'suspended') {
      await this.playbackAudioContext.resume();
    }

    // Prefer score notes (match what's on sheet), fall back to BasicPitch notes
    const notes = this.processor.lastScoreNotes.length > 0
      ? this.processor.lastScoreNotes
      : this.processor.lastProcessedNotes;

    if (notes.length === 0) return;

    this.isPlaying = true;
    this.playbackStartTime = this.playbackAudioContext.currentTime;
    this.scheduledNodes = [];

    for (const note of notes) {
      const node = this.sfPlayer.play(
        note.pitchMidi.toString(),
        this.playbackAudioContext.currentTime + note.startTimeSeconds,
        { duration: note.durationSeconds, gain: 1.2 }
      );
      if (node) this.scheduledNodes.push(node as any);
    }

    // Auto-stop at end of score
    const stopTimer = setTimeout(() => {
      this.stopPlayback();
      this.cdr.detectChanges();
    }, (this.totalDuration + 0.5) * 1000);
    this.playbackTimers.push(stopTimer);

    // Progress update interval
    this.progressInterval = setInterval(() => {
      if (!this.isPlaying || !this.playbackAudioContext) return;
      const elapsed = this.playbackAudioContext.currentTime - this.playbackStartTime;
      this.playbackPosition = Math.min(elapsed, this.totalDuration);
      this.playbackPercent = this.totalDuration > 0 ? (this.playbackPosition / this.totalDuration) * 100 : 0;
      this.cdr.detectChanges();
    }, 100);

    this.cdr.detectChanges();
  }

  private stopPlayback() {
    this.isPlaying = false;
    for (const node of this.scheduledNodes) {
      try { node.stop(0); } catch (_) { }
    }
    this.scheduledNodes = [];
    for (const t of this.playbackTimers) clearTimeout(t);
    this.playbackTimers = [];
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = undefined;
    }
    this.playbackPosition = 0;
    this.playbackPercent = 0;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private clearRateLimitTimer() {
    if (this.rateLimitTimer) {
      clearInterval(this.rateLimitTimer);
      this.rateLimitTimer = undefined;
    }
    this.rateLimitCountdown = 0;
  }

  private revokeRecordingUrl() {
    if (this.prevRecordingUrl) {
      URL.revokeObjectURL(this.prevRecordingUrl);
    }
    this.prevRecordingUrl = this.recordingUrl;
  }

  // ── Sheet Music Rendering ─────────────────────────────────────────────────

  private async renderSheetMusic(xmlString: string) {
    let cleanXml = xmlString.trim();

    if (cleanXml.startsWith('```')) {
      const firstNewline = cleanXml.indexOf('\n');
      if (firstNewline !== -1) cleanXml = cleanXml.substring(firstNewline + 1).trim();
      if (cleanXml.endsWith('```')) cleanXml = cleanXml.substring(0, cleanXml.length - 3).trim();
    }

    if (!cleanXml.startsWith('<?xml')) {
      cleanXml = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + cleanXml;
    }

    try {
      if (!this.osmdRenderer) {
        this.osmdRenderer = new OpenSheetMusicDisplay(this.sheetCanvas.nativeElement, {
          autoResize: true,
          backend: 'svg',
          drawingParameters: 'default'
        });
      }
      await this.osmdRenderer.load(cleanXml);
      this.osmdRenderer.render();
    } catch (err) {
      console.error('OSMD Loading/Rendering Failed:', err);
    }
  }
}

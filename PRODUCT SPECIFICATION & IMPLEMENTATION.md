PRODUCT SPECIFICATION & IMPLEMENTATION BLUEPRINT
Project Name: VocalScribe Studio
Frameworks: Angular (Frontend) + Bootstrap 5 + Node.js/Express (Backend Proxy)
This document contains the complete, production-ready implementation layout for an AI-powered audio-to-score notation platform.

PART 1: SYSTEM ARCHITECTURE SPECIFICATION
CLIENT INFRASTRUCTURE:

Framework: Angular (Strict TypeScript initialization, SSR disabled).

UI Library: Bootstrap 5 (Injected via angular.json global compilation pipeline).

Audio Engine: Local client-side machine learning inference utilizing Spotify's Basic Pitch.

Notation Canvas: OpenSheetMusicDisplay (Dynamic vector/SVG score rendering).

SERVER INFRASTRUCTURE:

Framework: Node.js + Express + TypeScript.

Core Duty: Secure orchestration layer proxying payloads to OpenAI API endpoints.

Output Model: GPT-4o (Temperature 0.2) generating strict raw MusicXML formatting data.

PART 2: BACKEND APPLICATION SETUP
File Path: vocal-scribe-backend/package.json
JSON
{
  "name": "vocal-scribe-backend",
  "version": "1.0.0",
  "description": "Secure AI Orchestration Server for Music XML",
  "main": "server.ts",
  "scripts": {
    "start": "ts-node server.ts"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "openai": "^4.52.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.9",
    "ts-node": "^10.9.2",
    "typescript": "^5.5.2"
  }
}
File Path: vocal-scribe-backend/.env
Code snippet
PORT=3000
OPENAI_API_KEY=YOUR_OPENAI_API_KEY_HERE
File Path: vocal-scribe-backend/server.ts
TypeScript
import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const app = express();
app.use(cors({ origin: 'http://localhost:4200' }));
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });

const SYSTEM_PROMPT = `You are an expert Music Theory System and Algorithmic Composers Engine.
Your task is to take a raw sequence of parsed MIDI pitch events and structure them into a valid, standard-compliant MusicXML document.

CRITICAL STRUCTURAL INSTRUCTIONS:
1. You must output ONLY raw, unformatted MusicXML code. Do NOT wrap it in markdown codeblocks (no \`\`\`xml).
2. The root element must be exactly: <score-partwise version="4.0">
3. Correct and clean erratic timing signatures or performance mistakes by quantizing timestamps to clean note values (quarter, eighth, half notes).
4. Maximize musical readability by dividing continuous midi nodes into logical measures based on a standard 4/4 time signature.
5. Analyze the melody's pitch cluster centers to derive and append logical harmony chord symbols (<harmony> tags) according to the user's requested genre/style.
6. If the user specifies a stylistic arrangement like "Chopin Piano", add a second part block matching basic left-hand harmonic counterpoints (<part id="P2">) matching standard voice leading.
7. End the sheet music cleanly with a valid closing tag: </score-partwise>`;

app.post('/api/v1/compose', async (req: Request, res: Response): Promise<void> => {
  try {
    const { notes, style } = req.body;

    if (!notes || !Array.isArray(notes)) {
      res.status(400).json({ error: 'Missing or invalid notes array data payload.' });
      return;
    }

    const serializedNotes = notes
      .map(n => `Pitch: ${n.pitchMidi}, Start: ${n.startTimeSeconds.toFixed(2)}s, Duration: ${n.durationSeconds.toFixed(2)}s`)
      .join('\n');

    const userPrompt = `Style Request: ${style || 'Standard Classical Lead Sheet'}
Below are the raw recorded notes extracted from the user's vocal humming:
${serializedNotes}

Generate the clean MusicXML document now.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2
    });

    const rawXml = response.choices[0].message.content?.trim() || '';
    res.json({ musicXml: rawXml });

  } catch (error: any) {
    console.error('Composition Error:', error);
    res.status(500).json({ error: 'Internal AI Composition Node Error occurred.' });
  }
});

const PORT = process.env['PORT'] || 3000;
app.listen(PORT, () => console.log(`Secure Audio Composer API running on port ${PORT}`));
PART 3: FRONTEND APPLICATION SETUP
File Path: vocal-scribe-frontend/angular.json
JSON
{
  "styles": [
    "node_modules/bootstrap/dist/css/bootstrap.min.css",
    "src/styles.scss"
  ],
  "scripts": [
    "node_modules/bootstrap/dist/js/bootstrap.bundle.min.js"
  ]
}
File Path: vocal-scribe-frontend/src/app/app.config.ts
TypeScript
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [provideHttpClient()]
};
File Path: vocal-scribe-frontend/src/app/audio-processor.service.ts
TypeScript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { BasicPitch, noteFramesToTime, outputToNotesPoly, addPitchBendsToNoteEvents } from '@spotify/basic-pitch';

export interface MidiNote {
  pitchMidi: number;
  startTimeSeconds: number;
  durationSeconds: number;
}

@Injectable({ providedIn: 'root' })
export class AudioProcessorService {
  private backendUrl = 'http://localhost:3000/api/v1/compose';

  constructor(private http: HttpClient) {}

  async processAudioAndCompose(audioBlob: Blob, style: string): Promise<string> {
    const audioContext = new AudioContext({ sampleRate: 22050 });
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const basicPitch = new BasicPitch('https://unpkg.com/@spotify/basic-pitch@1.0.1/model/model.json');

    const frames: number[][] = [];
    const onsets: number[][] = [];
    const contours: number[][] = [];

    await basicPitch.evaluateModel(
      audioBuffer,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      (pct) => console.log(`Analyzing Melodic Frequency Frequencies: ${Math.round(pct * 100)}%`)
    );

    const baseNotes = outputToNotesPoly(frames, onsets, 0.25, 0.25, 5);
    const complexNotes = addPitchBendsToNoteEvents(contours, baseNotes);
    const timedNotes = noteFramesToTime(complexNotes);

    const structuredMidiNotes: MidiNote[] = timedNotes.map(n => ({
      pitchMidi: n.pitchMidi,
      startTimeSeconds: n.startTimeSeconds,
      durationSeconds: n.durationSeconds
    }));

    const apiResponse = await firstValueFrom(
      this.http.post<{ musicXml: string }>(this.backendUrl, { notes: structuredMidiNotes, style })
    );

    return apiResponse.musicXml;
  }
}
File Path: vocal-scribe-frontend/src/app/app.component.ts
TypeScript
import { Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AudioProcessorService } from './audio-processor.service';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

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
               Stop & Process
            </button>
          </div>
        </div>

        <div *ngIf="isProcessing" class="row mt-3">
          <div class="col text-center">
            <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
            <span class="text-secondary fw-medium">Processing local audio parameters and rendering notation sheets...</span>
          </div>
        </div>
      </div>

      <div class="card shadow-sm border-0 p-4">
        <div #sheetCanvas class="w-100 bg-white style-sheet-output" style="min-height: 500px;"></div>
      </div>
    </div>
  `
})
export class AppComponent {
  @ViewChild('sheetCanvas', { static: true }) sheetCanvas!: ElementRef;
  
  selectedStyle = 'Standard Classical Lead Sheet';
  isRecording = false;
  isProcessing = false;
  
  private mediaRecorder?: MediaRecorder;
  private audioChunks: Blob[] = [];
  private osmdRenderer?: OpenSheetMusicDisplay;

  constructor(private processor: AudioProcessorService) {}

  async startRecording() {
    this.audioChunks = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(stream);
    
    this.mediaRecorder.ondataavailable = (event) => this.audioChunks.push(event.data);
    this.mediaRecorder.onstop = async () => await this.handleAudioProcessing();
    
    this.mediaRecorder.start();
    this.isRecording = true;
  }

  stopRecording() {
    this.mediaRecorder?.stop();
    this.isRecording = false;
  }

  private async handleAudioProcessing() {
    this.isProcessing = true;
    try {
      const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
      const xmlResult = await this.processor.processAudioAndCompose(audioBlob, this.selectedStyle);
      await this.renderSheetMusic(xmlResult);
    } catch (err) {
      console.error("Execution Pipeline Failed", err);
    } finally {
      this.isProcessing = false;
    }
  }

  private async renderSheetMusic(xmlString: string) {
    if (!this.osmdRenderer) {
      this.osmdRenderer = new OpenSheetMusicDisplay(this.sheetCanvas.nativeElement, {
        autoResize: true,
        backend: 'svg',
        drawingParameters: 'default'
      });
    }
    await this.osmdRenderer.load(xmlString);
    this.osmdRenderer.render();
  }
}
INSTRUCTIONS FOR EXECUTION AGENT:
Initialize separate codebase directories for vocal-scribe-backend and vocal-scribe-frontend.

Extract the respective configuration code blocks above into their explicit target files.

Automatically execute workspace installation loops via npm install inside both project targets.

Confirm cross-origin policies permit client asset routing from port 4200 straight to server port 3000.
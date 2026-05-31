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

  /** Cleaned-up notes from BasicPitch (sent to Gemini) */
  public lastProcessedNotes: MidiNote[] = [];

  /** Notes parsed from the MusicXML that Gemini returned — used for score playback */
  public lastScoreNotes: MidiNote[] = [];

  constructor(private http: HttpClient) { }

  async processAudioAndCompose(
    audioBlob: Blob,
    style: string,
    onProgress?: (percent: number) => void,
    onApiCall?: () => void
  ): Promise<string> {
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
      (pct) => {
        if (onProgress) onProgress(Math.round(pct * 100));
      }
    );

    // --- Tuned thresholds for a single singing voice ---
    const baseNotes = outputToNotesPoly(frames, onsets, 0.5, 0.3, 15);
    const complexNotes = addPitchBendsToNoteEvents(contours, baseNotes);
    const timedNotes = noteFramesToTime(complexNotes);

    // --- Post-processing: monophonic cleanup ---
    const MIN_DURATION_S = 0.08;
    const filtered = timedNotes.filter(n => n.durationSeconds >= MIN_DURATION_S);

    const sorted = [...filtered].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
    const mono: typeof sorted = [];
    for (const candidate of sorted) {
      if (mono.length > 0) {
        const last = mono[mono.length - 1];
        const lastEnd = last.startTimeSeconds + last.durationSeconds;
        if (candidate.startTimeSeconds < lastEnd) {
          if (candidate.pitchMidi < last.pitchMidi) mono[mono.length - 1] = candidate;
          continue;
        }
      }
      mono.push(candidate);
    }

    const MERGE_GAP_S = 0.12;
    const merged: typeof mono = [];
    for (const note of mono) {
      if (merged.length > 0) {
        const prev = merged[merged.length - 1];
        const prevEnd = prev.startTimeSeconds + prev.durationSeconds;
        const gap = note.startTimeSeconds - prevEnd;
        if (prev.pitchMidi === note.pitchMidi && gap >= 0 && gap < MERGE_GAP_S) {
          prev.durationSeconds = (note.startTimeSeconds + note.durationSeconds) - prev.startTimeSeconds;
          continue;
        }
      }
      merged.push({ ...note });
    }

    const structuredMidiNotes: MidiNote[] = merged.map(n => ({
      pitchMidi: n.pitchMidi,
      startTimeSeconds: n.startTimeSeconds,
      durationSeconds: n.durationSeconds,
    }));

    console.log(`BasicPitch raw → ${timedNotes.length} notes | After cleanup → ${structuredMidiNotes.length} notes`);
    this.lastProcessedNotes = structuredMidiNotes;

    if (onApiCall) onApiCall();

    const apiResponse = await firstValueFrom(
      this.http.post<{ musicXml: string }>(this.backendUrl, { notes: structuredMidiNotes, style })
    );

    // Parse the returned MusicXML into timed MIDI notes for accurate playback
    this.lastScoreNotes = this.parseMusicXmlToNotes(apiResponse.musicXml);
    console.log(`Score notes parsed from MusicXML → ${this.lastScoreNotes.length} notes`);

    return apiResponse.musicXml;
  }

  /**
   * Parses a MusicXML string and converts every pitched note into a timed MidiNote.
   * Handles multiple parts, measures, rests, chord notes, tempo changes, and divisions.
   */
  parseMusicXmlToNotes(xmlString: string): MidiNote[] {
    // Strip markdown wrappers if present
    let clean = xmlString.trim();
    if (clean.startsWith('```')) {
      const nl = clean.indexOf('\n');
      if (nl !== -1) clean = clean.substring(nl + 1).trim();
      if (clean.endsWith('```')) clean = clean.substring(0, clean.length - 3).trim();
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(clean, 'application/xml');

    console.log(doc)

    const stepToSemitone: Record<string, number> = {
      C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
    };

    const notes: MidiNote[] = [];

    // Only parse the first part (melody line) so we don't double-schedule harmonics
    const part = doc.querySelector('part');
    if (!part) return notes;

    let bpm = 120;
    let divisions = 4;
    let currentTimeSec = 0;

    const measures = part.querySelectorAll('measure');
    for (const measure of measures) {
      // Update divisions if redefined in this measure
      const divisionsEl = measure.querySelector('attributes > divisions');
      if (divisionsEl?.textContent) {
        divisions = parseInt(divisionsEl.textContent, 10) || divisions;
      }

      // Update tempo from <sound tempo="..."> direction
      const soundEl = measure.querySelector('sound[tempo]');
      if (soundEl) {
        bpm = parseFloat(soundEl.getAttribute('tempo') ?? '120') || bpm;
      }

      const secondsPerDivision = 60 / bpm / divisions;

      // Track current cursor within this measure to handle chords correctly
      let measureCursor = currentTimeSec;
      let lastNoteEnd = currentTimeSec;

      for (const child of Array.from(measure.children)) {
        if (child.tagName !== 'note') continue;

        const durationEl = child.querySelector('duration');
        const durationDivisions = durationEl ? parseInt(durationEl.textContent ?? '0', 10) : 0;
        const durationSec = durationDivisions * secondsPerDivision;

        // Chord notes share the start time of the previous note — skip them for
        // monophonic melody playback (keeps only the first/lowest voice)
        const isChord = !!child.querySelector('chord');
        const isRest = !!child.querySelector('rest');

        if (isRest) {
          if (!isChord) measureCursor += durationSec;
          continue;
        }

        const stepEl = child.querySelector('step');
        const octaveEl = child.querySelector('octave');
        const alterEl = child.querySelector('alter');

        if (!stepEl || !octaveEl) continue;

        const step = stepEl.textContent?.trim() ?? 'C';
        const octave = parseInt(octaveEl.textContent ?? '4', 10);
        const alter = alterEl ? parseFloat(alterEl.textContent ?? '0') : 0;

        const pitchMidi = (octave + 1) * 12 + (stepToSemitone[step] ?? 0) + Math.round(alter);
        const startTime = isChord ? lastNoteEnd - (lastNoteEnd - measureCursor) : measureCursor;

        notes.push({ pitchMidi, startTimeSeconds: isChord ? measureCursor : measureCursor, durationSeconds: durationSec });

        if (!isChord) {
          lastNoteEnd = measureCursor + durationSec;
          measureCursor += durationSec;
        }
      }

      currentTimeSec = measureCursor;
    }

    return notes;
  }
}

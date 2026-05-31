import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import Groq from 'groq-sdk';

dotenv.config();

const app = express();
app.use(cors({ origin: 'http://localhost:4200' }));
app.use(express.json());

// ── Provider setup ────────────────────────────────────────────────────────────
const AI_PROVIDER = (process.env['AI_PROVIDER'] ?? 'groq').toLowerCase();

const geminiClient = new GoogleGenAI({ apiKey: process.env['GEMINI_API_KEY'] });
const groqClient = new Groq({ apiKey: process.env['GROQ_API_KEY'] });

console.log(`AI Provider: ${AI_PROVIDER.toUpperCase()}`);

// ── Shared system prompt ──────────────────────────────────────────────────────
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

// ── Route ─────────────────────────────────────────────────────────────────────
app.post('/api/v1/compose', async (req: Request, res: Response): Promise<void> => {
  try {
    const { notes, style } = req.body;

    if (!notes || !Array.isArray(notes)) {
      res.status(400).json({ error: 'Missing or invalid notes array data payload.' });
      return;
    }

    const serializedNotes = notes
      .map((n: any) => `Pitch: ${n.pitchMidi}, Start: ${n.startTimeSeconds.toFixed(2)}s, Duration: ${n.durationSeconds.toFixed(2)}s`)
      .join('\n');

    const userPrompt = `Style Request: ${style || 'Standard Classical Lead Sheet'}
Below are the raw recorded notes extracted from the user's vocal humming:
${serializedNotes}

Generate the clean MusicXML document now.`;

    let rawXml = '';

    if (AI_PROVIDER === 'groq') {
      // ── Groq (Llama 3.3 70B) ────────────────────────────────────────────────
      const chatCompletion = await groqClient.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      });
      rawXml = chatCompletion.choices[0]?.message?.content?.trim() ?? '';

    } else {
      // ── Gemini fallback ─────────────────────────────────────────────────────
      const response = await geminiClient.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [userPrompt],
        config: {
          temperature: 0.2,
          systemInstruction: SYSTEM_PROMPT
        },
      });
      rawXml = response.text?.trim() ?? '';
    }

    res.json({ musicXml: rawXml });

  } catch (error: any) {
    console.error('Composition Error:', error?.message ?? error);

    const httpStatus: number = typeof error?.status === 'number' ? error.status : 500;

    if (httpStatus === 429) {
      let retryAfterSeconds = 10;
      try {
        const details = error?.errorDetails ?? [];
        const retryInfo = details.find((d: any) => d['@type']?.includes('RetryInfo'));
        if (retryInfo?.retryDelay) {
          retryAfterSeconds = parseInt(retryInfo.retryDelay.replace('s', ''), 10) || 10;
        }
      } catch (_) { }

      res.status(429).json({
        error: 'AI API rate limit reached. Please wait a moment before trying again.',
        retryAfterSeconds,
      });
      return;
    }

    res.status(500).json({ error: 'Internal AI Composition Node Error occurred.' });
  }
});

const PORT = process.env['PORT'] || 3000;
app.listen(PORT, () => console.log(`Secure Audio Composer API running on port ${PORT} [Provider: ${AI_PROVIDER.toUpperCase()}]`));

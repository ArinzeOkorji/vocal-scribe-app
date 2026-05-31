declare module "soundfont-player" {
  interface NoteOptions {
    duration?: number;
    gain?: number;
    attack?: number;
    decay?: number;
    sustain?: number;
    release?: number;
    loop?: boolean;
  }
  interface AudioNode {
    stop(when?: number): void;
  }
  interface Player {
    play(note: string | number, when?: number, options?: NoteOptions): AudioNode | null;
    schedule(when: number, notes: { time: number; note: string | number; duration?: number; gain?: number }[]): AudioNode[];
    stop(when?: number): void;
  }
  interface InstrumentOptions {
    soundfont?: string;
    format?: string;
    destination?: AudioNode;
    gain?: number;
    notes?: string[];
  }
  function instrument(ctx: AudioContext, name: string, options?: InstrumentOptions): Promise<Player>;
  export default { instrument };
}

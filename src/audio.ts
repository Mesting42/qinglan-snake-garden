import type { Settings } from './store';
import type { GameEvent } from './game';

type AudioContextConstructor = typeof AudioContext;

export class GardenAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private soundGain: GainNode | null = null;
  private musicNodes: OscillatorNode[] = [];
  private settings: Settings;
  private enabled = true;
  private nextNote = 0;
  private readonly notes = [196, 246.94, 293.66, 246.94, 220, 293.66, 329.63, 293.66];

  constructor(settings: Settings) {
    this.settings = { ...settings };
  }

  setSettings(settings: Settings): void {
    this.settings = { ...settings };
    this.updateLevels();
  }

  async unlock(): Promise<void> {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        const Constructor = (window.AudioContext || (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext);
        if (!Constructor) return;
        this.context = new Constructor();
        this.master = this.context.createGain();
        this.musicGain = this.context.createGain();
        this.soundGain = this.context.createGain();
        this.musicGain.connect(this.master);
        this.soundGain.connect(this.master);
        this.master.connect(this.context.destination);
        this.master.gain.value = 0.75;
        this.musicGain.gain.value = this.settings.music * 0.18;
        this.soundGain.gain.value = this.settings.sound * 0.42;
      }
      if (this.context.state === 'suspended') await this.context.resume();
      this.startMusic();
    } catch {
      this.enabled = false;
    }
  }

  play(event: GameEvent): void {
    if (!this.context || !this.soundGain || this.settings.sound <= 0) return;
    const patterns: Record<GameEvent, number[]> = {
      collect: [523, 659], rare: [659, 784, 988], dew: [440, 587, 784], power: [392, 523], combo: [523, 659, 784],
      boost: [330, 440], crash: [220, 164], win: [523, 659, 784, 1046],
    };
    const notes = patterns[event];
    notes.forEach((frequency, index) => this.tone(frequency, event === 'crash' ? 0.2 : 0.1, index * 0.052, event === 'crash' ? 'triangle' : 'sine'));
  }

  private startMusic(): void {
    if (!this.context || !this.musicGain || this.musicNodes.length || this.settings.music <= 0) return;
    const oscillator = this.context.createOscillator();
    const overtone = this.context.createOscillator();
    const softFilter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    oscillator.type = 'sine';
    overtone.type = 'sine';
    softFilter.type = 'lowpass';
    softFilter.frequency.value = 850;
    oscillator.frequency.value = this.notes[0] / 2;
    overtone.frequency.value = this.notes[2];
    envelope.gain.value = 0.35;
    oscillator.connect(softFilter);
    overtone.connect(softFilter);
    softFilter.connect(envelope);
    envelope.connect(this.musicGain);
    oscillator.start();
    overtone.start();
    this.musicNodes = [oscillator, overtone];
    this.tickMusic();
  }

  private tickMusic(): void {
    if (!this.context || !this.musicNodes.length) return;
    const index = this.nextNote++ % this.notes.length;
    const time = this.context.currentTime;
    this.musicNodes[0].frequency.setTargetAtTime(this.notes[index] / 2, time, 0.65);
    this.musicNodes[1].frequency.setTargetAtTime(this.notes[(index + 3) % this.notes.length], time, 0.85);
    window.setTimeout(() => this.tickMusic(), 2200);
  }

  private tone(frequency: number, duration: number, delay: number, type: OscillatorType): void {
    if (!this.context || !this.soundGain) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    const start = this.context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(80, frequency * 0.78), start + duration);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(0.75, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(this.soundGain);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.04);
  }

  private updateLevels(): void {
    if (!this.context) return;
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(this.settings.music * 0.18, this.context.currentTime, 0.08);
    if (this.soundGain) this.soundGain.gain.setTargetAtTime(this.settings.sound * 0.42, this.context.currentTime, 0.05);
    if (this.musicGain && this.settings.music <= 0) this.musicNodes.forEach((node) => node.stop());
    if (this.settings.music <= 0) this.musicNodes = [];
    else if (this.context.state === 'running') this.startMusic();
  }
}

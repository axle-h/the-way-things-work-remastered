// Client for xhelper.py: one long-lived Python process talking JSON lines over stdin/stdout.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { venvPython, xHelperScript } from './paths.ts';

export interface XWindow {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type Reply = { ok: true; [key: string]: unknown } | { ok: false; error: string };

export class XHelper {
  readonly #process: ChildProcessWithoutNullStreams;
  readonly #waiting: ((reply: Reply) => void)[] = [];
  #stderr = '';
  #exited = false;

  constructor(display: string) {
    this.#process = spawn(venvPython, ['-I', xHelperScript], {
      env: { ...process.env, DISPLAY: display },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.#process.stderr.on('data', (chunk: Buffer) => (this.#stderr += chunk.toString()));
    createInterface({ input: this.#process.stdout }).on('line', (line) => {
      this.#waiting.shift()?.(JSON.parse(line) as Reply);
    });
    this.#process.on('exit', () => {
      this.#exited = true;
      const error: Reply = { ok: false, error: `xhelper exited: ${this.#stderr.trim()}` };
      for (const resolve of this.#waiting.splice(0)) resolve(error);
    });
  }

  async #call(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.#exited) throw new Error(`xhelper is not running: ${this.#stderr.trim()}`);
    const reply = await new Promise<Reply>((resolve) => {
      this.#waiting.push(resolve);
      this.#process.stdin.write(JSON.stringify(request) + '\n');
    });
    if (!reply.ok) throw new Error(`xhelper ${String(request['cmd'])}: ${reply.error}`);
    return reply;
  }

  async windows(): Promise<XWindow[]> {
    return (await this.#call({ cmd: 'windows' }))['windows'] as XWindow[];
  }

  async screen(): Promise<{ width: number; height: number }> {
    const reply = await this.#call({ cmd: 'screen' });
    return { width: reply['width'] as number, height: reply['height'] as number };
  }

  async move(x: number, y: number): Promise<void> {
    await this.#call({ cmd: 'move', x, y });
  }

  async click(x: number, y: number): Promise<void> {
    await this.#call({ cmd: 'click', x, y });
  }

  async key(chord: string): Promise<void> {
    await this.#call({ cmd: 'key', chord });
  }

  async resize(id: number, width: number, height: number): Promise<void> {
    await this.#call({ cmd: 'resize', id, width, height });
  }

  async close(id: number): Promise<void> {
    await this.#call({ cmd: 'close', id });
  }

  async focus(id: number): Promise<void> {
    await this.#call({ cmd: 'focus', id });
  }

  dispose(): void {
    this.#process.stdin.end();
  }
}

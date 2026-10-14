import { MANIFEST_NAME, parseManifest, SCREEN_HEIGHT, SCREEN_WIDTH } from '@twtw/engine';

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
const status = document.querySelector<HTMLElement>('#status');
if (!canvas || !status) throw new Error('index.html is missing #stage or #status');

canvas.width = SCREEN_WIDTH;
canvas.height = SCREEN_HEIGHT;
const context = canvas.getContext('2d');
if (context) {
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#000';
  context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
}

async function loadManifest(): Promise<void> {
  const response = await fetch(`/data/${MANIFEST_NAME}`);
  if (!response.ok) throw new Error(`/data/${MANIFEST_NAME}: HTTP ${response.status}`);
  const manifest = parseManifest(await response.json());
  const message = `Disc data: ${manifest.files.length} files`;
  console.info(message);
  status!.textContent = message;
}

loadManifest().catch((error: unknown) => {
  console.error(error);
  status.textContent = `No disc data (run "pnpm data"): ${error instanceof Error ? error.message : String(error)}`;
});

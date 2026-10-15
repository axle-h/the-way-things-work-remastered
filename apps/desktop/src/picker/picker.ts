// The disc chooser (docs/PLAN.md Phase 10): shown on the first run, when the remembered disc cannot
// be opened, and from Settings → Change disc…. The system's file dialog, the checks and the switch to
// the app all happen in the main process, through the preload bridge.
import type { DesktopBridge, DiscKind, DiscStatus } from '@twtw/web/desktop-bridge';

const bridge = (window as unknown as { twtwDesktop?: DesktopBridge }).twtwDesktop;

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`index.html is missing ${selector}`);
  return found;
}

const chooseIso = element<HTMLButtonElement>('#choose-iso');
const chooseFolder = element<HTMLButtonElement>('#choose-folder');
const busy = element<HTMLElement>('#busy');
const problem = element<HTMLElement>('#problem');
const current = element<HTMLElement>('#current');
const backRow = element<HTMLElement>('#back-row');
const back = element<HTMLButtonElement>('#back');

function showProblem(text: string | null): void {
  problem.hidden = text === null;
  problem.textContent = text ?? '';
}

function showStatus(status: DiscStatus): void {
  const usable = status.path !== null && status.problem === null;
  backRow.hidden = !usable;
  current.hidden = status.path === null;
  current.textContent =
    status.path === null ? '' : `${usable ? 'Disc in use' : 'Disc chosen before'}: ${status.path}`;
  if (status.path !== null && status.problem !== null) {
    showProblem(`The disc chosen before cannot be used. ${status.problem}`);
  }
}

async function choose(kind: DiscKind): Promise<void> {
  if (bridge === undefined) return;
  chooseIso.disabled = true;
  chooseFolder.disabled = true;
  busy.hidden = false;
  try {
    const result = await bridge.chooseDisc(kind);
    if (result.outcome === 'rejected') showProblem(`${result.path}: ${result.reason}`);
    else if (result.outcome === 'opened') showProblem(null);
  } catch (error) {
    showProblem(`Something went wrong: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    busy.hidden = true;
    chooseIso.disabled = false;
    chooseFolder.disabled = false;
  }
}

if (bridge === undefined) {
  showProblem('This page works only inside the desktop app.');
  chooseIso.disabled = true;
  chooseFolder.disabled = true;
} else {
  if (bridge.platform === 'darwin') chooseFolder.textContent = 'Choose the CD in Finder…';
  chooseIso.addEventListener('click', () => void choose('iso'));
  chooseFolder.addEventListener('click', () => void choose('directory'));
  back.addEventListener('click', () => void bridge.openApp());
  bridge.discStatus().then(showStatus, (error: unknown) => showProblem(String(error)));
  chooseIso.focus();
}

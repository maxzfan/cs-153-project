import { SimChannelManager } from './sim-channel-manager';
import { SIM_USERS } from './sim-users';
import { ALL_SCENARIOS } from './sim-scenarios';
import { ScenarioRunner, type CommitTree } from './sim-scenario-runner';

// ——— State ———
let manager: SimChannelManager | null = null;
let runner: ScenarioRunner | null = null;
let commitTree: CommitTree | null = null;
let commitIds: string[] = [];
let expandedUserId: string | null = null;
let backendUrl = '';

// ——— DOM refs ———
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const emailInput = $<HTMLInputElement>('email');
const passwordInput = $<HTMLInputElement>('password');
const signInBtn = $<HTMLButtonElement>('signInBtn');
const projectIdInput = $<HTMLInputElement>('projectId');
const connectBtn = $<HTMLButtonElement>('connectBtn');
const setupStatus = $<HTMLSpanElement>('setupStatus');
const panels = $<HTMLDivElement>('panels');
const rosterBody = $<HTMLDivElement>('rosterBody');
const rosterHeader = document.querySelector('#rosterPanel .panel-header')!;
const scenarioBody = $<HTMLDivElement>('scenarioBody');
const logBody = $<HTMLDivElement>('logBody');
const logClear = $<HTMLButtonElement>('logClear');

// ——— Logging ———
function log(message: string) {
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(message)}`;
  logBody.appendChild(entry);
  logBody.scrollTop = logBody.scrollHeight;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

logClear.addEventListener('click', () => { logBody.innerHTML = ''; });

// ——— Auth ———
signInBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  if (!email || !password) return;

  signInBtn.disabled = true;
  setupStatus.textContent = 'Signing in…';
  setupStatus.className = 'status';

  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL ?? '';
  const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';
  backendUrl = (import.meta as any).env?.VITE_BACKEND_URL ?? 'http://localhost:3000';

  if (!supabaseUrl || !supabaseAnonKey) {
    setupStatus.textContent = 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY';
    setupStatus.className = 'error';
    signInBtn.disabled = false;
    return;
  }

  manager = new SimChannelManager(supabaseUrl, supabaseAnonKey);

  try {
    const { error } = await manager.getSupabase().auth.signInWithPassword({ email, password });
    if (error) {
      setupStatus.textContent = `Auth failed: ${error.message}`;
      setupStatus.className = 'error';
      signInBtn.disabled = false;
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setupStatus.textContent = `Auth error: ${msg}`;
    setupStatus.className = 'error';
    signInBtn.disabled = false;
    log(`⚠ Sign-in failed: ${msg} — check VITE_SUPABASE_URL (${supabaseUrl.slice(0, 30)}...)`);
    return;
  }

  setupStatus.textContent = `Signed in as ${email}`;
  projectIdInput.disabled = false;
  connectBtn.disabled = false;
  log(`Signed in as ${email}`);
});

// ——— Project connection ———
connectBtn.addEventListener('click', async () => {
  const projectId = projectIdInput.value.trim();
  if (!projectId || !manager) return;

  connectBtn.disabled = true;
  setupStatus.textContent = 'Fetching tree.json…';

  try {
    const session = await manager.getSupabase().auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error('No auth session');

    // Get a presigned download URL for tree.json via pull-url, then fetch from S3 directly
    const urlRes = await fetch(`${backendUrl}/api/projects/${projectId}/sync/pull-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ file_key: 'tree.json' }),
    });

    if (urlRes.status === 403) throw new Error('Access denied — check your project membership');
    if (!urlRes.ok) throw new Error(`Backend error: ${urlRes.status}`);

    const { download_url } = await urlRes.json();
    const s3Res = await fetch(download_url);

    if (s3Res.status === 404 || s3Res.status === 403) throw new Error('tree.json not found — has this project been synced to cloud?');
    if (!s3Res.ok) throw new Error(`S3 download failed: ${s3Res.status}`);

    const treeData = await s3Res.json();

    commitTree = {
      commits: (treeData.commits ?? []).map((c: any) => ({ id: c.id, branchId: c.branchId })),
      branches: (treeData.branches ?? []).map((b: any) => ({ id: b.id, headCommitId: b.headCommitId, isMain: b.isMain })),
    };
    commitIds = commitTree.commits.map((c) => c.id);

    manager.setProjectId(projectId);
    runner = new ScenarioRunner(manager, commitTree);
    runner.setLogCallback(log);
    runner.setProgressCallback(onScenarioProgress);
    runner.setActionCallback(() => renderRoster());

    setupStatus.textContent = `Connected — ${commitIds.length} commits loaded`;
    panels.classList.remove('disabled');

    renderRoster();
    renderScenarios();
    log(`Connected to project ${projectId} — ${commitIds.length} commits`);

  } catch (err: any) {
    setupStatus.textContent = err.message;
    setupStatus.className = 'error';
    connectBtn.disabled = false;
  }
});

// ——— Roster rendering ———
function renderRoster() {
  rosterBody.innerHTML = '';
  const activeCount = manager?.getActiveUserIds().length ?? 0;
  rosterHeader.textContent = `User Roster (${activeCount} / 20 active)`;

  SIM_USERS.forEach((user) => {
    const isActive = manager?.isActive(user.userId) ?? false;
    const state = manager?.getState(user.userId);

    const row = document.createElement('div');
    row.className = `user-row ${expandedUserId === user.userId ? 'active' : ''}`;
    row.innerHTML = `
      <div class="avatar" style="background-color: ${user.color}">${user.displayName[0]}</div>
      <div class="user-info">
        <div class="user-name">${escapeHtml(user.displayName)}</div>
        <div class="user-detail">${state?.currentCommitId ? state.currentCommitId.slice(0, 7) : 'no commit'}${state?.statusMessage ? ' · ' + escapeHtml(state.statusMessage) : ''}</div>
      </div>
      <div class="toggle ${isActive ? 'on' : ''}" data-uid="${user.userId}"></div>
    `;

    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('toggle')) return;
      expandedUserId = expandedUserId === user.userId ? null : user.userId;
      renderRoster();
    });

    const toggle = row.querySelector('.toggle')! as HTMLElement;
    toggle.addEventListener('click', async () => {
      if (isActive) {
        await manager?.deactivateUser(user.userId);
        log(`${user.displayName} left (manual)`);
      } else {
        await manager?.activateUser(user);
        log(`${user.displayName} joined (manual)`);
      }
      renderRoster();
    });

    rosterBody.appendChild(row);

    const controls = document.createElement('div');
    controls.className = `user-controls ${expandedUserId === user.userId ? 'visible' : ''}`;
    controls.innerHTML = `
      <select data-uid="${user.userId}">
        <option value="">— select commit —</option>
        ${commitIds.map((id) => `<option value="${id}" ${state?.currentCommitId === id ? 'selected' : ''}>${id.slice(0, 10)}</option>`).join('')}
      </select>
      <input type="text" placeholder="Status message" value="${escapeHtml(state?.statusMessage ?? '')}" data-uid="${user.userId}" />
    `;

    const select = controls.querySelector('select')!;
    select.addEventListener('change', async () => {
      await manager?.setCommit(user.userId, select.value || null);
      log(`${user.displayName} → commit ${select.value ? select.value.slice(0, 7) : 'none'} (manual)`);
      renderRoster();
    });

    const input = controls.querySelector('input')!;
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        await manager?.setStatus(user.userId, input.value);
        log(`${user.displayName} set status: "${input.value}" (manual)`);
        renderRoster();
      }
    });
    input.addEventListener('blur', async () => {
      const currentStatus = manager?.getState(user.userId)?.statusMessage ?? '';
      if (input.value !== currentStatus) {
        await manager?.setStatus(user.userId, input.value);
        log(`${user.displayName} set status: "${input.value}" (manual)`);
        renderRoster();
      }
    });

    controls.addEventListener('click', (e) => e.stopPropagation());

    rosterBody.appendChild(controls);
  });
}

// ——— Scenario rendering ———
const progressBars: Map<string, { bar: HTMLElement; fill: HTMLElement; elapsed: HTMLElement }> = new Map();

function renderScenarios() {
  scenarioBody.innerHTML = '';
  progressBars.clear();

  const runningId = runner?.currentScenarioId ?? null;

  ALL_SCENARIOS.forEach((scenario) => {
    const card = document.createElement('div');
    card.className = 'scenario-card';

    const isThisRunning = runningId === scenario.id;
    const anyRunning = runningId !== null;

    card.innerHTML = `
      <div class="scenario-name">${escapeHtml(scenario.name)}</div>
      <div class="scenario-desc">${escapeHtml(scenario.description)}</div>
      <button class="scenario-btn ${isThisRunning ? 'stop' : ''}" ${anyRunning && !isThisRunning ? 'disabled' : ''}>
        ${isThisRunning ? 'Stop' : 'Run'}
      </button>
      <div class="progress-bar ${isThisRunning ? 'visible' : ''}">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
      <div class="scenario-elapsed" style="font-size:11px;color:#737373;margin-top:4px;${isThisRunning ? '' : 'display:none'}">0s elapsed</div>
    `;

    const bar = card.querySelector('.progress-bar')! as HTMLElement;
    const fill = card.querySelector('.progress-fill')! as HTMLElement;
    const elapsed = card.querySelector('.scenario-elapsed')! as HTMLElement;
    progressBars.set(scenario.id, { bar, fill, elapsed });

    const btn = card.querySelector('button')!;
    btn.addEventListener('click', async () => {
      try {
        if (isThisRunning) {
          await runner?.stop();
        } else if (!anyRunning) {
          // Show progress bar immediately by making it visible before run starts
          bar.classList.add('visible');
          elapsed.style.display = '';
          btn.textContent = 'Stop';
          btn.classList.add('stop');

          await runner?.run(scenario);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`⚠ Scenario error: ${msg}`);
      } finally {
        renderScenarios();
        renderRoster();
      }
    });

    scenarioBody.appendChild(card);
  });
}

function onScenarioProgress(current: number, total: number, elapsedMs: number) {
  const runningId = runner?.currentScenarioId;
  if (!runningId) return;
  const refs = progressBars.get(runningId);
  if (!refs) return;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  refs.fill.style.width = `${pct}%`;
  refs.elapsed.textContent = `${Math.round(elapsedMs / 1000)}s elapsed`;
}

// ——— Cleanup on page unload ———
// Note: deactivateAll() is async but beforeunload may not wait for it.
// Closing the WebSocket triggers Supabase server-side presence leave events.
// Ghost users may persist briefly (~30s) until Supabase's built-in timeout.
window.addEventListener('beforeunload', () => {
  manager?.deactivateAll();
});

const state = { lessons: null, phaseIndex: 0, questIndex: 0, completed: new Set(), cluster: { nodesInspected: false, storageClassInspected: null, persistentVolumeClaims: [], persistentVolumes: [], pods: [], podInspected: null, troubleshootingComplete: false }, history: [], historyIndex: 0 };
const $ = (selector) => document.querySelector(selector);
const normalize = (value) => value.trim().replace(/\s+/g, ' ');
const currentPhase = () => state.lessons.phases[state.phaseIndex];
const currentQuest = () => currentPhase().quests[state.questIndex];

function commandTokens(value) {
  return normalize(value).toLowerCase().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
}
function equivalentCommands(left, right) {
  const a = commandTokens(left); const b = commandTokens(right);
  if (a.length !== b.length || a[0] !== b[0]) return false;
  const positional = tokens => tokens.slice(1).filter(token => !token.startsWith('-'));
  const flags = tokens => tokens.slice(1).filter(token => token.startsWith('-')).sort();
  return positional(a).join('\u0000') === positional(b).join('\u0000') && flags(a).join('\u0000') === flags(b).join('\u0000');
}
function commandMatches(command, validation) {
  const normalized = normalize(command);
  if (validation.regex) {
    try { return new RegExp(validation.regex, 'i').test(normalized); } catch { return false; }
  }
  return (validation.commands || []).some((candidate) => equivalentCommands(candidate, normalized));
}
function mergeState(update) {
  if (!update) return;
  Object.entries(update).forEach(([key, value]) => {
    if (Array.isArray(value)) state.cluster[key] = [...state.cluster[key], ...value.filter(item => !state.cluster[key].some(existing => existing.name === item.name))];
    else state.cluster[key] = value;
  });
}
function escapeHtml(value) { return value.replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char])); }
function writeTerminal(text, type = '') {
  const line = document.createElement('div'); line.className = `terminal-line ${type ? `terminal-${type}` : ''}`; line.textContent = text; $('#terminal-output').append(line); $('#terminal-output').scrollTop = $('#terminal-output').scrollHeight;
}
function renderPhases() {
  const select = $('#phase-select'); select.innerHTML = state.lessons.phases.map((phase, index) => `<option value="${index}">${escapeHtml(phase.title)}</option>`).join(''); select.value = state.phaseIndex;
  $('#phase-description').textContent = currentPhase().description;
  $('#quest-list').innerHTML = currentPhase().quests.map((quest, index) => `<button class="quest-item ${index === state.questIndex ? 'active' : ''} ${state.completed.has(quest.id) ? 'done' : ''}" data-quest="${index}"><span class="quest-num">${quest.id}</span><span>${escapeHtml(quest.title)}</span></button>`).join('');
  $('#quest-list').querySelectorAll('button').forEach(button => button.addEventListener('click', () => { state.questIndex = Number(button.dataset.quest); render(); }));
}
function renderState() {
  const c = state.cluster; const bound = c.persistentVolumeClaims.filter(x => x.status === 'Bound').length;
  $('#state-summary').innerHTML = `<div>nodes inspected <b>${c.nodesInspected ? 'yes' : '—'}</b></div><div>storage classes <b>${c.storageClassInspected ? '1' : '—'}</b></div><div>PVCs bound <b>${bound}</b></div><div>Pods running <b>${c.pods.filter(x => x.status === 'Running').length}</b></div>`;
}
function renderLesson() {
  const quest = currentQuest(); const done = state.completed.has(quest.id);
  $('#lesson-content').innerHTML = `<div class="quest-kicker">QUEST ${escapeHtml(quest.id)} <span class="muted">/ ${escapeHtml(currentPhase().title)}</span></div><h2>${escapeHtml(quest.title)}</h2><p class="description">${escapeHtml(quest.description)}</p><div class="instruction-card"><div class="label">YOUR OBJECTIVE</div><p>Run the appropriate kubectl command in the terminal to complete this quest.</p></div><div class="hint-box"><strong>HINT</strong>${escapeHtml(quest.hints[0])}</div><div class="completion ${done ? '' : 'hidden'}">✓ Quest complete — cluster state updated. Choose another quest or keep exploring.</div>`;
}
function render() { renderPhases(); renderLesson(); renderState(); const total = state.lessons.phases.reduce((sum, phase) => sum + phase.quests.length, 0); $('#progress').textContent = `${state.completed.size} / ${total}`; }
function help() { writeTerminal('KubeLab terminal help\n  Type kubectl commands to solve the active quest.\n  ↑ / ↓  browse command history\n  clear or Ctrl+L  clear terminal\n  help  show this message', 'info'); }
function runCommand(command) {
  const clean = normalize(command); if (!clean) return; state.history = [clean, ...state.history.filter(item => item !== clean)].slice(0, 30); state.historyIndex = -1; writeTerminal(`student@k8s-lab:~$ ${clean}`, 'command');
  if (clean === 'clear') { $('#terminal-output').innerHTML = ''; return; } if (clean === 'help') { help(); return; }
  const quest = currentQuest();
  if (commandMatches(clean, quest.validation)) { writeTerminal(quest.simulatedOutput, 'ok'); state.completed.add(quest.id); mergeState(quest.expectedK8sStateUpdate); render(); }
  else writeTerminal(`error: command not recognized for quest ${quest.id}\nTry a hint or type help.`, 'error');
}
$('#phase-select').addEventListener('change', (event) => { state.phaseIndex = Number(event.target.value); state.questIndex = 0; render(); });
$('#terminal-form').addEventListener('submit', (event) => { event.preventDefault(); runCommand($('#command-input').value); $('#command-input').value = ''; });
$('#clear-btn').addEventListener('click', () => { $('#terminal-output').innerHTML = ''; $('#command-input').focus(); });
$('#help-btn').addEventListener('click', () => { help(); $('#command-input').focus(); });
$('#command-input').addEventListener('keydown', (event) => { if (event.key === 'ArrowUp') { event.preventDefault(); state.historyIndex = Math.min(state.historyIndex + 1, state.history.length - 1); event.target.value = state.history[state.historyIndex] || ''; } if (event.key === 'ArrowDown') { event.preventDefault(); state.historyIndex = Math.max(state.historyIndex - 1, -1); event.target.value = state.historyIndex < 0 ? '' : state.history[state.historyIndex]; } if (event.ctrlKey && event.key.toLowerCase() === 'l') { event.preventDefault(); $('#terminal-output').innerHTML = ''; } });
async function boot() { try { const response = await fetch('./lessons.json', { cache: 'no-store' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); state.lessons = await response.json(); render(); writeTerminal('Welcome to KubeLab. Select a quest and run kubectl commands to begin.', 'info'); $('#command-input').focus(); } catch (error) { writeTerminal(`Unable to load lessons.json: ${error.message}`, 'error'); } }
boot();

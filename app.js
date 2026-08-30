const STORAGE_KEY = 'kubelab-academy-progress-v1';
const state = { lessons: null, phaseIndex: 0, questIndex: 0, completed: new Set(), cluster: {}, history: [], historyIndex: -1, visibleHints: 1 };
const $ = (selector) => document.querySelector(selector);
const normalize = (value) => value.trim().replace(/\s+/g, ' ');
const currentPhase = () => state.lessons.phases[state.phaseIndex];
const currentQuest = () => currentPhase().quests[state.questIndex];
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

function commandTokens(value) { return normalize(value).toLowerCase().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []; }
function equivalentCommands(left, right) {
  const a = commandTokens(left); const b = commandTokens(right);
  if (!a.length || a.length !== b.length || a[0] !== b[0]) return false;
  const positional = (tokens) => tokens.slice(1).filter((token) => !token.startsWith('-'));
  const flags = (tokens) => tokens.slice(1).filter((token) => token.startsWith('-')).sort();
  return positional(a).join('\u0000') === positional(b).join('\u0000') && flags(a).join('\u0000') === flags(b).join('\u0000');
}
function commandMatches(command, validation) {
  const normalized = normalize(command);
  if (validation.regex) { try { return new RegExp(validation.regex, 'i').test(normalized); } catch { return false; } }
  return (validation.commands || []).some((candidate) => equivalentCommands(candidate, normalized));
}
function mergeCluster(update) { if (update) Object.assign(state.cluster, update); }
function saveProgress() { localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.completed])); }
function loadProgress() { try { state.completed = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); } catch { state.completed = new Set(); } }
function totalLabs() { return state.lessons.phases.reduce((total, phase) => total + phase.quests.length, 0); }
function writeTerminal(text, type = '') { const line = document.createElement('div'); line.className = `terminal-line ${type ? `terminal-${type}` : ''}`; line.textContent = text; $('#terminal-output').append(line); $('#terminal-output').scrollTop = $('#terminal-output').scrollHeight; }

function renderNavigation() {
  const phase = currentPhase(); const select = $('#phase-select');
  select.innerHTML = state.lessons.phases.map((item, index) => `<option value="${index}">${escapeHtml(item.title)}</option>`).join(''); select.value = state.phaseIndex;
  $('#quest-list').innerHTML = phase.quests.map((quest, index) => `<button class="quest-item ${state.questIndex === index ? 'active' : ''} ${state.completed.has(quest.id) ? 'done' : ''}" data-quest="${index}"><span class="quest-num">${escapeHtml(quest.id)}</span><span>${escapeHtml(quest.title)}</span></button>`).join('');
  $('#quest-list').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => { state.questIndex = Number(button.dataset.quest); state.visibleHints = 1; render(); }));
  const completed = state.completed.size; const total = totalLabs(); const percentage = Math.round((completed / total) * 100);
  $('#progress-bar').style.width = `${percentage}%`; $('#progress-label').textContent = `${completed} of ${total} labs complete`; $('#progress-percent').textContent = `${percentage}%`;
}
function renderLesson() {
  const phase = currentPhase(); const quest = currentQuest(); const completed = state.completed.has(quest.id); const shownHints = quest.hints.slice(0, state.visibleHints);
  $('#phase-breadcrumb').textContent = phase.title; $('#quest-breadcrumb').textContent = `Lab ${quest.id}`;
  $('#lesson-content').innerHTML = `<div class="lab-kicker"><span class="badge">LAB ${escapeHtml(quest.id)}</span><span>${escapeHtml(phase.title)}</span></div><h2>${escapeHtml(quest.title)}</h2><p class="lesson-description">${escapeHtml(quest.description)}</p><section class="objective-card"><div class="card-label">MISSION</div><p>${escapeHtml(quest.objective || 'Use the terminal to run the required kubectl command.')}</p>${quest.commandPreview ? `<code class="command-preview">${escapeHtml(quest.commandPreview)}</code>` : ''}</section><section class="hint-section"><div class="hint-heading"><span>Guided hints · ${Math.min(state.visibleHints, quest.hints.length)} of ${quest.hints.length}</span>${state.visibleHints < quest.hints.length ? '<button id="more-hints" type="button">Reveal next hint</button>' : ''}</div><div class="hint-list">${shownHints.map((hint, index) => `<div class="hint"><b>Hint ${index + 1}.</b> ${escapeHtml(hint)}</div>`).join('')}</div></section><div class="success-card ${completed ? '' : 'hidden'}"><span class="check">✓</span><span><b>Lab complete.</b><br>Your command was accepted by the simulator and the virtual cluster state was updated.</span>${nextQuest() ? '<button class="next-lab" id="next-lab">Next lab →</button>' : ''}</div>`;
  $('#more-hints')?.addEventListener('click', () => { state.visibleHints += 1; renderLesson(); });
  $('#next-lab')?.addEventListener('click', () => { advanceQuest(); });
}
function nextQuest() { const nextInPhase = currentPhase().quests[state.questIndex + 1]; if (nextInPhase) return { phaseIndex: state.phaseIndex, questIndex: state.questIndex + 1 }; return state.lessons.phases[state.phaseIndex + 1] ? { phaseIndex: state.phaseIndex + 1, questIndex: 0 } : null; }
function advanceQuest() { const next = nextQuest(); if (!next) return; state.phaseIndex = next.phaseIndex; state.questIndex = next.questIndex; state.visibleHints = 1; render(); }
function render() { renderNavigation(); renderLesson(); }
function help() { writeTerminal('KubeLab Academy terminal\n  • Run the command shown in the current lab.\n  • Use the guided hints when you need help.\n  • ↑ / ↓ revisits command history.\n  • clear or Ctrl+L clears the terminal.', 'info'); }
function runCommand(command) {
  const clean = normalize(command); if (!clean) return;
  state.history = [clean, ...state.history.filter((item) => item !== clean)].slice(0, 50); state.historyIndex = -1; writeTerminal(`student@k8s-lab:~$ ${clean}`, 'command');
  if (clean.toLowerCase() === 'clear') { $('#terminal-output').innerHTML = ''; return; }
  if (clean.toLowerCase() === 'help') { help(); return; }
  const quest = currentQuest();
  if (commandMatches(clean, quest.validation)) { writeTerminal(quest.simulatedOutput, 'ok'); state.completed.add(quest.id); mergeCluster(quest.expectedK8sStateUpdate); saveProgress(); render(); }
  else writeTerminal(`That command is not the expected action for Lab ${quest.id}. Review the mission or reveal the next hint.`, 'error');
}
function resetProgress() { state.completed.clear(); state.cluster = {}; localStorage.removeItem(STORAGE_KEY); render(); writeTerminal('Course progress reset. Your terminal history remains available for this session.', 'info'); }
$('#phase-select').addEventListener('change', (event) => { state.phaseIndex = Number(event.target.value); state.questIndex = 0; state.visibleHints = 1; render(); });
$('#terminal-form').addEventListener('submit', (event) => { event.preventDefault(); runCommand($('#command-input').value); $('#command-input').value = ''; });
$('#clear-btn').addEventListener('click', () => { $('#terminal-output').innerHTML = ''; $('#command-input').focus(); });
$('#help-btn').addEventListener('click', () => { help(); $('#command-input').focus(); });
$('#reset-btn').addEventListener('click', resetProgress);
$('#command-input').addEventListener('keydown', (event) => { if (event.key === 'ArrowUp') { event.preventDefault(); state.historyIndex = Math.min(state.historyIndex + 1, state.history.length - 1); event.target.value = state.history[state.historyIndex] || ''; } else if (event.key === 'ArrowDown') { event.preventDefault(); state.historyIndex = Math.max(state.historyIndex - 1, -1); event.target.value = state.historyIndex < 0 ? '' : state.history[state.historyIndex]; } else if (event.ctrlKey && event.key.toLowerCase() === 'l') { event.preventDefault(); $('#terminal-output').innerHTML = ''; } });
async function boot() { try { const response = await fetch('./lessons.json', { cache: 'no-store' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); state.lessons = await response.json(); loadProgress(); render(); writeTerminal('Welcome to KubeLab Academy. Select a lab and run its kubectl command to begin.', 'info'); $('#command-input').focus(); } catch (error) { writeTerminal(`Unable to load lessons.json: ${error.message}`, 'error'); } }
boot();

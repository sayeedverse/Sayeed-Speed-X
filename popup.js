
const buttons = [...document.querySelectorAll("[data-speed]")];
const bigSpeed = document.getElementById("bigSpeed");
const custom = document.getElementById("customSpeed");
const slider = document.getElementById("speedSlider");
const enabled = document.getElementById("enabled");
const minus = document.getElementById("minus");
const plus = document.getElementById("plus");

let speed = 1;
let autoApplyTimer = null;

function clamp(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(64, Math.max(0, n));
}
function fmt(v) {
  const n = clamp(v);
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}
function render() {
  const text = fmt(speed);
  bigSpeed.textContent = text;
  custom.value = text;
  slider.value = speed;
  buttons.forEach(b => b.classList.toggle("active", Number(b.dataset.speed) === speed));

  const modeBadge = document.getElementById("modeBadge");
  const mode = speed === 0 ? "STOPPED"
    : speed <= 0.5 ? "SLOW"
    : speed <= 1 ? "BASE"
    : speed <= 2 ? "FLOW"
    : speed <= 4 ? "FAST"
    : speed <= 8 ? "TURBO"
    : speed <= 16 ? "NATIVE"
    : speed <= 32 ? "HYPER"
    : "MAX";

  modeBadge.textContent = mode;
  modeBadge.classList.toggle("turbo", speed > 4);
  modeBadge.classList.toggle("hyper", speed > 16 && speed <= 32);
  modeBadge.classList.toggle("max", speed > 32);
}

function queueAutoApply(value) {
  clearTimeout(autoApplyTimer);
  autoApplyTimer = setTimeout(() => setSpeed(value), 140);
}

function send(command, value) {
  chrome.runtime.sendMessage({action:"controller", command, value}, (r) => {
    if (chrome.runtime.lastError) return;
    if (r?.ok) {
      speed = clamp(r.requestedSpeed);
      render();
      chrome.storage.local.set({speed,enabled:enabled.checked});
    }
  });
}
function setSpeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  speed = clamp(n);
  render();
  chrome.storage.local.set({speed,enabled:enabled.checked});
  send("setSpeed", speed);
}
buttons.forEach(b => b.addEventListener("click", () => setSpeed(b.dataset.speed)));
slider.addEventListener("input", () => {
  speed = clamp(slider.value);
  render();
  queueAutoApply(speed);
});
slider.addEventListener("change", () => setSpeed(slider.value));
custom.addEventListener("input", () => {
  speed = clamp(custom.value);
  render();
  queueAutoApply(speed);
});
custom.addEventListener("keydown", e => { if(e.key==="Enter") setSpeed(custom.value); });
minus.addEventListener("click", () => setSpeed(Number(custom.value)-0.5));
plus.addEventListener("click", () => setSpeed(Number(custom.value)+0.5));
enabled.addEventListener("change", () => {
  chrome.storage.local.set({enabled:enabled.checked});
  send("toggle",enabled.checked);
});
chrome.storage.local.get({speed:1,enabled:true}, s => {
  speed = clamp(s.speed); enabled.checked = Boolean(s.enabled); render();
  send("sync");
});

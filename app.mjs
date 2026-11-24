import { analyzeBrief } from "./parser.mjs";
import { samples } from "./samples.mjs";

const $ = (id) => document.getElementById(id);
const brief = $("brief");
const start = $("start");
const modelButton = $("load-model");
const formatter = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateLabel = (date) => formatter.format(new Date(date));
const storagePrefix = "briefbuddy:checklist:";
let active;
let worker;
let modelReady = false;
let running = false;
let timeout;
let pending;

function today() {
  const date = new Date();
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
}

function el(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function dateElement(date) {
  const time = el("time", dateLabel(date));
  time.dateTime = date;
  return time;
}

function list(id, items, draw, empty) {
  $(id).replaceChildren(...(items.length ? items.map(draw) : [el("li", empty, "muted")]));
}

function storageKey(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return storagePrefix + (hash >>> 0).toString(36);
}

function drawChecklist(deliverables, text) {
  const key = storageKey(text);
  let completed;
  try {
    completed = new Set(JSON.parse(localStorage.getItem(key) ?? "[]"));
  } catch {
    completed = new Set();
  }
  completed = new Set(deliverables.filter((item) => completed.has(item)));
  const update = () => {
    $("check-count").textContent = `${completed.size} / ${deliverables.length} done`;
    $("check-progress").max = deliverables.length || 1;
    $("check-progress").value = completed.size;
  };
  list("checklist", deliverables, (item) => {
    const li = el("li");
    const label = el("label");
    const check = el("input");
    check.type = "checkbox";
    check.checked = completed.has(item);
    check.addEventListener("change", () => {
      if (check.checked) completed.add(item); else completed.delete(item);
      try { localStorage.setItem(key, JSON.stringify([...completed])); } catch { /* Storage can be disabled. */ }
      update();
    });
    label.append(check, el("span", item));
    li.append(label);
    return li;
  }, "No explicit deliverables found.");
  update();
}

function setEngine(label, message) {
  $("engine").textContent = label;
  $("model-state").textContent = message;
}

function refreshModelButton() {
  modelButton.disabled = running;
  modelButton.firstChild.textContent = running ? "AI working… " : modelReady ? "Summarize with AI " : "Load AI model ";
}

function modelFailed(reason) {
  clearTimeout(timeout);
  worker?.terminate();
  worker = null;
  modelReady = false;
  running = false;
  pending = null;
  setEngine("Heuristic fallback", reason);
  refreshModelButton();
}

function runModel() {
  if (!active || running) return;
  try {
    if (!worker) {
      worker = new Worker(new URL("./model-worker.mjs", import.meta.url), { type: "module" });
      worker.onerror = () => modelFailed("The model runtime could not start in this browser.");
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") {
          setEngine("Heuristic fallback", Number.isFinite(data.progress)
            ? `Downloading ${data.file} · ${Math.round(data.progress)}%`
            : `Loading ${data.file}…`);
        } else if (data.type === "summarizing") {
          modelReady = true;
          setEngine("Heuristic fallback", "Generating an AI summary on this device…");
        } else if (data.type === "complete") {
          clearTimeout(timeout);
          running = false;
          if (pending === active) {
            $("summary").textContent = data.summary;
            setEngine("AI · Xenova/t5-small", "Generated on this device. Verify against the brief.");
          } else {
            runModel();
          }
          refreshModelButton();
        } else if (data.type === "failed") {
          console.warn("BriefBuddy model unavailable:", data.message);
          modelFailed(navigator.onLine ? "Model download or browser inference failed. You can retry." : "Offline: model files could not be loaded.");
        }
      };
    }
    pending = active;
    running = true;
    refreshModelButton();
    $("summary").textContent = active.result.summary;
    setEngine("Heuristic fallback", modelReady ? "Generating an AI summary on this device…" : "Loading the model; the first download can take a few minutes.");
    worker.postMessage({ text: active.result.summarySource });
    timeout = setTimeout(() => modelFailed("Model loading or inference timed out. You can retry."), 180_000);
  } catch {
    modelFailed("This browser could not start the local model worker.");
  }
}

function render({ result, text }) {
  $("empty").hidden = true;
  $("ready").hidden = false;
  $("results-body").hidden = false;
  $("summary").textContent = result.summary;
  setEngine("Heuristic fallback", running ? "The model is still loading or working." :
    modelReady ? "The local model is ready." : "Optional AI model not loaded.");
  drawChecklist(result.deliverables, text);
  list("deadlines", result.deadlines, ({ date, source, relative }) => {
    const item = el("li");
    item.append(date ? dateElement(date) : el("strong", "Needs confirmation"));
    if (relative) item.append(el("span", " · from start date", "quiet"));
    item.append(el("p", source));
    return item;
  }, "No dated deadline found.");
  list("rubric", result.rubric, ({ weight, label }) => {
    const item = el("li", undefined, "rubric-row");
    item.append(el("span", `${weight}%`, "weight"), el("span", label));
    return item;
  }, "No percentage-weighted criteria found.");
  list("flags", result.flags, ({ title, detail }) => {
    const item = el("li");
    item.append(el("strong", title), el("p", detail));
    return item;
  }, "No common warning signs were found. Still check the original brief.");
  $("plan-note").textContent = result.tentativePlan
    ? "No confirmed deadline: this is a provisional seven-day plan, not a submission date."
    : "A suggested schedule based on your start date and the earliest deadline for non-draft work.";
  list("plan", result.plan, ({ date, label, detail }) => {
    const item = el("li");
    const description = el("div");
    description.append(el("strong", label), el("p", detail));
    item.append(dateElement(date), description);
    return item;
  }, "The deadline is before your selected start date. Check both dates to make a new plan.");
  list("quiz", result.quiz, ({ question, answer }) => {
    const item = el("li");
    const details = el("details");
    details.append(el("summary", question), el("p", answer));
    item.append(details);
    return item;
  });
  $("results-announcement").textContent = `Breakdown ready: ${result.deliverables.length} deliverables and five quiz questions.`;
}

function analyze() {
  const text = brief.value.trim();
  brief.setCustomValidity(text ? "" : "Paste a brief or choose a sample first.");
  if (!brief.reportValidity() || !start.reportValidity()) return false;
  active = { result: analyzeBrief(text, start.value), text };
  render(active);
  if (modelReady) runModel();
  return true;
}

function updateInput() {
  $("char-count").textContent = `${brief.value.length.toLocaleString()} characters`;
  brief.setCustomValidity("");
}

for (const sample of samples) {
  const button = el("button", sample.label);
  button.type = "button";
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => {
    for (const other of $("samples").children) other.setAttribute("aria-pressed", String(other === button));
    brief.value = sample.text;
    start.value = sample.start;
    updateInput();
    analyze();
  });
  $("samples").append(button);
}

brief.addEventListener("input", () => {
  updateInput();
  for (const button of $("samples").children) button.setAttribute("aria-pressed", "false");
});
$("brief-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (analyze()) $("results-heading").focus();
});
modelButton.addEventListener("click", runModel);
document.querySelector('a[href="#about"]').addEventListener("click", () => { $("about").open = true; });
start.value = today();
const example = analyzeBrief(samples[0].text, samples[0].start);
$("example-input").textContent = example.summarySource;
$("example-output").textContent = example.summary;

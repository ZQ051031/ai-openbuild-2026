const DAY = 86_400_000;
const months = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const monthPattern = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const datePattern = new RegExp(`\\b(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{4}|(?!(?<=\\d:)\\d{2}\\s)\\d{1,2}(?:st|nd|rd|th)?\\s+${monthPattern}(?:\\s+\\d{4})?|${monthPattern}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|(?:in|within)\\s+\\d+\\s+(?:days?|weeks?)|today|tomorrow)\\b`, "gi");
const duePattern = /\b(?:due|deadline|checkpoint|cut-?off|no later than|final\s+submission)\b/i;
const weekdayPattern = "(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)";
const clockPattern = "(?:\\d{1,2}:\\d{2}(?:\\s*[ap]m)?|\\d{1,2}\\s*[ap]m|noon|midnight)";
const byDatePattern = new RegExp(`\\bby\\s+(?:${weekdayPattern}(?:,\\s*|\\s+))?(?:(?:at\\s+)?${clockPattern}(?:,\\s*|\\s+(?:on\\s+)?))?(?=${datePattern.source})`, "i");
const hasDeadlineCue = (line) => duePattern.test(line) || byDatePattern.test(line);
const deadlineClauseToken = /[()]|\s*;\s*|(?<=[.!?])\s+|(?:,\s*(?:and\s+)?|\s+and\s+)(?=(?:the\s+)?(?:draft|final|checkpoint)\b)/gi;
const optionalDeadlinePattern = /\b(?:draft|checkpoint|optional)\b/i;
const finalDeadlinePattern = /\bfinal\b/i;
const deadlineWorkWords = (text) => (text.toLowerCase().match(/\b[a-z]+\b/g) ?? [])
  .filter((word) => !/^(?:a|an|the|optional|draft|checkpoint|submissions?|dates?|at|on)$/.test(word));
const actionPattern = /^(?:please\s+)?(?:submit|upload|attach|include|create|produce|prepare|provide|present|record|hand in|turn in|write|complete|deliver|bring|send|build)\b/i;
const listItemPattern = /^\s*(?:[•*–—-]\s+|\d+[.)]\s+)/;
const tidyLine = (value) => value.trim().replace(listItemPattern, "").trim();
const markdownHeadingPattern = /^(#{1,6})\s+/;
const headingText = (line) => line.replace(markdownHeadingPattern, "");
export const isoDay = (value) => value.toISOString().slice(0, 10);
const offsetDay = (date, days) => isoDay(new Date(Date.parse(date) + days * DAY));

function normalizedDay(year, month, day) {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 ? isoDay(date) : null;
}

function readDate(value, start, dateOrder) {
  if (/^\d{4}-/.test(value)) return { date: normalizedDay(...value.split("-").map(Number)) };
  if (/^\d+[/.-]\d+[/.-]/.test(value)) {
    const [first, second, year] = value.split(/[/.-]/).map(Number);
    const ambiguous = first <= 12 && second <= 12 && first !== second && !dateOrder;
    const monthFirst = dateOrder ? dateOrder === "mdy" : second > 12;
    return { date: ambiguous ? null : normalizedDay(year, monthFirst ? first : second, monthFirst ? second : first), ambiguous };
  }
  if (/^(?:in|within)\b|^(?:today|tomorrow)$/i.test(value)) {
    const count = /^(?:today|tomorrow)$/i.test(value) ? Number(/^tomorrow$/i.test(value)) : Number(value.match(/\d+/)[0]);
    const days = count * (/weeks?/i.test(value) ? 7 : 1);
    return { date: days < 100_000 ? offsetDay(start, days) : null, relative: true };
  }
  const month = value.match(/[a-z]{3}/i)?.[0].toLowerCase();
  const [day, year] = value.match(/\d+/g).map(Number);
  const date = normalizedDay(year ?? Number(start.slice(0, 4)), months.indexOf(month) + 1, day);
  return { date, assumedYear: year === undefined };
}

function readRubric(line) {
  const leading = line.match(/^(\d+(?:\.\d+)?)\s*%\s*[–—:.-]?\s*(.+)$/);
  const trailing = line.match(/^(.+?)\s*[:–—(-]?\s*(\d+(?:\.\d+)?)\s*%\s*\)?\s*[.!]?$/);
  if (!leading && !trailing) return null;
  const [, weight, label] = leading || [null, trailing[2], trailing[1]];
  return Number(weight) <= 100 ? { weight: Number(weight), label: label.trim() } : null;
}

function abbreviated(value, length = 200) {
  return value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;
}

function datedDeadlineClauses(line) {
  const clauses = [];
  let depth = 0, start = 0, noteStart = 0, notes = [];
  const addClause = (end) => {
    const source = line.slice(start, end);
    const main = notes.reduceRight((text, note) =>
      `${text.slice(0, note.start - start).trimEnd()} ${text.slice(note.end - start).trimStart()}`, source).trim();
    const mainDates = main.match(datePattern);
    if (notes.length && mainDates) {
      clauses.push({ source: main, dates: mainDates });
      for (const note of notes) {
        const inheritsOptional = optionalDeadlinePattern.test(main) && !finalDeadlinePattern.test(note.source);
        clauses.push({ source: inheritsOptional ? source : note.source, dates: note.dates });
      }
    } else {
      const dates = notes.length ? source.match(datePattern) : mainDates;
      if (dates) clauses.push({ source, dates });
    }
    notes = [];
  };
  for (const { 0: token, index } of line.matchAll(deadlineClauseToken)) {
    if (token === "(") {
      if (depth++ === 0) noteStart = index;
    } else if (token === ")") {
      if (depth && --depth === 0) {
        const source = line.slice(noteStart + 1, index);
        const dates = source.match(datePattern);
        if (dates) notes.push({ start: noteStart, end: index + 1, source, dates });
      }
    } else if (depth === 0) {
      addClause(index);
      start = index + token.length;
    }
  }
  addClause(line.length);
  if (clauses.length === 1) clauses[0].source = line;
  return clauses;
}

function buildPlan(start, target, checkpoint) {
  const window = Math.round((Date.parse(target) - Date.parse(start)) / DAY);
  const writing = offsetDay(target, -Math.min(window, Math.max(1, Math.ceil(window / 3))));
  const review = offsetDay(target, -Math.min(window, 1));
  return [
    { date: start, label: "Read & clarify", detail: "Read the brief, confirm open questions and block time in your calendar." },
    { date: checkpoint && checkpoint < writing ? checkpoint : writing, label: "Make a first pass", detail: "Outline or build a draft. Match each deliverable to the rubric." },
    { date: review, label: "Review & revise", detail: "Check required formats, evidence and marking criteria." },
    { date: target, label: "Final check", detail: "Confirm the submission details, then hand in the required items." },
  ];
}

export function analyzeBrief(input, start = isoDay(new Date())) {
  const rawLines = input.split(/\r?\n/);
  const lines = rawLines.map(tidyLine);
  if (!lines.some(Boolean)) return null;
  const deliverables = [], deadlines = [], rubric = [], flags = [];
  const deliverablesHeading = /^(?:what to hand in|deliverables|submission requirements)\s*:?$/i;
  const hasDeliverablesSection = lines.some((line) => deliverablesHeading.test(headingText(line)));
  const dateOrder = /\bDD\/MM\/YYYY\b/i.test(input) ? "dmy" : /\bMM\/DD\/YYYY\b/i.test(input) ? "mdy" : null;
  let section = "";
  let deadlineHeadingLevel;
  let optionalHeading;
  for (const [index, line] of lines.entries()) {
    if (!line) continue;
    const heading = headingText(line);
    const headingLevel = line.match(markdownHeadingPattern)?.[1].length;
    if (deliverablesHeading.test(heading)) {
      section = "deliverables";
      continue;
    }
    if (/^(?:rubric|assessment weights|grading(?: criteria)?|marking(?: criteria)?)\s*:?$/i.test(heading)) {
      section = "rubric";
      continue;
    }
    if (/^(?:key dates|dates|deadlines)\s*:?$/i.test(heading)) {
      section = "deadlines";
      deadlineHeadingLevel = headingLevel ?? 2;
      optionalHeading = undefined;
      continue;
    }
    if (/^(?:requirements|notes)\s*:?$/i.test(heading) ||
        (section === "deadlines" && /^(?:background|context|overview|introduction)\s*:?$/i.test(heading))) {
      section = "";
      continue;
    }
    if (section === "deadlines" && headingLevel) {
      if (headingLevel <= deadlineHeadingLevel) section = "";
      if (optionalHeading && headingLevel <= optionalHeading.level) optionalHeading = undefined;
      const title = heading.split("(", 1)[0];
      if (section === "deadlines" && !optionalHeading && optionalDeadlinePattern.test(title) &&
          !finalDeadlinePattern.test(title) && !/\band\s+(?:the\s+)?submissions?\b/i.test(title)) {
        optionalHeading = { level: headingLevel, work: deadlineWorkWords(title) };
      }
    }
    const criterion = readRubric(line);
    if (criterion && (section === "rubric" || !actionPattern.test(line))) rubric.push(criterion);
    if (section === "deliverables" && deliverables.length && hasDeadlineCue(line) &&
        !actionPattern.test(line) && !listItemPattern.test(rawLines[index]) &&
        (lines[index - 1] === "" || listItemPattern.test(rawLines[index - 1]) || duePattern.test(line))) section = "";
    if ((section === "deliverables" && (actionPattern.test(line) || (line.length < 160 && !criterion))) ||
        (!hasDeliverablesSection && actionPattern.test(line))) {
      for (const sentence of line.split(/(?<=[.!?])\s+(?=(?:submit|upload|attach|include|create|present|record|write|complete|build)\b)/i)) {
        if (!deliverables.includes(sentence)) deliverables.push(sentence);
      }
    }
    if (section === "deadlines" || hasDeadlineCue(heading)) {
      for (const { source, dates } of datedDeadlineClauses(heading)) {
        let optional = optionalDeadlinePattern.test(source);
        if (!optional && section === "deadlines" && optionalHeading && !finalDeadlinePattern.test(source)) {
          const label = source.slice(0, source.indexOf(dates[0])).split(/\b(?:due|by|deadline)\b/i, 1)[0];
          const work = deadlineWorkWords(label);
          optional = !work.length || work.some((word) => optionalHeading.work.includes(word));
        }
        for (const raw of dates) {
          const parsed = readDate(raw, start, dateOrder);
          deadlines.push({ source, raw, optional, ...parsed });
          if (!parsed.date) flags.push({ title: parsed.ambiguous ? "Ambiguous date format" : "Unrecognized date", detail: source });
          if (parsed.assumedYear) flags.push({ title: "Year inferred from your start date", detail: source });
        }
      }
    }
    if (/\b(?:TBC|TBD|to be confirmed|appropriate|roughly|as needed|suitable|sufficient|approximately|where possible)\b/i.test(line)) {
      flags.push({ title: "Clarify this wording", detail: line });
    }
  }
  const dated = deadlines.filter(({ date }) => date).sort((a, b) => a.date.localeCompare(b.date));
  const hard = dated.filter(({ optional }) => !optional);
  const finalDates = new Set(hard.filter(({ source }) => finalDeadlinePattern.test(source)).map(({ date }) => date));
  if (finalDates.size > 1) flags.push({ title: "Possible deadline conflict", detail: "The brief lists different dates for final work. Confirm which date applies before submitting." });
  if (!dated.length) flags.push({ title: "No confirmed deadline found", detail: "Check the course portal or ask your instructor for the deadline." });
  if (dated[0]?.date < start) flags.push({ title: "A deadline is before your start date", detail: dated[0].source });
  if (/\b(?:report|essay|reflection)\b/i.test(input) && !/\b\d[\d,]*\s*[- ]?\s*(?:words?|pages?)\b/i.test(input)) {
    flags.push({ title: "No length requirement found", detail: "Ask whether the written work has a word or page limit." });
  }
  if (!deliverables.length) flags.push({ title: "No explicit deliverables found", detail: "Look for submission instructions or check with your instructor." });
  const total = rubric.reduce((sum, { weight }) => sum + weight, 0);
  if (rubric.length && Math.abs(total - 100) > 0.01) flags.push({ title: "Listed grading weights do not total 100%", detail: `The extracted criteria add up to ${Number(total.toFixed(2))}%. Check whether any categories are missing.` });
  const primaryDeadline = hard[0] ?? dated[0];
  const checkpoint = dated.find(({ date }) => date >= start)?.date;
  const target = primaryDeadline?.date ?? offsetDay(start, 7);
  const plan = target >= start ? buildPlan(start, target, checkpoint) : [];
  const highest = rubric.reduce((best, item) => !best || item.weight > best.weight ? item : best, null);
  const purpose = lines.filter(Boolean).slice(0, 4).find((line) => /[.!?]$/.test(line) && !hasDeadlineCue(line) && !readRubric(line));
  const summary = [
    purpose && abbreviated(purpose, 280),
    deliverables.length ? `What to hand in: ${deliverables.slice(0, 2).map((item) => abbreviated(item)).join(" ")}` : "No explicit hand-in instructions were found.",
    primaryDeadline ? `Key deadline: ${primaryDeadline.source}` : "Confirm the deadline with your instructor.",
    highest && `The highest listed grading weight is ${highest.label} (${highest.weight}%).`,
  ].filter(Boolean).join(" ");
  const quiz = [
    { question: "What is the first thing you need to hand in?", answer: deliverables[0] ?? "No explicit deliverable was found. Check the submission instructions." },
    { question: "When is the first confirmed date to put on your calendar?", answer: dated[0]?.source ?? "The brief does not give a date BriefBuddy can confirm." },
    { question: "Which listed criterion carries the most marks?", answer: highest ? `${highest.label} (${highest.weight}%).` : "No percentage-weighted criteria were found." },
    { question: "What else should you prepare before submitting?", answer: deliverables[1] ?? "No second explicit deliverable was found. Double-check the brief." },
    { question: "What detail is worth double-checking with your instructor?", answer: flags[0]?.detail ?? "Confirm the hand-in instructions against the original brief." },
  ];
  const summarySource = [...new Set([purpose, ...deliverables].filter(Boolean))].join(" ") || input;
  return { summary, summarySource, deliverables, deadlines, rubric, flags, plan, quiz, tentativePlan: !primaryDeadline };
}

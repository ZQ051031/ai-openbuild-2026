import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBrief } from "./parser.mjs";
import { samples } from "./samples.mjs";

const expected = [
  { items: 2, dates: ["2026-12-01", "2026-12-08"], weights: [40, 30, 20, 10], flag: "Clarify this wording", target: "2026-12-08" },
  { items: 2, dates: ["2026-11-28", "2026-12-07", "2026-12-08"], weights: [45, 30, 15, 10], flag: "Possible deadline conflict", target: "2026-12-07" },
  { items: 3, dates: ["2026-12-04", "2026-12-06"], weights: [35, 30, 25, 10], flag: "Clarify this wording", target: "2026-12-04" },
];

samples.forEach(({ title, text, start }, index) => {
  test(title, () => {
    const result = analyzeBrief(text, start);
    const { items, dates, weights, flag, target } = expected[index];
    assert.equal(result.deliverables.length, items);
    assert.deepEqual(result.deadlines.map(({ date }) => date), dates);
    assert.deepEqual(result.rubric.map(({ weight }) => weight), weights);
    assert.ok(result.flags.some(({ title }) => title === flag));
    assert.equal(result.plan[0].date, start);
    assert.equal(result.plan.at(-1).date, target);
    assert.equal(result.quiz.length, 5);
    assert.equal(result.quiz[0].answer, result.deliverables[0]);
    assert.match(result.summary, /Key deadline:/);
    assert.ok(result.summarySource.includes(result.deliverables[0]));
  });
});

test("missing and ambiguous dates are not treated as confirmed", () => {
  const result = analyzeBrief("Write a report.\nReport due 03/04/2027.\nDraft due 2027-02-30.", "2027-03-01");
  assert.deepEqual(result.deadlines.map(({ date }) => date), [null, null]);
  assert.ok(result.tentativePlan);
  assert.equal(result.plan.at(-1).date, "2027-03-08");
  assert.ok(result.flags.some(({ title }) => title === "No length requirement found"));
});

test("relative deadlines move with the chosen start date and past dates do not create a plan", () => {
  assert.equal(analyzeBrief("Essay due within 2 weeks.", "2026-12-01").deadlines[0].date, "2026-12-15");
  assert.deepEqual(analyzeBrief("Report due 1 December 2026.", "2026-12-03").plan, []);
  assert.equal(analyzeBrief(" \n "), null);
});

test("bylines do not create deadlines or override a dated hand-in", () => {
  const result = analyzeBrief("Updated by course staff on 20 November\nFinal report by 8 December 2026", "2026-11-24");
  assert.deepEqual(result.deadlines.map(({ date }) => date), ["2026-12-08"]);
  assert.equal(result.plan.at(-1).date, "2026-12-08");
});

test("deadline sections supply context for dates without a deadline keyword", () => {
  const result = analyzeBrief("Deadlines\nFinal report: 8 December 2026\nNotes\nClass discussion: 30 November 2026", "2026-11-24");
  assert.deepEqual(result.deadlines.map(({ date }) => date), ["2026-12-08"]);
  assert.equal(result.plan.at(-1).date, "2026-12-08");
  assert.equal(result.tentativePlan, false);
});

test("a dated hand-in remains part of the deliverables block", () => {
  const result = analyzeBrief("Deliverables\n- Report PDF by 8 December\n- Upload your slides\n\nFinal submission due 9 December 2026", "2026-11-24");
  assert.deepEqual(result.deliverables, ["Report PDF by 8 December", "Upload your slides"]);
  assert.deepEqual(result.deadlines.map(({ date }) => date), ["2026-12-08", "2026-12-09"]);
});

test("draft and final deadlines on the same line keep distinct contexts", () => {
  for (const line of [
    "Draft due 1 December 2026; final due 8 December 2026",
    "Draft due December 1, 2026, and the final due December 8, 2026",
  ]) {
    const result = analyzeBrief(line, "2026-11-24");
    assert.deepEqual(result.deadlines.map(({ date }) => date), ["2026-12-01", "2026-12-08"]);
    assert.doesNotMatch(result.deadlines[1].source, /draft/i);
    assert.equal(result.plan.at(-1).date, "2026-12-08");
    assert.match(result.summary, /key deadline: (?:the )?final/i);
  }
});

test("a weekday or time can come between by and a calendar date", () => {
  for (const due of ["Friday 5pm, 12 December", "Friday, 12 December", "5 pm on 12 December"]) {
    const result = analyzeBrief(`Submit the essay by ${due}`, "2026-11-24");
    assert.deepEqual(result.deadlines.map(({ date }) => date), ["2026-12-12"]);
    assert.equal(result.plan.at(-1).date, "2026-12-12");
  }
});

test("background and marked headings end deadline context", () => {
  for (const heading of ["Background", "Overview:", "## Dataset history"]) {
    const result = analyzeBrief(`Deadlines\nFinal report: 8 December 2026\n${heading}\nDataset released 20 November 2026`, "2026-11-24");
    assert.deepEqual(result.deadlines.map(({ date }) => date), ["2026-12-08"]);
    assert.equal(result.plan.at(-1).date, "2026-12-08");
  }
});

test("parenthesized feedback dates retain their optional draft context", () => {
  for (const note of ["feedback by 4 December", "comments are optional; feedback by 4 December"]) {
    const result = analyzeBrief(`Deadlines\nOptional draft 1 December (${note})\nFinal report: 8 December 2026`, "2026-11-24");
    assert.deepEqual(result.deadlines.map(({ date }) => date), ["2026-12-01", "2026-12-04", "2026-12-08"]);
    assert.match(result.deadlines[1].source, /optional draft/i);
    assert.equal(result.plan.at(-1).date, "2026-12-08");
  }
});

test("a standalone deadline closes the deliverables list without a blank line", () => {
  for (const [item, deadline] of [
    ["- Submit your report", "Final report by 8 December 2026"],
    ["Submit your report", "Final report due 8 December 2026"],
  ]) {
    const result = analyzeBrief(`Deliverables\n${item}\n${deadline}\nLate work is not accepted.`, "2026-11-24");
    assert.deepEqual(result.deliverables, ["Submit your report"]);
    assert.deepEqual(result.deadlines.map(({ date }) => date), ["2026-12-08"]);
  }

  const listed = analyzeBrief("Deliverables\n- Submit your report\n- Slides due 8 December 2026", "2026-11-24");
  assert.deepEqual(listed.deliverables, ["Submit your report", "Slides due 8 December 2026"]);
});

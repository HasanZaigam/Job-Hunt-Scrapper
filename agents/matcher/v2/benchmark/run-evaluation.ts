import fs from 'fs';
import path from 'path';
import { gateReason } from '../../../scraper/quality-gate';
import { evaluateHardVeto } from '../hard-veto';
import { buildDecisionLog } from '../decision-log';

// Milestone 1 evaluation: a fixed, hand-labeled dataset spanning the seven
// role archetypes the CTO asked to see proven out (AI Software Engineer,
// Backend Engineer, LLM Engineer, Applied AI Architect, Senior ML Engineer,
// AI Safety Research, Forward Deployed Engineer). For each job this prints
// v1 vs v2's admit/reject decision, v2's hard-veto reason, an interim
// priority label, and whether the decision (and therefore the job's
// position in the pipeline) changed between engines — then writes one
// structured JSON log line per job to disk so every decision is
// independently auditable, not just summarized in this report.

interface EvalJob {
  id: string;
  archetype: string;
  company: string;
  role: string;
  location: string;
  jd_text: string;
  expected_admitted: boolean;
  note: string;
}

function loadDataset(): EvalJob[] {
  const p = path.resolve(__dirname, 'evaluation-set.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function main() {
  const jobs = loadDataset();
  const logLines: string[] = [];

  let v1Correct = 0;
  let v2Correct = 0;
  let rankingChanges = 0;
  const rows: string[] = [];
  const wronglyRejectedGoodJobs: EvalJob[] = [];
  const correctlyRejectedBadJobs: EvalJob[] = [];
  const v1Leaks: EvalJob[] = [];

  for (const job of jobs) {
    const v1Reason = gateReason(job.role, job.jd_text);
    const v1Admitted = !v1Reason;
    const v2 = evaluateHardVeto(job.role, job.jd_text, job.location);
    const v2Admitted = !v2.vetoed;

    const log = buildDecisionLog(job, v1Reason, v2);
    logLines.push(JSON.stringify({ ...log, archetype: job.archetype, expected_admitted: job.expected_admitted }));

    if (v1Admitted === job.expected_admitted) v1Correct++;
    if (v2Admitted === job.expected_admitted) v2Correct++;
    if (log.ranking_changed) rankingChanges++;

    if (job.expected_admitted && !v2Admitted) wronglyRejectedGoodJobs.push(job);
    if (!job.expected_admitted && v2Admitted) correctlyRejectedBadJobs.push(job); // v2 miss, flag loudly
    if (!job.expected_admitted && v1Admitted) v1Leaks.push(job);

    rows.push(
      [
        `[${job.archetype}]`.padEnd(28),
        job.role.padEnd(30),
        `expected=${job.expected_admitted ? 'ADMIT' : 'reject'}`.padEnd(15),
        `v1=${v1Admitted ? 'ADMIT' : 'reject'}${v1Admitted === job.expected_admitted ? '' : ' ✗'}`.padEnd(16),
        `v2=${v2Admitted ? 'ADMIT' : 'reject'}${v2Admitted === job.expected_admitted ? '' : ' ✗'}`.padEnd(16),
        `priority=${log.final_priority}`.padEnd(58),
        `ranking_changed=${log.ranking_changed}`,
      ].join(' | ')
    );
  }

  console.log('\n=== Job Matching v2 — Milestone 2 Evaluation: combined hard-veto gate (role family + experience + location) ===\n');
  console.log(rows.join('\n'));

  console.log('\n--- Per-job hard-veto reasons (v2) ---');
  for (const job of jobs) {
    const v2 = evaluateHardVeto(job.role, job.jd_text, job.location);
    console.log(`  ${job.id}: ${v2.vetoed ? v2.reason : 'passed — ' + (v2.needs_review ? 'flagged for review' : 'no veto')}`);
  }

  const total = jobs.length;
  console.log('\n--- Summary ---');
  console.log(`Dataset size: ${total} jobs across 7 archetypes`);
  console.log(`v1 (current live gate)  accuracy: ${v1Correct}/${total} (${Math.round((v1Correct / total) * 100)}%)`);
  console.log(`v2 (shadow hard veto)   accuracy: ${v2Correct}/${total} (${Math.round((v2Correct / total) * 100)}%)`);
  console.log(`Jobs whose admit/reject decision changed between v1 and v2: ${rankingChanges}/${total}`);

  console.log('\n--- v1 vs v2 disagreement report ---');
  console.log(`Total disagreements: ${rankingChanges}/${total}`);
  console.log(`Out-of-scope roles v1 let through that v2 correctly rejects: ${v1Leaks.length}`);
  for (const j of v1Leaks) console.log(`  - [${j.archetype}] ${j.role} @ ${j.company}: ${j.note}`);

  console.log(`\nGood-fit jobs v2 incorrectly rejected (should be zero): ${wronglyRejectedGoodJobs.length}`);
  for (const j of wronglyRejectedGoodJobs) console.log(`  - [${j.archetype}] ${j.role} @ ${j.company}: ${j.note}`);

  console.log(`\nUnsuitable jobs v2 incorrectly admitted (should be zero): ${correctlyRejectedBadJobs.length}`);
  for (const j of correctlyRejectedBadJobs) console.log(`  - [${j.archetype}] ${j.role} @ ${j.company}: ${j.note}`);

  const outDir = path.resolve(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'evaluation-log.jsonl');
  fs.writeFileSync(outPath, logLines.join('\n') + '\n');
  console.log(`\nStructured decision log (one JSON object per job): ${outPath}`);
}

main();

import { run as runExperienceTests } from './gates/__tests__/experience.test';
import { run as runLocationTests } from './gates/__tests__/location.test';
import { run as runRoleFamilyTests } from './gates/__tests__/role-family.test';
import { run as runSkillTaxonomyTests } from './scoring/__tests__/skill-taxonomy.test';
import { run as runSkillFitTests } from './scoring/__tests__/skill-fit.test';
import { run as runCompensationTests } from './scoring/__tests__/compensation.test';
import { run as runPersistenceTests } from './__tests__/persistence.test';

// Lightweight assertion-based unit test runner — no test framework dependency
// added, since the repo has none today. Distinct from the benchmark scripts:
// these assert individual gate behaviors in isolation; the benchmarks
// measure aggregate v1-vs-v2 accuracy on realistic fixtures.

async function main() {
  const suites: [string, { name: string; passed: boolean; error?: string }[]][] = [
    ['experience gate', runExperienceTests()],
    ['location gate', runLocationTests()],
    ['role-family gate', runRoleFamilyTests()],
    ['skill taxonomy (Skill-Fit V2)', runSkillTaxonomyTests()],
    ['skill-fit weighting (Skill-Fit V2)', runSkillFitTests()],
    ['compensation neutrality (Skill-Fit V2)', runCompensationTests()],
    ['V2 persistence foundation', await runPersistenceTests()],
  ];

  let totalPassed = 0;
  let totalFailed = 0;

  console.log('\n=== Job Matching v2 — Unit Tests ===\n');
  for (const [suiteName, results] of suites) {
    console.log(`${suiteName}:`);
    for (const r of results) {
      if (r.passed) {
        totalPassed++;
        console.log(`  ✓ ${r.name}`);
      } else {
        totalFailed++;
        console.log(`  ✗ ${r.name}`);
        console.log(`    ${r.error}`);
      }
    }
    console.log('');
  }

  console.log(`--- ${totalPassed} passed, ${totalFailed} failed (${totalPassed + totalFailed} total) ---\n`);

  if (totalFailed > 0) {
    process.exitCode = 1;
  }
}

main();

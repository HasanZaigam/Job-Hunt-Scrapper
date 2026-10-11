import { run as runV2Tests } from './v2.test';

// Same lightweight assertion-based runner pattern as
// agents/matcher/v2/run-tests.ts — dashboard has no test framework
// installed today, so this stays dependency-free rather than adding one.

function main() {
  const suites: [string, { name: string; passed: boolean; error?: string }[]][] = [
    ['V2 review dashboard logic (lib/v2.ts)', runV2Tests()],
  ];

  let totalPassed = 0;
  let totalFailed = 0;

  console.log('\n=== Job Hunt Dashboard — Unit Tests ===\n');
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

import { verifyCaptchaSolverConnection } from '../utils/captchaSolver';

async function main(): Promise<void> {
  const status = await verifyCaptchaSolverConnection();

  console.log(`Captcha solver OK: provider=${status.provider}, balance=${status.balance}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Captcha solver test failed: ${message}`);
  process.exit(1);
});

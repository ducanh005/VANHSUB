/** Core regression checks after the fixes. Uses isolated stores, stub TTS and real FFmpeg. */
import { runCoreFlowRegression } from '../tests/test_core_flow_regression';
runCoreFlowRegression().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

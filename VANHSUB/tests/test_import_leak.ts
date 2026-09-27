// tests/test_import_leak.ts
// Test to verify whether importing run_sample_flow_pipeline triggers auto-execution
import '../scripts/run_sample_flow_pipeline';
console.log('UNREACHABLE_BECAUSE_PIPELINE_EXITS_WITH_CODE_0');

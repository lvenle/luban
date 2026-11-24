/** Recording is best effort: it must never change the outcome of an executed tool. */
export async function runWithToolRecord(execute, record, onRecordError = () => {}) {
  let result;
  let failure;
  try { result = await execute(); }
  catch (error) { failure = error; }
  try { await record(failure, result); }
  catch (error) { onRecordError(error); }
  if (failure) throw failure;
  return result;
}

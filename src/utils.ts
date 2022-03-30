import * as bsv from "@sensible-contract/bsv";
const { Script } = bsv;
const { Interpreter } = Script;
const Interp = Interpreter;

const flags =
  Interp.SCRIPT_ENABLE_MAGNETIC_OPCODES |
  Interp.SCRIPT_ENABLE_MONOLITH_OPCODES | // TODO: to be removed after upgrade to bsv 2.0
  Interp.SCRIPT_VERIFY_STRICTENC |
  Interp.SCRIPT_ENABLE_SIGHASH_FORKID |
  Interp.SCRIPT_VERIFY_LOW_S |
  Interp.SCRIPT_VERIFY_NULLFAIL |
  Interp.SCRIPT_VERIFY_DERSIG |
  Interp.SCRIPT_VERIFY_MINIMALDATA |
  Interp.SCRIPT_VERIFY_NULLDUMMY |
  Interp.SCRIPT_VERIFY_DISCOURAGE_UPGRADABLE_NOPS |
  Interp.SCRIPT_VERIFY_CHECKLOCKTIMEVERIFY |
  Interp.SCRIPT_VERIFY_CHECKSEQUENCEVERIFY;

export function verifyTx(tx: bsv.Transaction) {
  let pass = true;
  tx.inputs.forEach((input, inputIndex) => {
    const interpreter = new Interpreter();
    var verified = interpreter.verify(
      input.script,
      input.output.script,
      tx,
      inputIndex,
      flags,
      input.output.satoshisBN
    );
    if (!verified) {
      pass = false;
      console.log("verify:", inputIndex, verified, interpreter.errstr);
    }
  });
  return pass;
}

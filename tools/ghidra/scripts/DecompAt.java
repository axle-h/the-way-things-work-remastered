// Decompile functions at given addresses (creating them if missing). Args: outfile addr...
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.cmd.function.CreateFunctionCmd;
import java.io.*;
public class DecompAt extends GhidraScript {
  public void run() throws Exception {
    String[] a = getScriptArgs();
    PrintWriter pw = new PrintWriter(new FileWriter(a[0]));
    DecompInterface di = new DecompInterface();
    di.openProgram(currentProgram);
    for (int i = 1; i < a.length; i++) {
      Address ad = currentProgram.getAddressFactory().getAddress(a[i]);
      Function f = getFunctionAt(ad);
      if (f == null) {
        new DisassembleCommand(ad, null, true).applyTo(currentProgram, monitor);
        new CreateFunctionCmd(ad).applyTo(currentProgram, monitor);
        f = getFunctionAt(ad);
      }
      if (f == null) { pw.println("/* could not create function at " + a[i] + " */"); continue; }
      DecompileResults r = di.decompileFunction(f, 60, monitor);
      pw.println("/* " + f.getName() + " @ " + f.getEntryPoint() + " */");
      pw.println(r.getDecompiledFunction() != null ? r.getDecompiledFunction().getC() : "/* decompile failed */");
    }
    pw.close();
  }
}

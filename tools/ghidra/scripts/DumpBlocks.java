// Dump each memory block (relocated) to <outdir>/<sel>.bin
import ghidra.app.script.GhidraScript;
import ghidra.program.model.mem.*;
import java.io.*;
public class DumpBlocks extends GhidraScript {
  public void run() throws Exception {
    String out = getScriptArgs()[0];
    new File(out).mkdirs();
    for (MemoryBlock b : currentProgram.getMemory().getBlocks()) {
      if (!b.isInitialized()) continue;
      byte[] buf = new byte[(int)b.getSize()];
      b.getBytes(b.getStart(), buf);
      String name = b.getStart().toString().replace(":", "_");
      try (FileOutputStream f = new FileOutputStream(out + "/" + name + ".bin")) { f.write(buf); }
      println(b.getName() + " " + b.getStart() + " " + buf.length);
    }
  }
}

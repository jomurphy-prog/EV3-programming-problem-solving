// ==========================================
// 1. GLOBAL VARIABLES & UI SETUP
// ==========================================
let currentFileName = "MyProgram";

// Wait for the HTML to fully load before attaching UI elements
document.addEventListener('DOMContentLoaded', () => {
  const renameBtn = document.getElementById('renameBtn');
  const fileNameDisplay = document.getElementById('fileNameDisplay');

  if (renameBtn && fileNameDisplay) {
    renameBtn.addEventListener('click', () => {
      let userInput = prompt("Enter a name for your EV3 program (no spaces):", currentFileName);
      if (userInput !== null && userInput.trim() !== "") {
        // Strip out dangerous characters
        let safeName = userInput.replace(/[^a-zA-Z0-9_-]/g, '');
        if (safeName === "") safeName = "MyProgram";
        
        currentFileName = safeName;
        fileNameDisplay.innerText = currentFileName + ".rbf";
      }
    });
  }
});

// ==========================================
// 2. BLOCKLY COMPILER SETUP
// ==========================================
const ev3Compiler = new Blockly.Generator('EV3');

// Tells Blockly how to traverse down a stack of connected blocks
ev3Compiler.scrub_ = function(block, code, opt_thisOnly) {
  const nextBlock = block.nextConnection && block.nextConnection.targetBlock();
  const nextCode = opt_thisOnly ? '' : ev3Compiler.blockToCode(nextBlock);
  return code + nextCode; 
};

// Helper: Calculates 16-bit jump offsets (Handles Two's Complement for backward loops)
function getOffsetHex(offset) {
  let val = offset < 0 ? 65536 + offset : offset;
  let low = "0x" + (val & 0xFF).toString(16).padStart(2, '0').toUpperCase();
  let high = "0x" + ((val >> 8) & 0xFF).toString(16).padStart(2, '0').toUpperCase();
  return `${low}, ${high}`;
}

// ==========================================
// 3. BLOCK GENERATORS
// ==========================================

// Custom Motor Start
ev3Compiler.forBlock['ev3_motor_custom'] = function(block) { 
  const port = block.getFieldValue('PORT');
  let speed = 50;
  let target = block.getInputTargetBlock('SPEED');
  if (target && target.type === 'math_number') { speed = parseInt(target.getFieldValue('NUM')); }
  let speedByte = speed < 0 ? 256 + speed : speed;
  let speedHex = "0x" + speedByte.toString(16).padStart(2, '0').toUpperCase();
  // 0xA4 (Speed), 0xA6 (Start)
  return `0xA4, 0x00, ${port}, 0x81, ${speedHex}, 0xA6, 0x00, ${port}, `;
};

// Motor Stop
ev3Compiler.forBlock['ev3_motor_stop'] = function(block) { 
  const port = block.getFieldValue('PORT'); 
  // 0xA3 (Stop), 0x01 (Brake)
  return `0xA3, 0x00, ${port}, 0x01, `; 
};

// Wait (Uses Protected Local Variable 8 to prevent sensor poisoning)
ev3Compiler.forBlock['ev3_wait'] = function(block) { 
  return "0x85, 0x83, 0xE8, 0x03, 0x00, 0x00, 0x48, 0x86, 0x48, "; 
};

// Beep
ev3Compiler.forBlock['ev3_beep'] = function(block) { 
  return "0x94, 0x01, 0x81, 0x32, 0x82, 0xE8, 0x03, 0x82, 0xE8, 0x03, 0x96, "; 
};

// Infinite Loop
ev3Compiler.forBlock['ev3_infinite_loop'] = function(block) {
  let doCode = ev3Compiler.statementToCode(block, 'DO');
  let doBytes = doCode.split(',').filter(s => s.trim().length > 0).length;
  let offset = -(doBytes + 4); 
  let jumpCode = `0x27, 0x82, ${getOffsetHex(offset)}, `;
  return doCode + jumpCode;
};

// Sensor Logic (Optimized AST branching)
ev3Compiler.forBlock['ev3_sensor_logic'] = function(block) {
  const port = block.getFieldValue('PORT');
  const operator = block.getFieldValue('OPERATOR');
  const threshold = block.getFieldValue('THRESHOLD');
  
  let doCode = ev3Compiler.statementToCode(block, 'DO');
  let elseCode = ev3Compiler.statementToCode(block, 'ELSE');

  let doBytes = doCode.split(',').filter(s => s.trim().length > 0).length;
  let elseBytes = elseCode.split(',').filter(s => s.trim().length > 0).length;

  let threshHex = "0x" + parseInt(threshold).toString(16).padStart(2, '0').toUpperCase();
  let opCode = operator === "LT" ? "0x6D" : "0x6E"; 

  // Read Sensor to Local Var 0 (0x40), Compare Threshold to Local Var 4 (0x44)
  let readCode = `0x9A, 0x00, 0x0${port}, 0x00, 0x00, 0x40, `;
  let compareCode = `${opCode}, 0x40, 0x81, ${threshHex}, 0x44, `;

  // OPTIMIZATION 1: No inner blocks
  if (doBytes === 0 && elseBytes === 0) {
    return readCode + compareCode;
  }
  // OPTIMIZATION 2: Only DO block exists
  if (elseBytes === 0) {
    let jumpIfFalseCode = `0x29, 0x44, 0x82, ${getOffsetHex(doBytes)}, `;
    return readCode + compareCode + jumpIfFalseCode + doCode;
  }
  // OPTIMIZATION 3: Only ELSE block exists
  if (doBytes === 0) {
    let jumpIfTrueCode = `0x28, 0x44, 0x82, ${getOffsetHex(elseBytes)}, `;
    return readCode + compareCode + jumpIfTrueCode + elseCode;
  }

  // STANDARD: Both DO and ELSE exist
  let skipElseCode = `0x27, 0x82, ${getOffsetHex(elseBytes)}, `;
  let jumpIfFalseCode = `0x29, 0x44, 0x82, ${getOffsetHex(doBytes + 4)}, `;

  return readCode + compareCode + jumpIfFalseCode + doCode + skipElseCode + elseCode;
};

// ==========================================
// 4. COMPILATION & UPLOAD LOGIC
// ==========================================
function compileAndUpload() {
  // 1. Compile Workspace
  let compiledString = ev3Compiler.workspaceToCode(workspace);
  if (!compiledString || compiledString.trim() === "") { 
    console.error("Workspace is empty!");
    return;
  }
  
  // 2. Append Graceful Shutdown BEFORE array conversion
  // 0x02 (opPROGRAM_STOP), 0x0A (End of File)
  compiledString += "0x02, 0x0A, ";
  
  const byteStringArray = compiledString.split(',').filter(s => s.trim().length > 0);
  const instructions = new Uint8Array(byteStringArray.map(s => parseInt(s.trim(), 16)));
  
  // 3. Build 28-Byte LEGO Header
  const prefix = new Uint8Array([
    0x4C, 0x45, 0x47, 0x4F, // 'LEGO'
    0x00, 0x00, 0x00, 0x00, // Total file size (Calculated below)
    0x04, 0x01,             // Bytecode Version 1.04
    0x01, 0x00,             // 1 Object
    0x40, 0x00, 0x00, 0x00, // Global Memory Size (64 bytes)
    0x40, 0x00, 0x00, 0x00, // Local Memory Size (64 bytes)
    0x00, 0x00, 0x00, 0x00  // IP Offset (0)
  ]);
  
  // 4. Calculate final size and inject into header (Bytes 4-7)
  const totalSize = prefix.length + instructions.length; 
  prefix[4] = totalSize & 0xFF; 
  prefix[5] = (totalSize >> 8) & 0xFF;
  prefix[6] = (totalSize >> 16) & 0xFF; 
  prefix[7] = (totalSize >> 24) & 0xFF;
  
  // 5. Combine into final .rbf buffer
  const rbf = new Uint8Array(totalSize);
  rbf.set(prefix, 0);
  rbf.set(instructions, prefix.length);

  // 6. Setup Path & Upload Using Dynamic Name
  const filename = currentFileName + ".rbf";
  const ev3Path = "../prjs/BrkProg_SAVE/" + filename + "\0";
  const pathBytes = new TextEncoder().encode(ev3Path);

  // -> Pass `rbf` and `pathBytes` to your Web Bluetooth / WebUSB write function here!
  console.log(`Successfully compiled ${filename} (${totalSize} bytes)`);
}

// Hook up your specific Upload Button
const uploadBtn = document.getElementById('uploadBtn'); // Update ID if necessary
if (uploadBtn) {
  uploadBtn.addEventListener('click', compileAndUpload);
}

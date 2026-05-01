let port;
let writer;
let reader;

let msgIdCounter = 1;
const pendingRequests = new Map();
let inputBuffer = new Uint8Array(0);

const connectBtn = document.getElementById('connectBtn');
const runBtn = document.getElementById('runBtn');
const uploadBtn = document.getElementById('uploadBtn');
const statusDiv = document.getElementById('status');

// --- MODAL LOGIC ---
const helpBtn = document.getElementById('helpBtn');
const instructionsModal = document.getElementById('instructionsModal');
const closeModalBtn = document.getElementById('closeModalBtn');

// Open the modal
helpBtn.addEventListener('click', () => {
  instructionsModal.style.display = 'block';
});

// Close the modal when clicking the 'X'
closeModalBtn.addEventListener('click', () => {
  instructionsModal.style.display = 'none';
});

// Close the modal when clicking outside the white box
window.addEventListener('click', (event) => {
  if (event.target === instructionsModal) {
    instructionsModal.style.display = 'none';
  }
});

// --- DUAL BRIDGE: USB WEBHID CONNECTION ---
const connectUsbBtn = document.getElementById('connectUsbBtn');
let hidDevice = null;

connectUsbBtn.addEventListener('click', async () => {
  try {
    // 1. Request the EV3 specifically using its LEGO Vendor ID and Product ID
    const devices = await navigator.hid.requestDevice({
      filters: [{ vendorId: 0x0694, productId: 0x0005 }]
    });

    if (devices.length > 0) {
      hidDevice = devices[0];
      await hidDevice.open();
      
      statusDiv.innerText = "Status: USB Connected!";
      statusDiv.style.color = "green";
      
      // Enable the coding buttons
      document.getElementById('uploadBtn').disabled = false;
      document.getElementById('runBtn').disabled = false;

      // 2. Listen for replies from the EV3
      hidDevice.addEventListener('inputreport', (event) => {
        // event.data is a DataView containing the EV3's reply
        const replyBytes = new Uint8Array(event.data.buffer);
        console.log("EV3 USB Reply:", replyBytes);
        // (You can wire this into any success/error checking you do later!)
      });
    }
  } catch (err) {
    statusDiv.innerText = "Status: USB Connection Failed.";
    statusDiv.style.color = "red";
    console.error("WebHID Error:", err);
  }
});

// --- BLUETOOTH CONNECTION ---
connectBtBtn.addEventListener('click', async () => {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    writer = port.writable.getWriter();
    listenToPort(); 

    statusDiv.innerText = "Status: Connected and Listening!";
    statusDiv.style.color = "green";
    runBtn.disabled = false;
    uploadBtn.disabled = false; 
    connectBtn.disabled = true;
  } catch (error) {
    statusDiv.innerText = "Status: Connection Failed";
    statusDiv.style.color = "red";
    console.error(error); 
  }
});

// Global variable to store the clean file name
let currentFileName = "MyProgram";

const renameBtn = document.getElementById('renameBtn');
const fileNameDisplay = document.getElementById('fileNameDisplay');

renameBtn.addEventListener('click', () => {
  let userInput = prompt("Enter a name for your EV3 program (no spaces):", currentFileName);
  if (userInput !== null && userInput.trim() !== "") {
    let safeName = userInput.replace(/[^a-zA-Z0-9_-]/g, '');
    if (safeName === "") {
      safeName = "MyProgram";
    }
    currentFileName = safeName;
    fileNameDisplay.innerText = currentFileName + ".rbf";
  }
});

async function listenToPort() {
  reader = port.readable.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      let temp = new Uint8Array(inputBuffer.length + value.length);
      temp.set(inputBuffer);
      temp.set(value, inputBuffer.length);
      inputBuffer = temp;
      while (inputBuffer.length >= 2) {
        let msgLength = inputBuffer[0] + (inputBuffer[1] << 8);
        let totalLength = msgLength + 2; 
        if (inputBuffer.length >= totalLength) {
          let msg = inputBuffer.slice(0, totalLength);
          inputBuffer = inputBuffer.slice(totalLength); 
          if (msg.length >= 5) {
            let msgId = msg[2] + (msg[3] << 8);
            if (pendingRequests.has(msgId)) {
              let resolve = pendingRequests.get(msgId);
              pendingRequests.delete(msgId);
              resolve(msg); 
            }
          }
        } else { break; }
      }
    }
  } catch (e) {
    console.error("Reader loop error:", e);
  } finally {
    reader.releaseLock();
  }
}

//async function sendEV3Command(byteArray) {
//  if (!writer) return;
//  await writer.write(byteArray);
//  await new Promise(resolve => setTimeout(resolve, 50)); 
// }

// --- MASTER DATA SENDER ---
async function sendToEV3(byteArray) {
  if (hidDevice && hidDevice.opened) {
    // === USB HID ROUTE ===
    // The EV3 requires USB reports to be EXACTLY 1024 bytes long.
    // We create a blank 1024-byte array and paste our compiled code at the very beginning.
    const paddedArray = new Uint8Array(1024);
    paddedArray.set(byteArray, 0); 

    // Send via Report ID 0
    await hidDevice.sendReport(0, paddedArray);
    console.log("Sent via USB (Padded to 1024 bytes)");

  } else if (port) { // Assuming 'port' is your existing Web Serial variable
    // === BLUETOOTH SERIAL ROUTE ===
    const writer = port.writable.getWriter();
    await writer.write(new Uint8Array(byteArray));
    writer.releaseLock();
    console.log("Sent via Bluetooth Serial");
    
  } else {
    alert("No EV3 connected! Please connect via USB or Bluetooth.");
  }
}

async function readSensor(portIndex) {
  let msgId = msgIdCounter++;
  let bytecode = new Uint8Array([ 0x0D, 0x00, msgId & 0xFF, (msgId >> 8) & 0xFF, 0x00, 0x04, 0x00, 0x99, 0x1D, 0x00, portIndex, 0x00, 0x00, 0x01, 0x60 ]);
  let replyPromise = new Promise(resolve => {
    pendingRequests.set(msgId, resolve);
    setTimeout(() => { if (pendingRequests.has(msgId)) { pendingRequests.delete(msgId); resolve(null); } }, 1000);
  });
  await sendtoEV3(byteArray);
  let msg = await replyPromise;
  if (msg && msg[4] === 0x02 && msg.length >= 9) {
    let view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
    return view.getFloat32(5, true); 
  }
  return 0;
}

// --- 2. DEFINE CUSTOM BLOCKS ---
Blockly.Blocks['ev3_beep'] = { init: function() { this.appendDummyInput().appendField("Play EV3 Beep"); this.setPreviousStatement(true, null); this.setNextStatement(true, null); this.setColour(230); } };
Blockly.Blocks['ev3_wait'] = {
  init: function() {
    this.appendDummyInput()
        .appendField("Wait")
        .appendField(new Blockly.FieldNumber(1000, 1), "MS")
        .appendField("ms");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(120);
    this.setTooltip("Pauses the program for the specified number of milliseconds (1000 ms = 1 second).");
  }
};
Blockly.Blocks['ev3_motor_custom'] = { init: function() { this.appendDummyInput().appendField("Start Motor").appendField(new Blockly.FieldDropdown([ ["A", "0x01"], ["B", "0x02"], ["C", "0x04"], ["D", "0x08"], ["A+B", "0x03"] ]), "PORT"); this.appendValueInput("SPEED").setCheck("Number").appendField("at speed"); this.setInputsInline(true); this.setPreviousStatement(true, null); this.setNextStatement(true, null); this.setColour(60); } };
Blockly.Blocks['ev3_motor_stop'] = { init: function() { this.appendDummyInput().appendField("Stop Motor").appendField(new Blockly.FieldDropdown([ ["A", "0x01"], ["B", "0x02"], ["C", "0x04"], ["D", "0x08"], ["All", "0x0F"] ]), "PORT"); this.setPreviousStatement(true, null); this.setNextStatement(true, null); this.setColour(60); } };

Blockly.Blocks['ev3_repeat_times'] = {
  init: function() {
    this.appendDummyInput()
        .appendField("Repeat")
        .appendField(new Blockly.FieldNumber(5, 1, 100), "TIMES")
        .appendField("Times");
    this.appendStatementInput("DO")
        .setCheck(null);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(120);
    this.setTooltip("Repeats the enclosed blocks a specific number of times.");
  }
};

Blockly.Blocks['ev3_touch_logic'] = {
  init: function() {
    this.appendDummyInput()
        .appendField("If Touch Sensor Port")
        .appendField(new Blockly.FieldDropdown([["1","0"], ["2","1"], ["3","2"], ["4","3"]]), "PORT")
        .appendField("is")
        .appendField(new Blockly.FieldDropdown([["Pressed","PRESSED"], ["Released","RELEASED"]]), "STATE");
    this.appendStatementInput("DO")
        .setCheck(null)
        .appendField("Do");
    this.appendStatementInput("ELSE")
        .setCheck(null)
        .appendField("Else");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(210);
    this.setTooltip("Executes blocks based on whether the touch sensor is pressed or released.");
  }
};

Blockly.Blocks['ev3_ultrasonic_logic'] = {
  init: function() {
    this.appendDummyInput()
        .appendField("If Ultrasonic Port")
        .appendField(new Blockly.FieldDropdown([["1","0"], ["2","1"], ["3","2"], ["4","3"]]), "PORT")
        .appendField("Distance")
        .appendField(new Blockly.FieldDropdown([["<","LT"], [">","GT"]]), "OPERATOR")
        .appendField(new Blockly.FieldNumber(15, 0, 100), "THRESHOLD")
        .appendField("cm");
    this.appendStatementInput("DO")
        .setCheck(null)
        .appendField("Do");
    this.appendStatementInput("ELSE")
        .setCheck(null)
        .appendField("Else");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(210);
    this.setTooltip("Reads the ultrasonic sensor in centimeters and executes logic.");
  }
};

Blockly.Blocks['ev3_sensor_logic'] = {
  init: function() {
    this.appendDummyInput()
        .appendField("If Color Sensor Port")
        .appendField(new Blockly.FieldDropdown([["1","0"], ["2","1"], ["3","2"], ["4","3"]]), "PORT")
        .appendField("Reflected Light")
        .appendField(new Blockly.FieldDropdown([["<","LT"], [">","GT"]]), "OPERATOR")
        .appendField(new Blockly.FieldNumber(45, 0, 100), "THRESHOLD")
        .appendField("%");
    this.appendStatementInput("DO").setCheck(null).appendField("Do");
    this.appendStatementInput("ELSE").setCheck(null).appendField("Else");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(210);
    this.setTooltip("Reads the color sensor and executes blocks based on the light percentage.");
  }
};

Blockly.Blocks['ev3_infinite_loop'] = {
  init: function() {
    this.appendDummyInput().appendField("Repeat Forever");
    this.appendStatementInput("DO").setCheck(null);
    this.setPreviousStatement(true, null);
    this.setColour(120);
    this.setTooltip("Repeats the blocks inside forever.");
  }
};

// --- 3. GENERATORS (TETHERED JS) ---
const generator = javascript.javascriptGenerator;
generator.forBlock['ev3_beep'] = function(block) { return `await sendCommand(new Uint8Array([0x0F, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x94, 0x01, 0x81, 0x32, 0x82, 0xE8, 0x03, 0x82, 0xE8, 0x03]));\n`; };

generator.forBlock['ev3_wait'] = function(block) { 
  const ms = block.getFieldValue('MS');
  return `await new Promise(resolve => setTimeout(resolve, ${ms}));\n`; 
};
generator.forBlock['ev3_motor_custom'] = function(block) { const portString = block.getFieldValue('PORT'); const speedCode = generator.valueToCode(block, 'SPEED', javascript.Order.NONE) || '50'; return `await (async () => { let portMask = parseInt("${portString}", 16); let speed = Math.max(-100, Math.min(100, Math.round(${speedCode}))); let speedByte = speed < 0 ? 256 + speed : speed; await sendCommand(new Uint8Array([0x0D, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0xA4, 0x00, portMask, 0x81, speedByte, 0xA6, 0x00, portMask])); })();\n`; };
generator.forBlock['ev3_motor_stop'] = function(block) { const portString = block.getFieldValue('PORT'); return `await (async () => { let portMask = parseInt("${portString}", 16); await sendCommand(new Uint8Array([0x09, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0xA3, 0x00, portMask, 0x01])); })();\n`; };
generator.forBlock['ev3_touch'] = function(block) { const port = block.getFieldValue('PORT'); const code = `(await readSensor(${port}) === 1)`; return [code, javascript.Order.ATOMIC]; };

// --- 4. GENERATORS (UNTETHERED HEX COMPILER) ---
const ev3Compiler = new Blockly.Generator('EV3Compiler');

function getOffsetHex(offset) {
  let val = offset < 0 ? 65536 + offset : offset;
  let low = "0x" + (val & 0xFF).toString(16).padStart(2, '0').toUpperCase();
  let high = "0x" + ((val >> 8) & 0xFF).toString(16).padStart(2, '0').toUpperCase();
  return `${low}, ${high}`;
}

ev3Compiler.scrub_ = function(block, code, opt_thisOnly) {
  const nextBlock = block.nextConnection && block.nextConnection.targetBlock();
  const nextCode = opt_thisOnly ? '' : ev3Compiler.blockToCode(nextBlock);
  return code + nextCode; 
};

ev3Compiler.forBlock['ev3_beep'] = function(block) { 
  return "0x94, 0x01, 0x81, 0x32, 0x82, 0xE8, 0x03, 0x82, 0xE8, 0x03, 0x96, "; 
};

ev3Compiler.forBlock['ev3_ultrasonic_logic'] = function(block) {
  const port = block.getFieldValue('PORT');
  const operator = block.getFieldValue('OPERATOR');
  const threshold = block.getFieldValue('THRESHOLD');
  
  let doCode = ev3Compiler.statementToCode(block, 'DO');
  let elseCode = ev3Compiler.statementToCode(block, 'ELSE');

  let doBytes = doCode.split(',').filter(s => s.trim().length > 0).length;
  let elseBytes = elseCode.split(',').filter(s => s.trim().length > 0).length;

  let threshHex = "0x" + parseInt(threshold).toString(16).padStart(2, '0').toUpperCase();
  
  // The TRUE EV3 8-bit math opcodes: 0x44 (LT8), 0x48 (GT8)
  let opCode = operator === "LT" ? "0x44" : "0x48"; 

  // Read Sensor: Hardware Type 0x1E (Ultrasonic), Mode 0 (Centimeters)
  let readCode = `0x9A, 0x00, 0x0${port}, 0x1E, 0x00, 0x40, `;
  let compareCode = `${opCode}, 0x40, 0x81, ${threshHex}, 0x44, `;

  // Smart AST Jumps
  if (doBytes === 0 && elseBytes === 0) {
    return readCode + compareCode;
  }
  if (elseBytes === 0) {
    let jumpIfFalseCode = `0x41, 0x44, 0x82, ${getOffsetHex(doBytes)}, `;
    return readCode + compareCode + jumpIfFalseCode + doCode;
  }
  if (doBytes === 0) {
    let jumpIfTrueCode = `0x42, 0x44, 0x82, ${getOffsetHex(elseBytes)}, `;
    return readCode + compareCode + jumpIfTrueCode + elseCode;
  }

  let skipElseCode = `0x40, 0x82, ${getOffsetHex(elseBytes)}, `;
  let jumpIfFalseCode = `0x41, 0x44, 0x82, ${getOffsetHex(doBytes + 4)}, `;

  return readCode + compareCode + jumpIfFalseCode + doCode + skipElseCode + elseCode;
};

// Loop "unroller" generator
ev3Compiler.forBlock['ev3_repeat_times'] = function(block) {
  // Grab the number of times to repeat
  const times = parseInt(block.getFieldValue('TIMES'));
  
  // Translate whatever blocks are inside the loop
  let doCode = ev3Compiler.statementToCode(block, 'DO');
  
  // Compiler Optimization: Loop Unrolling
  let unrolledCode = "";
  for (let i = 0; i < times; i++) {
    unrolledCode += doCode;
  }

  return unrolledCode;
};

// The Infinite Loop Generator
ev3Compiler.forBlock['ev3_infinite_loop'] = function(block) {
  let doCode = ev3Compiler.statementToCode(block, 'DO');
  let doBytes = doCode.split(',').filter(s => s.trim().length > 0).length;
  let offset = -(doBytes + 4); 
  
  // 0x40 is the TRUE EV3 opcode for opJR (Jump Unconditional)
  let jumpCode = `0x40, 0x82, ${getOffsetHex(offset)}, `;
  
  return doCode + jumpCode;
}

// The Dynamic 32-Bit Memory Wait
ev3Compiler.forBlock['ev3_wait'] = function(block) { 
  // 1. Grab the milliseconds from the block
  const ms = parseInt(block.getFieldValue('MS'));

  // 2. Convert to 32-bit Little-Endian Hex (Lowest byte first, highest byte last)
  let b0 = "0x" + (ms & 0xFF).toString(16).padStart(2, '0').toUpperCase();
  let b1 = "0x" + ((ms >> 8) & 0xFF).toString(16).padStart(2, '0').toUpperCase();
  let b2 = "0x" + ((ms >> 16) & 0xFF).toString(16).padStart(2, '0').toUpperCase();
  let b3 = "0x" + ((ms >>> 24) & 0xFF).toString(16).padStart(2, '0').toUpperCase();

  // 3. Inject the dynamic time bytes into the wait sequence
  // 0x85 (Wait), 0x83 (32-bit Constant Flag), [Time], 0x48 (Save to Mem), 0x86 (Ready), 0x48 (Halt Thread)
  return `0x85, 0x83, ${b0}, ${b1}, ${b2}, ${b3}, 0x48, 0x86, 0x48, `; 
};

// Touch sensor block generator
ev3Compiler.forBlock['ev3_touch_logic'] = function(block) {
  const port = block.getFieldValue('PORT');
  const state = block.getFieldValue('STATE');
  
  let doCode = ev3Compiler.statementToCode(block, 'DO');
  let elseCode = ev3Compiler.statementToCode(block, 'ELSE');

  let doBytes = doCode.split(',').filter(s => s.trim().length > 0).length;
  let elseBytes = elseCode.split(',').filter(s => s.trim().length > 0).length;

  // 1. Read Sensor: Hardware Type 0x10 (Touch Sensor)
  let readCode = `0x9A, 0x00, 0x0${port}, 0x10, 0x00, 0x40, `;
  
  // 2. Evaluate State
  let compareCode = "";
  if (state === "PRESSED") {
    // 0x48 (opCP_GT8): Is Memory 0x40 > 0? Save boolean to 0x44
    compareCode = `0x48, 0x40, 0x81, 0x00, 0x44, `; 
  } else {
    // 0x44 (opCP_LT8): Is Memory 0x40 < 1? Save boolean to 0x44
    compareCode = `0x44, 0x40, 0x81, 0x01, 0x44, `; 
  }

  // 3. Smart AST Jumps (Identical to the Color Sensor!)
  if (doBytes === 0 && elseBytes === 0) {
    return readCode + compareCode;
  }
  if (elseBytes === 0) {
    let jumpIfFalseCode = `0x41, 0x44, 0x82, ${getOffsetHex(doBytes)}, `;
    return readCode + compareCode + jumpIfFalseCode + doCode;
  }
  if (doBytes === 0) {
    let jumpIfTrueCode = `0x42, 0x44, 0x82, ${getOffsetHex(elseBytes)}, `;
    return readCode + compareCode + jumpIfTrueCode + elseCode;
  }

  let skipElseCode = `0x40, 0x82, ${getOffsetHex(elseBytes)}, `;
  let jumpIfFalseCode = `0x41, 0x44, 0x82, ${getOffsetHex(doBytes + 4)}, `;

  return readCode + compareCode + jumpIfFalseCode + doCode + skipElseCode + elseCode;
};

// The Sensor Logic Generator
ev3Compiler.forBlock['ev3_sensor_logic'] = function(block) {
  const port = block.getFieldValue('PORT');
  const operator = block.getFieldValue('OPERATOR');
  const threshold = block.getFieldValue('THRESHOLD');
  
  let doCode = ev3Compiler.statementToCode(block, 'DO');
  let elseCode = ev3Compiler.statementToCode(block, 'ELSE');

  let doBytes = doCode.split(',').filter(s => s.trim().length > 0).length;
  let elseBytes = elseCode.split(',').filter(s => s.trim().length > 0).length;

  let threshHex = "0x" + parseInt(threshold).toString(16).padStart(2, '0').toUpperCase();
  
  // The TRUE EV3 8-bit opcodes: 0x44 (LT8), 0x48 (GT8)
  let opCode = operator === "LT" ? "0x44" : "0x48"; 

  let readCode = `0x9A, 0x00, 0x0${port}, 0x1D, 0x00, 0x40, `;
  let compareCode = `${opCode}, 0x40, 0x81, ${threshHex}, 0x44, `;

  // 0x40 (Jump), 0x41 (Jump if False), 0x42 (Jump if True)
  if (doBytes === 0 && elseBytes === 0) {
    return readCode + compareCode;
  }
  if (elseBytes === 0) {
    let jumpIfFalseCode = `0x41, 0x44, 0x82, ${getOffsetHex(doBytes)}, `;
    return readCode + compareCode + jumpIfFalseCode + doCode;
  }
  if (doBytes === 0) {
    let jumpIfTrueCode = `0x42, 0x44, 0x82, ${getOffsetHex(elseBytes)}, `;
    return readCode + compareCode + jumpIfTrueCode + elseCode;
  }

  let skipElseCode = `0x40, 0x82, ${getOffsetHex(elseBytes)}, `;
  let jumpIfFalseCode = `0x41, 0x44, 0x82, ${getOffsetHex(doBytes + 4)}, `;

  return readCode + compareCode + jumpIfFalseCode + doCode + skipElseCode + elseCode;
};

ev3Compiler.forBlock['ev3_motor_stop'] = function(block) { 
  const port = block.getFieldValue('PORT'); 
  return `0xA3, 0x00, ${port}, 0x81, 0x01, `; 
};

ev3Compiler.forBlock['ev3_motor_custom'] = function(block) { 
  const port = block.getFieldValue('PORT');
  let speed = 50;
  let target = block.getInputTargetBlock('SPEED');
  if (target && target.type === 'math_number') { speed = parseInt(target.getFieldValue('NUM')); }
  let speedByte = speed < 0 ? 256 + speed : speed;
  let speedHex = "0x" + speedByte.toString(16).padStart(2, '0').toUpperCase();
  return `0xA4, 0x00, ${port}, 0x81, ${speedHex}, 0xA6, 0x00, ${port}, `;
};

ev3Compiler.forBlock['ev3_touch'] = function() { return ""; }; 

function compileToRBF(instructions) {
  const prefix = new Uint8Array([
    0x4C, 0x45, 0x47, 0x4F, // "LEGO" 
    0x00, 0x00, 0x00, 0x00, // File size
    0x04, 0x01,             // Version 1.04
    0x01, 0x00,             // 1 Object
    0x40, 0x00, 0x00, 0x00, // Global Memory (64 bytes)
    0x1C, 0x00, 0x00, 0x00, // Offset 
    0x00, 0x00,             // Owner
    0x00, 0x00,             // Trigger count
    0x40, 0x00, 0x00, 0x00  // Local Memory (64 bytes)
  ]);
  
  const totalSize = prefix.length + instructions.length; 
  
  prefix[4] = totalSize & 0xFF; 
  prefix[5] = (totalSize >> 8) & 0xFF;
  prefix[6] = (totalSize >> 16) & 0xFF; 
  prefix[7] = (totalSize >> 24) & 0xFF;
  
  const rbf = new Uint8Array(totalSize);
  rbf.set(prefix, 0);
  rbf.set(instructions, prefix.length);
  
  return rbf;
}

// --- 5. INJECT BLOCKLY WORKSPACE ---
const workspace = Blockly.inject('blocklyDiv', { toolbox: document.getElementById('toolbox'), scrollbars: true, trashcan: true });

// --- 6. EXECUTE (TETHERED) ---
runBtn.addEventListener('click', async () => {
  if (!writer) return;
  statusDiv.innerText = "Status: Running Tethered..."; statusDiv.style.color = "blue";
  try {
    const generatedCode = generator.workspaceToCode(workspace);
    const executeBlocks = new Function('sendCommand', 'readSensor', `return (async () => { try { ${generatedCode} } catch (err) { throw err; } })();`);
    await executeBlocks(sendToEV3, readSensor);
    statusDiv.innerText = "Status: Tethered Execution Complete!"; statusDiv.style.color = "green";
  } catch (error) {
    statusDiv.innerText = "Status: Runtime Error - " + error.message; statusDiv.style.color = "red";
  }
});

// --- 8. SAVE & LOAD WORKSPACE (LOCAL JSON) ---

const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');
const loadInput = document.getElementById('loadInput');

// SAVE BLOCKS
saveBtn.addEventListener('click', () => {
  try {
    // 1. Ask Blockly to extract the current state as a JSON object
    const state = Blockly.serialization.workspaces.save(workspace);
    const stateString = JSON.stringify(state, null, 2); // Pretty-print JSON

    // 2. Create a virtual file (Blob) containing the JSON data
    const blob = new Blob([stateString], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    // 3. Create a temporary, invisible link and "click" it to trigger the download
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFileName + "_blocks.json"; 
    document.body.appendChild(a);
    a.click();
    
    // 4. Clean up the invisible link
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    statusDiv.innerText = "Status: Workspace Saved Locally!";
    statusDiv.style.color = "green";
  } catch (err) {
    statusDiv.innerText = "Status: Failed to save workspace.";
    statusDiv.style.color = "red";
    console.error(err);
  }
});

// LOAD BLOCKS (Trigger the hidden file input)
loadBtn.addEventListener('click', () => {
  loadInput.click();
});

// LOAD BLOCKS (Process the file once selected)
loadInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  
  // What to do when the file finishes reading:
  reader.onload = function(e) {
    try {
      const stateString = e.target.result;
      const state = JSON.parse(stateString);
      
      // 1. Clear the current workspace
      workspace.clear();
      
      // 2. Inject the saved blocks
      Blockly.serialization.workspaces.load(state, workspace);
      
      // 3. Update the UI filename based on the uploaded file (remove the _blocks.json part)
      let cleanName = file.name.replace("_blocks.json", "").replace(".json", "");
      currentFileName = cleanName;
      document.getElementById('fileNameDisplay').innerText = currentFileName + ".rbf";
      
      statusDiv.innerText = "Status: Workspace Loaded!";
      statusDiv.style.color = "green";
    } catch (err) {
      statusDiv.innerText = "Status: Invalid File Format.";
      statusDiv.style.color = "red";
      console.error(err);
    }
  };
  
  // Start reading the file as text
  reader.readAsText(file);
  
  // Reset the input so the user can load the exact same file again later if they want to revert
  event.target.value = '';
});

// --- 7. COMPILE & UPLOAD (UNTETHERED) ---
uploadBtn.addEventListener('click', async () => {
  try {
    statusDiv.innerText = "Status: Compiling Code..."; statusDiv.style.color = "blue";
    
    let compiledString = ev3Compiler.workspaceToCode(workspace);
    if (!compiledString || compiledString.trim() === "") { throw new Error("Workspace is empty!"); }
    
    // Add graceful shutdown right before compiling to binary, we safely tell all motors (Port 0x0F) to Brake (0x01), then cleanly end the file (0x0A).
    compiledString += "0xA3, 0x00, 0x0F, 0x01, 0x0A, ";
    
    const byteStringArray = compiledString.split(',').filter(s => s.trim().length > 0);
    const rawInstructions = new Uint8Array(byteStringArray.map(s => parseInt(s.trim(), 16)));
        
    const dataBytes = compileToRBF(rawInstructions);
    const fileSize = dataBytes.length;
    
    const filename = currentFileName + ".rbf"; 
    
    const ev3Path = "../prjs/BrkProg_SAVE/" + filename + "\0";
    const pathBytes = new TextEncoder().encode(ev3Path);

    statusDiv.innerText = "Status: Uploading (Allocating Space)...";
    let msgId1 = msgIdCounter++;
    let beginLen = 2 + 1 + 1 + 4 + pathBytes.length; 
    let beginCmd = new Uint8Array(2 + beginLen);
    beginCmd[0] = beginLen & 0xFF; beginCmd[1] = (beginLen >> 8) & 0xFF; beginCmd[2] = msgId1 & 0xFF; beginCmd[3] = (msgId1 >> 8) & 0xFF;
    beginCmd[4] = 0x01; beginCmd[5] = 0x92; 
    beginCmd[6] = fileSize & 0xFF; beginCmd[7] = (fileSize >> 8) & 0xFF; beginCmd[8] = (fileSize >> 16) & 0xFF; beginCmd[9] = (fileSize >> 24) & 0xFF;
    beginCmd.set(pathBytes, 10);

    let beginReplyPromise = new Promise(resolve => { pendingRequests.set(msgId1, resolve); setTimeout(() => resolve(null), 2000); });
    await sendToEV3(beginCmd);
    let beginReply = await beginReplyPromise;

    if (beginReply && beginReply[4] === 0x05) { throw new Error(`BEGIN rejected. EV3 Code: 0x${beginReply[6].toString(16).toUpperCase()}`); }
    if (!beginReply || beginReply[4] !== 0x03 || beginReply[6] !== 0x00) { throw new Error("BEGIN_DOWNLOAD Failed."); }
    let fileHandle = beginReply[7]; 
    await new Promise(resolve => setTimeout(resolve, 150));

    statusDiv.innerText = "Status: Uploading (Writing Binary Data)...";
    let msgId2 = msgIdCounter++;
    let contLen = 2 + 1 + 1 + 1 + dataBytes.length; 
    let contCmd = new Uint8Array(2 + contLen);
    contCmd[0] = contLen & 0xFF; contCmd[1] = (contLen >> 8) & 0xFF; contCmd[2] = msgId2 & 0xFF; contCmd[3] = (msgId2 >> 8) & 0xFF;
    contCmd[4] = 0x01; contCmd[5] = 0x93; contCmd[6] = fileHandle;
    contCmd.set(dataBytes, 7);

    let contReplyPromise = new Promise(resolve => { pendingRequests.set(msgId2, resolve); setTimeout(() => resolve(null), 2000); });
    await sendtoEV3(contCmd);
    let contReply = await contReplyPromise;

    if (contReply && contReply[4] === 0x05) { throw new Error(`CONTINUE rejected. EV3 Code: 0x${contReply[6].toString(16).toUpperCase()}`); }
    if (!contReply || contReply[4] !== 0x03 || (contReply[6] !== 0x00 && contReply[6] !== 0x08)) { throw new Error("CONTINUE_DOWNLOAD Failed."); }
    await new Promise(resolve => setTimeout(resolve, 150));

    statusDiv.innerText = "Status: Finalizing Executable...";
    let msgId3 = msgIdCounter++;
    let closeLen = 5; 
    let closeCmd = new Uint8Array(2 + closeLen);
    closeCmd[0] = closeLen & 0xFF; closeCmd[1] = (closeLen >> 8) & 0xFF; closeCmd[2] = msgId3 & 0xFF; closeCmd[3] = (msgId3 >> 8) & 0xFF;
    closeCmd[4] = 0x01; closeCmd[5] = 0x98; closeCmd[6] = fileHandle;

    await sendToEV3(closeCmd); 
    statusDiv.innerText = "Status: Executable Uploaded! Run it on the EV3.";
    statusDiv.style.color = "green";
  } catch (err) {
    statusDiv.innerText = "Status: " + err.message;
    statusDiv.style.color = "red";
    console.error(err);
  }
});

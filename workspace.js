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

// --- 1. TWO-WAY BLUETOOTH SERIAL CONNECTION ---
connectBtn.addEventListener('click', async () => {
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

async function sendEV3Command(byteArray) {
  if (!writer) return;
  await writer.write(byteArray);
  await new Promise(resolve => setTimeout(resolve, 50)); 
}

async function readSensor(portIndex) {
  let msgId = msgIdCounter++;
  let bytecode = new Uint8Array([ 0x0D, 0x00, msgId & 0xFF, (msgId >> 8) & 0xFF, 0x00, 0x04, 0x00, 0x99, 0x1D, 0x00, portIndex, 0x00, 0x00, 0x01, 0x60 ]);
  let replyPromise = new Promise(resolve => {
    pendingRequests.set(msgId, resolve);
    setTimeout(() => { if (pendingRequests.has(msgId)) { pendingRequests.delete(msgId); resolve(null); } }, 1000);
  });
  await sendEV3Command(bytecode);
  let msg = await replyPromise;
  if (msg && msg[4] === 0x02 && msg.length >= 9) {
    let view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
    return view.getFloat32(5, true); 
  }
  return 0;
}

// --- 2. DEFINE CUSTOM BLOCKS ---
// (Unchanged from your previous version)
Blockly.Blocks['ev3_beep'] = { init: function() { this.appendDummyInput().appendField("Play EV3 Beep"); this.setPreviousStatement(true, null); this.setNextStatement(true, null); this.setColour(230); } };
Blockly.Blocks['ev3_wait'] = { init: function() { this.appendDummyInput().appendField("Wait 1 Second"); this.setPreviousStatement(true, null); this.setNextStatement(true, null); this.setColour(120); } };
Blockly.Blocks['ev3_motor_custom'] = { init: function() { this.appendDummyInput().appendField("Start Motor").appendField(new Blockly.FieldDropdown([ ["A", "0x01"], ["B", "0x02"], ["C", "0x04"], ["D", "0x08"], ["A+B", "0x03"] ]), "PORT"); this.appendValueInput("SPEED").setCheck("Number").appendField("at speed"); this.setInputsInline(true); this.setPreviousStatement(true, null); this.setNextStatement(true, null); this.setColour(60); } };
Blockly.Blocks['ev3_motor_stop'] = { init: function() { this.appendDummyInput().appendField("Stop Motor").appendField(new Blockly.FieldDropdown([ ["A", "0x01"], ["B", "0x02"], ["C", "0x04"], ["D", "0x08"], ["All", "0x0F"] ]), "PORT"); this.setPreviousStatement(true, null); this.setNextStatement(true, null); this.setColour(60); } };
Blockly.Blocks['ev3_touch'] = { init: function() { this.appendDummyInput().appendField("Touch Sensor on Port").appendField(new Blockly.FieldDropdown([ ["1", "0"], ["2", "1"], ["3", "2"], ["4", "3"] ]), "PORT"); this.setOutput(true, "Boolean"); this.setColour(210); } };

// --- 3. GENERATORS (TETHERED JS) ---
const generator = javascript.javascriptGenerator;
generator.forBlock['ev3_beep'] = function(block) { return `await sendCommand(new Uint8Array([0x0F, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x94, 0x01, 0x81, 0x32, 0x82, 0xE8, 0x03, 0x82, 0xE8, 0x03]));\n`; };
generator.forBlock['ev3_wait'] = function(block) { return `await new Promise(resolve => setTimeout(resolve, 1000));\n`; };
generator.forBlock['ev3_motor_custom'] = function(block) { const portString = block.getFieldValue('PORT'); const speedCode = generator.valueToCode(block, 'SPEED', javascript.Order.NONE) || '50'; return `await (async () => { let portMask = parseInt("${portString}", 16); let speed = Math.max(-100, Math.min(100, Math.round(${speedCode}))); let speedByte = speed < 0 ? 256 + speed : speed; await sendCommand(new Uint8Array([0x0D, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0xA4, 0x00, portMask, 0x81, speedByte, 0xA6, 0x00, portMask])); })();\n`; };
generator.forBlock['ev3_motor_stop'] = function(block) { const portString = block.getFieldValue('PORT'); return `await (async () => { let portMask = parseInt("${portString}", 16); await sendCommand(new Uint8Array([0x09, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0xA3, 0x00, portMask, 0x01])); })();\n`; };
generator.forBlock['ev3_touch'] = function(block) { const port = block.getFieldValue('PORT'); const code = `(await readSensor(${port}) === 1)`; return [code, javascript.Order.ATOMIC]; };

// --- NEW 4. GENERATORS (UNTETHERED HEX COMPILER) ---
// This generator strictly outputs EV3 machine instructions separated by commas.
const ev3Compiler = new Blockly.Generator('EV3Compiler');
ev3Compiler.forBlock['ev3_beep'] = function(block) { return "0x94, 0x01, 0x81, 0x32, 0x82, 0xE8, 0x03, 0x82, 0xE8, 0x03, "; };
ev3Compiler.forBlock['ev3_wait'] = function(block) { return "0x85, 0x82, 0xE8, 0x03, 0x60, 0x00"; }; // opTIMER_WAIT for 1000ms
ev3Compiler.forBlock['ev3_motor_stop'] = function(block) { const port = block.getFieldValue('PORT'); return `0xA3, 0x00, ${port}, 0x01, `; };
ev3Compiler.forBlock['ev3_motor_custom'] = function(block) { 
  const port = block.getFieldValue('PORT');
  // For compiling, we grab the raw number from the attached shadow block
  let speed = 50;
  let target = block.getInputTargetBlock('SPEED');
  if (target && target.type === 'math_number') { speed = parseInt(target.getFieldValue('NUM')); }
  let speedByte = speed < 0 ? 256 + speed : speed;
  let speedHex = "0x" + speedByte.toString(16).padStart(2, '0').toUpperCase();
  return `0xA4, 0x00, ${port}, 0x81, ${speedHex}, 0xA6, 0x00, ${port}, `;
};
// We ignore sensors and logic blocks for the simple linear compiler
ev3Compiler.forBlock['ev3_touch'] = function() { return ""; }; 

// Helper Function: Wraps raw instructions in the strict EV3 .rbf 36-byte Blueprint
// Helper Function: Wraps raw instructions in the strict EV3 .rbf 36-byte Blueprint
function compileToRBF(instructions) {
  const prefix = new Uint8Array([
    0x6C, 0x6D, 0x73, 0x32, 0x30, 0x31, 0x32, 0x00, // "lms2012\0" (Magic Signature)
    0x00, 0x00, 0x00, 0x00, // Total file size placeholder (index 8-11)
    0x01, 0x04,             // Firmware Version 1.04
    0x01, 0x00,             // Number of objects (1)
    
    // FIX: Allocate 32 bytes (0x20) of Global Memory instead of 0
    0x20, 0x00, 0x00, 0x00, 
    
    0x18, 0x00, 0x00, 0x00, // Offset to Object 0 from start of file (24 bytes)
    // --- Start of Object 0 Header ---
    0x0C, 0x00, 0x00, 0x00, // Offset to start of instructions (12 bytes)
    0x00, 0x00,             // Owner object
    0x01, 0x00,             // Trigger count
    
    // FIX: Allocate 32 bytes (0x20) of Local Memory instead of 0
    0x20, 0x00, 0x00, 0x00  
  ]);
  
  const totalSize = prefix.length + instructions.length + 1; // +1 for the exit byte
  prefix[8] = totalSize & 0xFF; 
  prefix[9] = (totalSize >> 8) & 0xFF;
  prefix[10] = (totalSize >> 16) & 0xFF; 
  prefix[11] = (totalSize >> 24) & 0xFF;
  
  const rbf = new Uint8Array(totalSize);
  rbf.set(prefix, 0);
  rbf.set(instructions, prefix.length);
  rbf[totalSize - 1] = 0x0A; // opOBJECT_END (Tells EV3 the program is finished)
  
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
    await executeBlocks(sendEV3Command, readSensor);
    statusDiv.innerText = "Status: Tethered Execution Complete!"; statusDiv.style.color = "green";
  } catch (error) {
    statusDiv.innerText = "Status: Runtime Error - " + error.message; statusDiv.style.color = "red";
  }
});

// --- NEW 7. COMPILE & UPLOAD (UNTETHERED) ---
uploadBtn.addEventListener('click', async () => {
  try {
    statusDiv.innerText = "Status: Compiling Code..."; statusDiv.style.color = "blue";
    
    // 1. Compile the blocks into a string of Hex values using our new generator
    const compiledString = ev3Compiler.workspaceToCode(workspace);
    if (!compiledString || compiledString.trim() === "") { throw new Error("Workspace is empty!"); }
    
    // 2. Convert string to a Javascript array, then to a Uint8Array
    const byteStringArray = compiledString.split(',').filter(s => s.trim().length > 0);
    const rawInstructions = new Uint8Array(byteStringArray.map(s => parseInt(s.trim(), 16)));
    
    // 3. Wrap instructions in the RBF Blueprint
    const dataBytes = compileToRBF(rawInstructions);
    const fileSize = dataBytes.length;
    
    const filename = "MyProgram.rbf";
    const ev3Path = "../prjs/BrkProg_SAVE/" + filename + "\0";
    const pathBytes = new TextEncoder().encode(ev3Path);

    // STEP 1: BEGIN_DOWNLOAD
    statusDiv.innerText = "Status: Uploading (Allocating Space)...";
    let msgId1 = msgIdCounter++;
    let beginLen = 2 + 1 + 1 + 4 + pathBytes.length; 
    let beginCmd = new Uint8Array(2 + beginLen);
    beginCmd[0] = beginLen & 0xFF; beginCmd[1] = (beginLen >> 8) & 0xFF; beginCmd[2] = msgId1 & 0xFF; beginCmd[3] = (msgId1 >> 8) & 0xFF;
    beginCmd[4] = 0x01; beginCmd[5] = 0x92; 
    beginCmd[6] = fileSize & 0xFF; beginCmd[7] = (fileSize >> 8) & 0xFF; beginCmd[8] = (fileSize >> 16) & 0xFF; beginCmd[9] = (fileSize >> 24) & 0xFF;
    beginCmd.set(pathBytes, 10);

    let beginReplyPromise = new Promise(resolve => { pendingRequests.set(msgId1, resolve); setTimeout(() => resolve(null), 2000); });
    await sendEV3Command(beginCmd);
    let beginReply = await beginReplyPromise;

    if (beginReply && beginReply[4] === 0x05) { throw new Error(`BEGIN rejected. EV3 Code: 0x${beginReply[6].toString(16).toUpperCase()}`); }
    if (!beginReply || beginReply[4] !== 0x03 || beginReply[6] !== 0x00) { throw new Error("BEGIN_DOWNLOAD Failed."); }
    let fileHandle = beginReply[7]; 
    await new Promise(resolve => setTimeout(resolve, 150));

    // STEP 2: CONTINUE_DOWNLOAD
    statusDiv.innerText = "Status: Uploading (Writing Binary Data)...";
    let msgId2 = msgIdCounter++;
    let contLen = 2 + 1 + 1 + 1 + dataBytes.length; 
    let contCmd = new Uint8Array(2 + contLen);
    contCmd[0] = contLen & 0xFF; contCmd[1] = (contLen >> 8) & 0xFF; contCmd[2] = msgId2 & 0xFF; contCmd[3] = (msgId2 >> 8) & 0xFF;
    contCmd[4] = 0x01; contCmd[5] = 0x93; contCmd[6] = fileHandle;
    contCmd.set(dataBytes, 7);

    let contReplyPromise = new Promise(resolve => { pendingRequests.set(msgId2, resolve); setTimeout(() => resolve(null), 2000); });
    await sendEV3Command(contCmd);
    let contReply = await contReplyPromise;

    if (contReply && contReply[4] === 0x05) { throw new Error(`CONTINUE rejected. EV3 Code: 0x${contReply[6].toString(16).toUpperCase()}`); }
    if (!contReply || contReply[4] !== 0x03 || (contReply[6] !== 0x00 && contReply[6] !== 0x08)) { throw new Error("CONTINUE_DOWNLOAD Failed."); }
    await new Promise(resolve => setTimeout(resolve, 150));

    // STEP 3: CLOSE_FILEHANDLE
    statusDiv.innerText = "Status: Finalizing Executable...";
    let msgId3 = msgIdCounter++;
    let closeLen = 5; 
    let closeCmd = new Uint8Array(2 + closeLen);
    closeCmd[0] = closeLen & 0xFF; closeCmd[1] = (closeLen >> 8) & 0xFF; closeCmd[2] = msgId3 & 0xFF; closeCmd[3] = (msgId3 >> 8) & 0xFF;
    closeCmd[4] = 0x01; closeCmd[5] = 0x98; closeCmd[6] = fileHandle;

    await sendEV3Command(closeCmd); 
    statusDiv.innerText = "Status: Executable Uploaded! Run it on the EV3.";
    statusDiv.style.color = "green";
  } catch (err) {
    statusDiv.innerText = "Status: " + err.message;
    statusDiv.style.color = "red";
    console.error(err);
  }
});


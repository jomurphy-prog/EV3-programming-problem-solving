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
    
    listenToPort(); // Start the background listener

    statusDiv.innerText = "Status: Connected and Listening!";
    statusDiv.style.color = "green";
    runBtn.disabled = false;
    uploadBtn.disabled = false; // <--- This unlocks the Upload button!
    connectBtn.disabled = true;
  } catch (error) {
    statusDiv.innerText = "Status: Connection Failed";
    statusDiv.style.color = "red";
    console.error(error);
  }
});

// Universal Background Listener Loop
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
            
            // Hand the ENTIRE message array back to whoever asked for it
            if (pendingRequests.has(msgId)) {
              let resolve = pendingRequests.get(msgId);
              pendingRequests.delete(msgId);
              resolve(msg); 
            }
          }
        } else {
          break; 
        }
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
  try {
    await writer.write(byteArray);
    await new Promise(resolve => setTimeout(resolve, 50)); 
  } catch (error) {
    console.error("Error writing to serial:", error);
  }
}

// Upgraded Sensor Reader (with fixed timing!)
async function readSensor(portIndex) {
  let msgId = msgIdCounter++;
  let bytecode = new Uint8Array([
    0x0D, 0x00, msgId & 0xFF, (msgId >> 8) & 0xFF, 0x00, 0x04, 0x00, 0x99, 0x1D, 0x00, portIndex, 0x00, 0x00, 0x01, 0x60 
  ]);

  // Set up the listener promise FIRST
  let replyPromise = new Promise(resolve => {
    pendingRequests.set(msgId, resolve);
    setTimeout(() => { if (pendingRequests.has(msgId)) { pendingRequests.delete(msgId); resolve(null); } }, 1000);
  });
  
  // THEN send the command
  await sendEV3Command(bytecode);

  // WAIT for the reply
  let msg = await replyPromise;

  if (msg && msg[4] === 0x02 && msg.length >= 9) {
    let view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
    return view.getFloat32(5, true); 
  }
  return 0;
}

// --- NEW: THE FILE UPLOAD PROTOCOL ---
uploadBtn.addEventListener('click', async () => {
  try {
    statusDiv.innerText = "Status: Uploading (Allocating Space)...";
    statusDiv.style.color = "blue";
    
    const filename = "HelloWeb.txt";
    const textData = "Congratulations! You successfully wrote a file to the EV3 over Web Serial!";
    const ev3Path = "../prjs/BrkProg_SAVE/" + filename + "\0";
    
    const pathBytes = new TextEncoder().encode(ev3Path);
    const dataBytes = new TextEncoder().encode(textData);
    const fileSize = dataBytes.length;

    // --- STEP 1: BEGIN_DOWNLOAD ---
    let msgId1 = msgIdCounter++;
    let beginLen = 2 + 1 + 1 + 4 + pathBytes.length; 
    let beginCmd = new Uint8Array(2 + beginLen);
    beginCmd[0] = beginLen & 0xFF;
    beginCmd[1] = (beginLen >> 8) & 0xFF;
    beginCmd[2] = msgId1 & 0xFF;
    beginCmd[3] = (msgId1 >> 8) & 0xFF;
    beginCmd[4] = 0x01; 
    beginCmd[5] = 0x92; 
    beginCmd[6] = fileSize & 0xFF;
    beginCmd[7] = (fileSize >> 8) & 0xFF;
    beginCmd[8] = (fileSize >> 16) & 0xFF;
    beginCmd[9] = (fileSize >> 24) & 0xFF;
    beginCmd.set(pathBytes, 10);

    let beginReplyPromise = new Promise(resolve => {
      pendingRequests.set(msgId1, resolve);
      setTimeout(() => resolve(null), 2000);
    });

    await sendEV3Command(beginCmd);
    let beginReply = await beginReplyPromise;

    // 0x05 means the EV3 threw a System Error. 
    if (beginReply && beginReply[4] === 0x05) {
      throw new Error(`BEGIN_DOWNLOAD rejected. EV3 Error Code: 0x${beginReply[6].toString(16).toUpperCase()}`);
    }
    if (!beginReply || beginReply[4] !== 0x03 || beginReply[6] !== 0x00) {
      throw new Error("BEGIN_DOWNLOAD Failed entirely.");
    }
    
    let fileHandle = beginReply[7]; 

    // *** CRITICAL HARDWARE DELAY ***
    // Give the EV3 flash memory 150ms to actually open the file
    statusDiv.innerText = "Status: Uploading (Writing Data)...";
    await new Promise(resolve => setTimeout(resolve, 150));

    // --- STEP 2: CONTINUE_DOWNLOAD ---
    let msgId2 = msgIdCounter++;
    let contLen = 2 + 1 + 1 + 1 + dataBytes.length; 
    let contCmd = new Uint8Array(2 + contLen);
    contCmd[0] = contLen & 0xFF;
    contCmd[1] = (contLen >> 8) & 0xFF;
    contCmd[2] = msgId2 & 0xFF;
    contCmd[3] = (msgId2 >> 8) & 0xFF;
    contCmd[4] = 0x01; 
    contCmd[5] = 0x93; 
    contCmd[6] = fileHandle;
    contCmd.set(dataBytes, 7);

    let contReplyPromise = new Promise(resolve => {
      pendingRequests.set(msgId2, resolve);
      setTimeout(() => resolve(null), 2000);
    });

    await sendEV3Command(contCmd);
    let contReply = await contReplyPromise;

    if (contReply && contReply[4] === 0x05) {
      throw new Error(`CONTINUE_DOWNLOAD rejected. EV3 Error Code: 0x${contReply[6].toString(16).toUpperCase()}`);
    }
    // Accept 0x00 (Success) and 0x08 (End of File)
    if (!contReply || contReply[4] !== 0x03 || (contReply[6] !== 0x00 && contReply[6] !== 0x08)) {
      throw new Error("CONTINUE_DOWNLOAD Failed entirely.");
    }

    // *** CRITICAL HARDWARE DELAY ***
    await new Promise(resolve => setTimeout(resolve, 150));

    // --- STEP 3: CLOSE_FILEHANDLE ---
    statusDiv.innerText = "Status: Uploading (Finalizing)...";
    let msgId3 = msgIdCounter++;
    let closeLen = 5; 
    let closeCmd = new Uint8Array(2 + closeLen);
    closeCmd[0] = closeLen & 0xFF;
    closeCmd[1] = (closeLen >> 8) & 0xFF;
    closeCmd[2] = msgId3 & 0xFF;
    closeCmd[3] = (msgId3 >> 8) & 0xFF;
    closeCmd[4] = 0x01; 
    closeCmd[5] = 0x98; 
    closeCmd[6] = fileHandle;

    await sendEV3Command(closeCmd); 

    statusDiv.innerText = "Status: File Uploaded Successfully!";
    statusDiv.style.color = "green";

  } catch (err) {
    statusDiv.innerText = "Status: " + err.message;
    statusDiv.style.color = "red";
    console.error(err);
  }
});

// --- 2. DEFINE CUSTOM BLOCKS ---
Blockly.Blocks['ev3_beep'] = {
  init: function() {
    this.appendDummyInput().appendField("Play EV3 Beep");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(230);
  }
};

Blockly.Blocks['ev3_wait'] = {
  init: function() {
    this.appendDummyInput().appendField("Wait 1 Second");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(120);
  }
};

Blockly.Blocks['ev3_motor_custom'] = {
  init: function() {
    this.appendDummyInput()
        .appendField("Start Motor")
        .appendField(new Blockly.FieldDropdown([
          ["A", "0x01"], ["B", "0x02"], ["C", "0x04"], ["D", "0x08"], ["A+B", "0x03"]
        ]), "PORT");
    this.appendValueInput("SPEED").setCheck("Number").appendField("at speed");
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(60);
  }
};

Blockly.Blocks['ev3_motor_stop'] = {
  init: function() {
    this.appendDummyInput()
        .appendField("Stop Motor")
        .appendField(new Blockly.FieldDropdown([
          ["A", "0x01"], ["B", "0x02"], ["C", "0x04"], ["D", "0x08"], ["All", "0x0F"]
        ]), "PORT");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(60);
  }
};

Blockly.Blocks['ev3_touch'] = {
  init: function() {
    this.appendDummyInput()
        .appendField("Touch Sensor on Port")
        .appendField(new Blockly.FieldDropdown([
          ["1", "0"], ["2", "1"], ["3", "2"], ["4", "3"]
        ]), "PORT");
    this.setOutput(true, "Boolean");
    this.setColour(210);
  }
};

// --- 3. GENERATORS ---
const generator = javascript.javascriptGenerator;

generator.forBlock['ev3_beep'] = function(block) {
  return `await sendCommand(new Uint8Array([0x0F, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x94, 0x01, 0x81, 0x32, 0x82, 0xE8, 0x03, 0x82, 0xE8, 0x03]));\n`;
};

generator.forBlock['ev3_wait'] = function(block) {
  return `await new Promise(resolve => setTimeout(resolve, 1000));\n`;
};

generator.forBlock['ev3_motor_custom'] = function(block) {
  const portString = block.getFieldValue('PORT'); 
  const speedCode = generator.valueToCode(block, 'SPEED', javascript.Order.NONE) || '50';
  return `await (async () => {
    let portMask = parseInt("${portString}", 16); 
    let speed = Math.max(-100, Math.min(100, Math.round(${speedCode})));
    let speedByte = speed < 0 ? 256 + speed : speed;
    await sendCommand(new Uint8Array([0x0D, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0xA4, 0x00, portMask, 0x81, speedByte, 0xA6, 0x00, portMask]));
  })();\n`;
};

generator.forBlock['ev3_motor_stop'] = function(block) {
  const portString = block.getFieldValue('PORT');
  return `await (async () => {
    let portMask = parseInt("${portString}", 16);
    await sendCommand(new Uint8Array([0x09, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0xA3, 0x00, portMask, 0x01]));
  })();\n`;
};

generator.forBlock['ev3_touch'] = function(block) {
  const port = block.getFieldValue('PORT');
  const code = `(await readSensor(${port}) === 1)`;
  return [code, javascript.Order.ATOMIC];
};

// --- 4. INJECT BLOCKLY WORKSPACE ---
const workspace = Blockly.inject('blocklyDiv', {
  toolbox: document.getElementById('toolbox'),
  scrollbars: true,
  trashcan: true
});

// --- 5. EXECUTE GENERATED CODE ---
runBtn.addEventListener('click', async () => {
  if (!writer) return;
  statusDiv.innerText = "Status: Running...";
  statusDiv.style.color = "blue";
  const generatedCode = generator.workspaceToCode(workspace);
  
  try {
    const executeBlocks = new Function('sendCommand', 'readSensor', `
      return (async () => { 
        try { ${generatedCode} } catch (err) { throw err; }
      })();
    `);
    
    await executeBlocks(sendEV3Command, readSensor);
    
    statusDiv.innerText = "Status: Execution Complete!";
    statusDiv.style.color = "green";
  } catch (error) {
    statusDiv.innerText = "Status: Runtime Error - " + error.message;
    statusDiv.style.color = "red";
    console.error(error);
  }
});


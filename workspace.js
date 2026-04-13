let port;
let writer;
let reader;

// Variables for Two-Way Communication
let msgIdCounter = 1;
const pendingRequests = new Map();
let inputBuffer = new Uint8Array(0);

const connectBtn = document.getElementById('connectBtn');
const runBtn = document.getElementById('runBtn');
const statusDiv = document.getElementById('status');

// --- 1. TWO-WAY BLUETOOTH SERIAL CONNECTION ---
connectBtn.addEventListener('click', async () => {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    writer = port.writable.getWriter();
    
    // Start the continuous background listener
    listenToPort();

    statusDiv.innerText = "Status: Connected and Listening!";
    statusDiv.style.color = "green";
    runBtn.disabled = false;
    connectBtn.disabled = true;
  } catch (error) {
    statusDiv.innerText = "Status: Connection Failed";
    statusDiv.style.color = "red";
    console.error(error);
  }
});

// The Background Listener Loop
async function listenToPort() {
  reader = port.readable.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      // Bluetooth data sometimes arrives in chopped-up chunks. 
      // We append incoming bytes to a buffer so we can parse full messages.
      let temp = new Uint8Array(inputBuffer.length + value.length);
      temp.set(inputBuffer);
      temp.set(value, inputBuffer.length);
      inputBuffer = temp;

      // Check if we have enough bytes for a complete EV3 message
      while (inputBuffer.length >= 2) {
        let msgLength = inputBuffer[0] + (inputBuffer[1] << 8);
        let totalLength = msgLength + 2; // +2 for the length bytes themselves

        if (inputBuffer.length >= totalLength) {
          // We have a complete message from the EV3!
          let msg = inputBuffer.slice(0, totalLength);
          inputBuffer = inputBuffer.slice(totalLength); // Remove from buffer

          if (msg.length >= 5) {
            let msgId = msg[2] + (msg[3] << 8);
            let status = msg[4]; // 0x02 means SUCCESS

            // If this message ID matches a question we asked, resolve the Promise
            if (pendingRequests.has(msgId)) {
              let resolve = pendingRequests.get(msgId);
              pendingRequests.delete(msgId);

              // Data payload starts at byte 5. READY_SI returns a 4-byte Float.
              if (status === 0x02 && msg.length >= 9) {
                let view = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
                let sensorVal = view.getFloat32(5, true); // true = little-endian
                resolve(sensorVal);
              } else {
                resolve(0); // Fail safe
              }
            }
          }
        } else {
          break; // Waiting for more bytes to arrive
        }
      }
    }
  } catch (e) {
    console.error("Reader loop error:", e);
  } finally {
    reader.releaseLock();
  }
}

// Helper: Send Fire-and-Forget Commands
async function sendEV3Command(byteArray) {
  if (!writer) return;
  try {
    await writer.write(byteArray);
    await new Promise(resolve => setTimeout(resolve, 50)); 
  } catch (error) {
    console.error("Error writing to serial:", error);
  }
}

// Helper: Ask a Question and Wait for the Reply
async function readSensor(portIndex) {
  return new Promise(async (resolve) => {
    let msgId = msgIdCounter++;
    pendingRequests.set(msgId, resolve);

    let bytecode = new Uint8Array([
      0x0D, 0x00, // Payload Length (13 bytes)
      msgId & 0xFF, (msgId >> 8) & 0xFF, // Attach our unique Message ID
      0x00, // Command Type: DIRECT_COMMAND_REPLY (Require answer)
      0x04, 0x00, // Allocate 4 bytes of memory for the EV3's answer
      // opINPUT_DEVICE, READY_SI, Layer 0, Port, Type 0, Mode 0, 1 Value, Memory Index 0
      0x99, 0x1D, 0x00, portIndex, 0x00, 0x00, 0x01, 0x60 
    ]);

    await sendEV3Command(bytecode);

    // If the EV3 doesn't answer within 1 second, time out so the code doesn't freeze
    setTimeout(() => {
      if (pendingRequests.has(msgId)) {
        pendingRequests.delete(msgId);
        resolve(0); 
      }
    }, 1000);
  });
}

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

// NEW: Stop Motor Block
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

// NEW: Touch Sensor Block (Returns a Boolean)
Blockly.Blocks['ev3_touch'] = {
  init: function() {
    this.appendDummyInput()
        .appendField("Touch Sensor on Port")
        .appendField(new Blockly.FieldDropdown([
          ["1", "0"], ["2", "1"], ["3", "2"], ["4", "3"] // Ports are indexed 0-3 in code
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

// Generator for Stop Motor
generator.forBlock['ev3_motor_stop'] = function(block) {
  const portString = block.getFieldValue('PORT');
  return `await (async () => {
    let portMask = parseInt("${portString}", 16);
    // opOUTPUT_STOP, Layer 0, Port, Brake (1)
    await sendCommand(new Uint8Array([0x09, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0xA3, 0x00, portMask, 0x01]));
  })();\n`;
};

// Generator for Touch Sensor
generator.forBlock['ev3_touch'] = function(block) {
  const port = block.getFieldValue('PORT');
  // EV3 Touch sensor returns 1.0 when pressed, 0.0 when released
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
    
    // Pass BOTH helper functions into the compiled code
    await executeBlocks(sendEV3Command, readSensor);
    
    statusDiv.innerText = "Status: Execution Complete!";
    statusDiv.style.color = "green";
  } catch (error) {
    statusDiv.innerText = "Status: Runtime Error - " + error.message;
    statusDiv.style.color = "red";
    console.error(error);
  }
});

let port;
let writer;

const connectBtn = document.getElementById('connectBtn');
const runBtn = document.getElementById('runBtn');
const statusDiv = document.getElementById('status');

// --- 1. BLUETOOTH SERIAL CONNECTION ---
connectBtn.addEventListener('click', async () => {
  try {
    // Request a generic serial port (no USB filters, so BT COM ports show up)
    port = await navigator.serial.requestPort();
    
    // EV3 Bluetooth SPP uses a baud rate of 115200
    await port.open({ baudRate: 115200 });
    writer = port.writable.getWriter();
    
    statusDiv.innerText = "Status: Connected via Bluetooth COM!";
    statusDiv.style.color = "green";
    runBtn.disabled = false;
    connectBtn.disabled = true;
  } catch (error) {
    statusDiv.innerText = "Status: Connection Failed";
    statusDiv.style.color = "red";
    console.error(error);
  }
});

// Helper function to handle sending the data
async function sendEV3Command(byteArray) {
  if (!writer) return;
  try {
    await writer.write(byteArray);
    await new Promise(resolve => setTimeout(resolve, 50)); 
  } catch (error) {
    console.error("Error writing to serial:", error);
  }
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

// New Customizable Motor Block
Blockly.Blocks['ev3_motor_custom'] = {
  init: function() {
    this.appendDummyInput()
        .appendField("Start Motor")
        .appendField(new Blockly.FieldDropdown([
          ["A", "0x01"], 
          ["B", "0x02"], 
          ["C", "0x04"], 
          ["D", "0x08"],
          ["A+B", "0x03"] // EV3 ports are bitfields. 1 + 2 = 3 (Ports A and B together)
        ]), "PORT");
    this.appendValueInput("SPEED")
        .setCheck("Number")
        .appendField("at speed");
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(60);
    this.setTooltip("Starts the selected motor(s) at a speed between -100 and 100.");
  }
};

// --- 3. GENERATORS ---
const generator = javascript.javascriptGenerator;

generator.forBlock['ev3_beep'] = function(block) {
  const bytecode = "new Uint8Array([0x0F, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x94, 0x01, 0x81, 0x32, 0x82, 0xE8, 0x03, 0x82, 0xE8, 0x03])";
  return `await sendCommand(${bytecode});\n`;
};

generator.forBlock['ev3_wait'] = function(block) {
  return `await new Promise(resolve => setTimeout(resolve, 1000));\n`;
};

generator.forBlock['ev3_motor_custom'] = function(block) {
  const port = block.getFieldValue('PORT');
  const speedCode = generator.valueToCode(block, 'SPEED', javascript.Order.NONE) || '50';
  
  return `await (async () => {
    let speed = Math.max(-100, Math.min(100, Math.round(${speedCode})));
    let speedByte = speed < 0 ? 256 + speed : speed;
    
    // Using opOUTPUT_TIME_SPEED (0xAF) to run for exactly 1 second (1000ms)
    // This prevents the EV3 Bluetooth watchdog from instantly stopping the motor
    let bytecode = new Uint8Array([
      0x10, 0x00, // Length: 16 bytes
      0x00, 0x00, // MsgID
      0x80, 0x00, 0x00, // Direct Command No Reply
      0xAF, // opOUTPUT_TIME_SPEED
      0x00, // LAYER
      ${port}, // PORT
      0x81, speedByte, // SPEED
      0x00, // STEP1 (Ramp up 0ms)
      0x82, 0xE8, 0x03, // STEP2 (Constant 1000ms)
      0x00, // STEP3 (Ramp down 0ms)
      0x01  // BRAKE (1 = Brake, 0 = Coast)
    ]);
    
    await sendCommand(bytecode);
    
    // Tell JavaScript to wait 1 second while the physical motor runs
    await new Promise(resolve => setTimeout(resolve, 1000));
  })();\n`;
};

// --- 4. INJECT BLOCKLY WORKSPACE ---
const workspace = Blockly.inject('blocklyDiv', {
  toolbox: document.getElementById('toolbox'),
  scrollbars: true,
  trashcan: true
});

// --- 5. EXECUTE GENERATED CODE ---
runBtn.addEventListener('click', async () => {
  if (!writer) {
    alert("Please connect to the EV3 first!");
    return;
  }

  statusDiv.innerText = "Status: Running...";
  statusDiv.style.color = "blue";

  const generatedCode = generator.workspaceToCode(workspace);

  try {
    const executeBlocks = new Function('sendCommand', `return (async () => { \n${generatedCode}\n })();`);
    await executeBlocks(sendEV3Command);
    statusDiv.innerText = "Status: Execution Complete!";
    statusDiv.style.color = "green";
  } catch (error) {
    statusDiv.innerText = "Status: Error executing blocks";
    statusDiv.style.color = "red";
    console.error(error);
  }
});


let port;
let writer;

const connectBtn = document.getElementById('connectBtn');
const runBtn = document.getElementById('runBtn');
const statusDiv = document.getElementById('status');

// --- 1. BLUETOOTH SERIAL CONNECTION ---
connectBtn.addEventListener('click', async () => {
  try {
    port = await navigator.serial.requestPort();
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

Blockly.Blocks['ev3_motor_custom'] = {
  init: function() {
    this.appendDummyInput()
        .appendField("Start Motor")
        .appendField(new Blockly.FieldDropdown([
          ["A", "0x01"], 
          ["B", "0x02"], 
          ["C", "0x04"], 
          ["D", "0x08"],
          ["A+B", "0x03"] 
        ]), "PORT");
    this.appendValueInput("SPEED")
        .setCheck("Number")
        .appendField("at speed");
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(60);
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
  const portString = block.getFieldValue('PORT'); 
  const speedCode = generator.valueToCode(block, 'SPEED', javascript.Order.NONE) || '50';
  
  // We wrap the variables in quotes inside the generated JS to prevent ReferenceErrors
  return `await (async () => {
    let portMask = parseInt("${portString}", 16); 
    let speed = Math.max(-100, Math.min(100, Math.round(${speedCode})));
    let speedByte = speed < 0 ? 256 + speed : speed;
    
    let bytecode = new Uint8Array([
      0x0D, 0x00, // Length: 13 bytes
      0x00, 0x00, // MsgID
      0x80, 0x00, 0x00, // Direct Command No Reply
      0xA4, 0x00, portMask, 0x81, speedByte, // opOUTPUT_SPEED
      0xA6, 0x00, portMask // opOUTPUT_START
    ]);
    
    await sendCommand(bytecode);
  })();\n`;
};

// --- 4. INJECT BLOCKLY WORKSPACE ---
const workspace = Blockly.inject('blocklyDiv', {
  toolbox: document.getElementById('toolbox'),
  scrollbars: true,
  trashcan: true
});

// --- 5. EXECUTE GENERATED CODE WITH ERROR CATCHER ---
runBtn.addEventListener('click', async () => {
  if (!writer) return;

  statusDiv.innerText = "Status: Running...";
  statusDiv.style.color = "blue";

  const generatedCode = generator.workspaceToCode(workspace);
  // Log the exact code to the Developer Console so you can see what it generated
  console.log("Generated JavaScript:\n", generatedCode);

  try {
    // We wrap your generated code in a try/catch INSIDE the execution function
    const executeBlocks = new Function('sendCommand', `
      return (async () => { 
        try {
          ${generatedCode}
        } catch (err) {
          // If the blocks crash, throw the error back to the main UI
          throw err; 
        }
      })();
    `);
    
    await executeBlocks(sendEV3Command);
    
    statusDiv.innerText = "Status: Execution Complete!";
    statusDiv.style.color = "green";
  } catch (error) {
    // Prints the exact crash reason on your webpage!
    statusDiv.innerText = "Status: Runtime Error - " + error.message;
    statusDiv.style.color = "red";
    console.error(error);
  }
});

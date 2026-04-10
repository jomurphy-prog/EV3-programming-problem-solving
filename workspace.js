let port;
let writer;

const connectBtn = document.getElementById('connectBtn');
const runBtn = document.getElementById('runBtn');
const statusDiv = document.getElementById('status');

// --- 1. WEB SERIAL CONNECTION ---
connectBtn.addEventListener('click', async () => {
  try {
    port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x0694 }] });
    await port.open({ baudRate: 115200 });
    writer = port.writable.getWriter();
    
    statusDiv.innerText = "Status: Connected!";
    statusDiv.style.color = "green";
    runBtn.disabled = false;
    connectBtn.disabled = true;
  } catch (error) {
    statusDiv.innerText = "Status: Connection Failed";
    statusDiv.style.color = "red";
    console.error(error);
  }
});

// Helper function to send commands (called by our generated code)
async function sendEV3Command(byteArray) {
  if (!writer) return;
  await writer.write(byteArray);
  // Add a tiny delay to ensure the EV3 processes sequential commands cleanly
  await new Promise(resolve => setTimeout(resolve, 50)); 
}

// --- 2. DEFINE CUSTOM BLOCKLY BLOCKS ---
Blockly.Blocks['ev3_beep'] = {
  init: function() {
    this.appendDummyInput().appendField("Play EV3 Beep");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(230);
    this.setTooltip("Plays a standard 1-second beep on the EV3.");
  }
};

Blockly.Blocks['ev3_wait'] = {
  init: function() {
    this.appendDummyInput().appendField("Wait 1 Second");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(120);
    this.setTooltip("Pauses the program for 1 second.");
  }
};

// --- 3. CREATE THE CUSTOM GENERATOR ---
const ev3Generator = new Blockly.Generator('EV3');
ev3Generator.ORDER_ATOMIC = 0;

// Generator for the Beep Block
ev3Generator.forBlock['ev3_beep'] = function(block) {
  // This string returns JavaScript that calls our helper function with the specific EV3 bytecode
  const bytecode = "new Uint8Array([0x0F, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x94, 0x01, 0x81, 0x32, 0x82, 0xE8, 0x03, 0x82, 0xE8, 0x03])";
  return `await sendCommand(${bytecode});\n`;
};

// Generator for the Wait Block
ev3Generator.forBlock['ev3_wait'] = function(block) {
  // Uses a standard JS Promise to pause execution
  return `await new Promise(resolve => setTimeout(resolve, 1000));\n`;
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

  // Generate the JavaScript code string from the blocks
  const generatedCode = ev3Generator.workspaceToCode(workspace);

  try {
    // Wrap the generated code in an async function so 'await' works
    // We pass 'sendEV3Command' into the function as 'sendCommand'
    const executeBlocks = new Function('sendCommand', `return (async () => { \n${generatedCode}\n })();`);
    
    // Run the code
    await executeBlocks(sendEV3Command);
    
    statusDiv.innerText = "Status: Execution Complete!";
    statusDiv.style.color = "green";
  } catch (error) {
    statusDiv.innerText = "Status: Error executing blocks";
    statusDiv.style.color = "red";
    console.error(error);
  }
});

let ev3Device; // Changed from port/writer to a single HID device variable

const connectBtn = document.getElementById('connectBtn');
const runBtn = document.getElementById('runBtn');
const statusDiv = document.getElementById('status');

// --- 1. WEB HID CONNECTION ---
connectBtn.addEventListener('click', async () => {
  try {
    // Request access to the EV3 using WebHID instead of Web Serial
    // LEGO Vendor ID is 0x0694
    const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x0694 }] });
    
    if (devices.length > 0) {
      ev3Device = devices[0];
      
      // Open the HID connection
      await ev3Device.open();
      
      statusDiv.innerText = "Status: Connected via WebHID!";
      statusDiv.style.color = "green";
      runBtn.disabled = false;
      connectBtn.disabled = true;
    }
  } catch (error) {
    statusDiv.innerText = "Status: Connection Failed";
    statusDiv.style.color = "red";
    console.error(error);
  }
});

// Helper function to handle sending the data
async function sendEV3Command(byteArray) {
  if (!ev3Device) return;
  
  try {
    // WebHID uses sendReport(reportId, data). 
    // The EV3 does not use numbered Report IDs, so we send 0.
    await ev3Device.sendReport(0, byteArray);
    
    // Tiny delay to ensure the EV3 processes sequential commands cleanly
    await new Promise(resolve => setTimeout(resolve, 50)); 
  } catch (error) {
    console.error("Error sending HID report:", error);
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
  // Grab whatever math/number block is plugged into the SPEED socket. Default to 50.
  const speedCode = generator.valueToCode(block, 'SPEED', javascript.Order.NONE) || '50';
  
  // We wrap the dynamic payload generation in an Immediately Invoked Function Expression
  // so the speed calculation logic happens safely at runtime.
  return `await (async () => {
    // Ensure speed is an integer between -100 and 100
    let speed = Math.max(-100, Math.min(100, Math.round(${speedCode})));
    // Convert signed negative numbers to an unsigned byte for the EV3
    let speedByte = speed < 0 ? 256 + speed : speed;
    
    let bytecode = new Uint8Array([
      0x0F, 0x00, // Length
      0x00, 0x00, // MsgID
      0x80, 0x00, 0x00, // Direct Command No Reply
      0xA4, 0x00, ${port}, 0x81, speedByte, // Set Speed (opOUTPUT_SPEED)
      0xA6, 0x00, ${port} // Start Motor (opOUTPUT_START)
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


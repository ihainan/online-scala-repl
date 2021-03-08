import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { AttachAddon } from "xterm-addon-attach";

// Terminals
let term;
let protocol;
let socketURL;
let pid;
let socket;
let rows;
let cols;

// Addons
let attachAddon;
let fitAddon;

// Elements
const terminalContainer = document.getElementById("terminal-container");

function createTerminal(): void {
  // Clean existing terminal
  while (terminalContainer.children.length) {
    terminalContainer.removeChild(terminalContainer.children[0]);
  }

  // Initialize and open terminal
  term = new Terminal({
    cursorBlink: true,
    disableStdin: false,
  });
  protocol = location.protocol === "https:" ? "wss://" : "ws://";
  socketURL =
    protocol +
    location.hostname +
    (location.port ? ":" + location.port : "") +
    "/terminals/";
  console.log("socketURL = " + socketURL);
  term.onResize((size: { cols: number; rows: number }) => {
    console.log("Resize to " + size.cols + " and " + size.rows);
    if (!pid) {
      return;
    }
    const cols = size.cols;
    const rows = size.rows;
    const url = "/terminals/" + pid + "/size?cols=" + cols + "&rows=" + rows;
    fetch(url, { method: "POST" });
    console.log("Resized to " + size.cols + " and " + size.rows);
  });

  // Addons
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  fitAddon.fit();

  // Open Terminal
  term.open(terminalContainer);
  term.writeln("");
  term.writeln("█▀ █▀▀ ▄▀█ █░░ ▄▀█ ░ █ █░█ ▄▀█ █ █▄░█ ▄▀█ █▄░█ ░ █▀▄▀█ █▀▀");
  term.writeln("▄█ █▄▄ █▀█ █▄▄ █▀█ ▄ █ █▀█ █▀█ █ █░▀█ █▀█ █░▀█ ▄ █░▀░█ ██▄");
  term.writeln("");

  // Change window size
  window.onresize = () => {
    if (!pid) {
      return;
    }

    fitAddon.fit();
  };

  // Create Terminal via API
  // fetch("http://localhost:3001/terminals", {
  fetch("/terminals", {
    method: "POST",
  }).then((res) => {
    res.text().then((processId) => {
      pid = processId;
      socketURL += processId;
      socket = new WebSocket(socketURL);
      socket.onopen = runRealTerminal;
      socket.onclose = runFakeTerminal;
      socket.onerror = runFakeTerminal;
      console.log(term.cols);
      console.log(term.rows);
      term.focus();
    });
  });
}

function runRealTerminal(): void {
  console.log("Running real terminal...");
  fitAddon.fit();
  attachAddon = new AttachAddon(socket);
  term.loadAddon(attachAddon);
  term._initialized = true;
}

function runFakeTerminal(): void {
  console.log("Running fake terminal...");
  if (term._initialized) {
    return;
  }

  term._initialized = true;
  term.prompt = () => {
    term.write("\r\n$ ");
  };

  term.writeln("Welcome to xterm.js");
  term.writeln(
    "This is a local terminal emulation, without a real terminal in the back-end."
  );
  term.writeln("Type some keys and commands to play around.");
  term.writeln("");
  term.prompt();

  term.onKey((e: { key: string; domEvent: KeyboardEvent }) => {
    const ev = e.domEvent;
    const printable = !ev.altKey && !ev.ctrlKey && !ev.metaKey;

    if (ev.keyCode === 13) {
      term.prompt();
    } else if (ev.keyCode === 8) {
      // Do not delete the prompt
      if (term._core.buffer.x > 2) {
        term.write("\b \b");
      }
    } else if (printable) {
      term.write(e.key);
    }
  });
}

function updateTerminalSize(): void {}

createTerminal();

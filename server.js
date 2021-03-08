const express = require("express");
const expressWs = require("express-ws");
const pty = require("node-pty");
const os = require("os");
const { exec } = require("child_process");

// Whether to use binary transport.
const USE_BINARY = os.platform() !== "win32";

// Configurations
const dockerRun = process.env.DOCKER_RUN || "false";
const host = process.env.HOST || "0.0.0.0";
const port = process.env.PORT || 3000;
const maxTerminals = process.env.MAX_TERMINALS || 50;
const maxIdleTime = 600000;
console.log("dockerRun = " + dockerRun);
console.log("host = " + host);
console.log("port = " + port);

var terminals = {},
  names = {},
  lastUpdates = {},
  logs = {};

function startServer() {
  var app = express();
  expressWs(app);

  // ROUTES
  // static files
  app.use("/xterm.css", express.static(__dirname + "/client/xterm.css"));
  app.use("/favicon.ico", express.static(__dirname + "/client/favicon.ico"));
  app.get("/", (req, res) => {
    res.sendFile(__dirname + "/client/index.html");
  });
  app.use(
    "/client-bundle.js",
    express.static(__dirname + "/dist/client-bundle.js")
  );

  // terminal APIs
  app.post("/terminals", (req, res) => {
    console.log("API: /terminals");

    // Clear idle terminals
    console.log(
      "Current resources: " +
        Object.keys(terminals).length +
        " out of " +
        maxTerminals
    );
    let currentTime = Date.now();
    if (Object.keys(terminals).length >= maxTerminals) {
      for (let key in terminals) {
        if (terminals.hasOwnProperty(key)) {
          if (currentTime - lastUpdates[key] >= maxIdleTime) {
            console.log("Clearing idle terminal " + key);
            removeTerminal(terminals[key]);
          }
        }
      }
    }

    // No terminal was cleared
    if (Object.keys(terminals).length >= maxTerminals) {
      console.log("terminals.size has reached MAX_TERMINALS...T T");
      res.send("-1");
      res.end();
    } else {
      const env = Object.assign({}, process.env);
      var cols = parseInt(req.query.cols),
        rows = parseInt(req.query.rows),
        name = Math.random().toString(36).substring(7);
      var term;
      if (dockerRun === "true") {
        var opts = [
          "run",
          "-it",
          "--rm",
          "--name",
          name,
          "-u",
          "sbtuser",
          "-w",
          "/home/sbtuser",
          "--network",
          "none",
          "-m",
          "256m",
          "--cpus=.5",
          "hseeberger/scala-sbt:8u222_1.3.5_2.13.1",
          "scala",
        ];
        term = pty.spawn("docker", opts, {
          name: "xterm-256color",
          cols: cols || 80,
          rows: rows || 24,
          cwd: process.platform === "win32" ? undefined : env.PWD,
          env: env,
          encoding: USE_BINARY ? null : "utf8",
        });
      } else {
        term = pty.spawn("scala", [], {
          name: "xterm-256color",
          cols: cols || 80,
          rows: rows || 24,
          cwd: process.platform === "win32" ? undefined : env.PWD,
          env: env,
          encoding: USE_BINARY ? null : "utf8",
        });
      }
      console.log(
        "Created terminal with PID: " + term.pid + " with name " + name
      );
      var pid = term.pid;
      terminals[pid] = term;
      names[pid] = name;
      logs[pid] = "";
      lastUpdates[pid] = Date.now();
      term.on("data", function (data) {
        logs[pid] += data;
      });
      res.send(pid.toString());
      res.end();
    }
  });

  app.post("/terminals/:pid/size", (req, res) => {
    var pid = parseInt(req.params.pid);
    if (pid != "-1") {
      var cols = parseInt(req.query.cols),
        rows = parseInt(req.query.rows),
        term = terminals[pid];
      lastUpdates[term.pid] = Date.now();
      console.log("Resize to " + cols + ", " + rows);
      term.resize(cols, rows);
      console.log(
        "Resized terminal " +
          pid +
          " to " +
          cols +
          " cols and " +
          rows +
          " rows."
      );
    }
    res.end();
  });

  app.ws("/terminals/:pid", function (ws, req) {
    var pid = parseInt(req.params.pid);
    if (pid != "-1") {
      var term = terminals[parseInt(req.params.pid)];
      var name = names[parseInt(req.params.pid)];
      lastUpdates[term.pid] = Date.now();
      console.log("Connected to terminal " + term.pid + " with name " + name);
      ws.send(logs[term.pid]);
      const send = USE_BINARY ? bufferUtf8(ws, 5) : buffer(ws, 5);
      term.on("data", function (data) {
        try {
          send(data);
        } catch (ex) {
          // The WebSocket is not open, ignore
          console.log("The WebSocket is not open, ignore");
        }
      });

      ws.on("message", function (msg) {
        term.write(msg);
      });

      ws.on("close", function () {
        removeTerminal(term);
      });
    }
  });

  // start server
  console.log("Server is running on http://" + host + ":" + port);
  app.listen(port, host);
}

// string message buffering
function buffer(socket, timeout) {
  let s = "";
  let sender = null;
  return (data) => {
    s += data;
    if (!sender) {
      sender = setTimeout(() => {
        socket.send(s);
        s = "";
        sender = null;
      }, timeout);
    }
  };
}

// binary message buffering
function bufferUtf8(socket, timeout) {
  let buffer = [];
  let sender = null;
  let length = 0;
  return (data) => {
    buffer.push(data);
    length += data.length;
    if (!sender) {
      sender = setTimeout(() => {
        socket.send(Buffer.concat(buffer, length));
        buffer = [];
        sender = null;
        length = 0;
      }, timeout);
    }
  };
}

function removeTerminal(term) {
  var pid = term.pid;
  if (pid != "-1") {
    var name = names[pid];
    term.kill("SIGKILL");
    console.log("Closed terminal " + pid + " with name " + name);
    if (dockerRun === "true") {
      exec("docker kill " + name, (err, stdout, stderr) => {
        if (err) {
          console.log("Failed to kill docker container " + name);
          console.log(stderr);
        }
      });
    }

    // Clean things up
    delete terminals[pid];
    delete logs[pid];
    delete names[pid];
    delete lastUpdates[pid];
  }
}

startServer();

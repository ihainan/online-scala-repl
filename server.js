const express = require("express");
const expressWs = require("express-ws");
const pty = require("node-pty");
const os = require("os");
const exec = require("child_process");

// Whether to use binary transport.
const USE_BINARY = os.platform() !== "win32";

function startServer() {
  var app = express();
  expressWs(app);

  var terminals = {},
    names = {},
    logs = {};

  // ROUTES
  // static files
  app.use("/xterm.css", express.static(__dirname + "/client/xterm.css"));
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

    const env = Object.assign({}, process.env);
    var cols = parseInt(req.query.cols),
      rows = parseInt(req.query.rows),
      name = Math.random().toString(36).substring(7),
      opts = [
        "run",
        "-it",
        "--rm",
        "--name",
        name,
        "-u",
        "sbtuser",
        "-w",
        "/home/sbtuser",
        "hseeberger/scala-sbt:8u222_1.3.5_2.13.1",
        "scala",
      ],
      term = pty.spawn("docker", opts, {
        name: "xterm-256color",
        cols: cols || 80,
        rows: rows || 24,
        cwd: process.platform === "win32" ? undefined : env.PWD,
        env: env,
        encoding: USE_BINARY ? null : "utf8",
      });
    console.log(
      "Created terminal with PID: " + term.pid + " with name " + name
    );
    terminals[term.pid] = term;
    names[term.pid] = name;
    logs[term.pid] = "";
    term.on("data", function (data) {
      logs[term.pid] += data;
    });
    res.send(term.pid.toString());
    res.end();
  });

  app.post("/terminals/:pid/size", (req, res) => {
    var pid = parseInt(req.params.pid),
      cols = parseInt(req.query.cols),
      rows = parseInt(req.query.rows),
      term = terminals[pid];
    console.log("Resize to " + cols + ", " + rows);
    term.resize(cols, rows);
    console.log(
      "Resized terminal " + pid + " to " + cols + " cols and " + rows + " rows."
    );
    res.end();
  });

  app.ws("/terminals/:pid", function (ws, req) {
    var term = terminals[parseInt(req.params.pid)];
    var name = names[parseInt(req.params.pid)];
    console.log("Connected to terminal " + term.pid + " with name " + name);
    ws.send(logs[term.pid]);

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
    const send = USE_BINARY ? bufferUtf8(ws, 5) : buffer(ws, 5);

    term.on("data", function (data) {
      try {
        send(data);
      } catch (ex) {
        // The WebSocket is not open, ignore
        console.log("// The WebSocket is not open, ignore");
      }
    });

    ws.on("message", function (msg) {
      term.write(msg);
    });

    ws.on("close", function () {
      term.kill("SIGKILL");
      console.log("Closed terminal " + term.pid + " with name " + name);
      exec("docker kill " + name, (err, stdout, stderr) => {
        if (err) {
          console.log("Failed to kill docker container " + name);
        }
      });

      // Clean things up
      delete terminals[term.pid];
      delete logs[term.pid];
      delete names[term.pid];
    });
  });

  // start server
  const port = process.env.PORT || 3000;
  const host = process.env.HOST || "0.0.0.0";
  console.log("Server is running on http://" + host + ":" + port);
  app.listen(port, host);
}

startServer();

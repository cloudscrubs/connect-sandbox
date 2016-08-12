var telehash = require("../index.js").telehash;
var running = false;
telehash.init(function initialised(err) {
	if (err) {
		console.log(err);
		return;
	}
	console.log("initialised");
	telehash.seed(function (status, info) {
		if (status === 'offline' && info === 'snat-detected') {
			console.log("SNAT detected. Exiting...");
			process.exit();
		}
		if (status !== "online") {
			console.log(status);
			return;
		}
		console.log("seeded");
		if (!running) server("echo.message.back");
	});
});

function server(name) {
	running = true;
	console.log("server running");
	telehash.listen(name, function (conn) {
		console.log("<<-- MESSAGE:", conn.message, " from:", conn.from, " via:", conn.source);
		conn.reply("I Agree, '" + conn.message + "'");
	});
}

var sys = require("sys");
var telehash = require("../index.js").telehash;
var hlib = require("../index.js").hash;

var running = false;

var stdin = process.openStdin();
stdin.setEncoding("UTF-8");

telehash.init({
	mode: 2
}, function (err) {
	if (err) {
		return;
	}
	telehash.seed(function (status, info) {
		if (status === 'offline' && info === 'snat-detected') {
			console.log("SNAT detected. Exiting...");
			process.exit();
		}
		if (status !== "online") {
			console.log(status);
			return;
		}
		if (!running) wall("42");
	});
});

function wall(THEWALL) {
	running = true;
	var endHash = new hlib.Hash(THEWALL);
	var tap = {};
	tap.is = {};
	tap.is["+end"] = endHash.toString();
	tap.has = ["+wall"];

	console.log("Write Something on the Wall: ", THEWALL);

	telehash.tap(THEWALL, tap, function (from, telex) {
		//TODO:Keep a short history of incoming telexes and drop duplicates
		console.log(new Date() + " <" + from.ipp + "> " + telex["+wall"]);
	});


	stdin.on('data', function (chunk) {
		telehash.dial(THEWALL);

		console.log("local: " + chunk);
		telehash.announce(THEWALL, {
			'+wall': chunk,
			'+guid': new Date().getTime()
		});
	});
}

process.on('SIGINT', function () {
	console.log("Use Control-D to exit.");
});

stdin.on('end', function () {
	telehash.shutdown();
});

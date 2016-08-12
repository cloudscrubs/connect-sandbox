var telehash = require("../index.js").telehash;
var slib = require("../index.js").switch;

var NETWORK_INTERFACE = ""; //eth0, zt0, or ip-address

var bcast = process.argv[2] == 'broadcast';

init(oninit);

function oninit() {
	if (bcast) {
		console.log("broadcasting...");
		telehash.broadcast();
	} else telehash.seed(seeding);

}

function init(callback) {
	console.log("initialising");
	telehash.init({
		mode: telehash.MODE.FULL,
		interface: NETWORK_INTERFACE
	}, function (err) {
		if (err) {
			console.error(err);
			process.exit();
		}
		callback();
	});
}

function seeding(status, info) {
	console.log("Status update:", status, info ? info : "");

	if (status === 'offline' && info === 'snat-detected') {
		console.log("Network firewall/NAT router is restricted. Exiting..");
		process.exit();
	}
	if (status === "shutdown") {
		process.exit();
	}
	if (status !== "online") {
		return;
	}

	console.log("public address:", telehash.address());
	console.log("behind NAT?:", telehash.nat());
	console.log("running in mode:", telehash.mode());
}

setInterval(function () {
	slib.getSwitches().forEach(function (s) {
		s.send({
			'+end': s.hash.far()
		});
	});
}, 30000);

setInterval(function () {
	if (telehash.state() !== telehash.STATE.ONLINE) return; //not online
	telehash.ping("178.79.135.146:42425");
	telehash.ping("178.79.135.146:42424");
}, 20000);

setInterval(function () {
	var peers = telehash.peers();
	console.log("Peers:", peers.length);

}, 20000);

var stdin = process.openStdin();
if (process.platform != 'win32') {
	process.on('SIGINT', function () {
		console.log("Use Control-D to exit.");
	});
}
stdin.on('end', function () {
	telehash.shutdown();
});

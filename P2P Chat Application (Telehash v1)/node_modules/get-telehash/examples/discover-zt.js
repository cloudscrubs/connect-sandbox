/* Experimental telehash on ZeroTier 'earth' network */
var telehash = require("../index.js").telehash;
var NETWORK_INTERFACE = "zt0"; //tun interface created by zerotier
var bcast = process.argv[2] == 'broadcast';

init(function () {
	if (bcast) {
		console.log("broadcasting...");
		telehash.broadcast();
	} else telehash.seed(seeding);

});

function init(callback) {
	console.log("initialising");
	telehash.init({
		log: console.error,
		mode: 3, // full operating mode
		interface: NETWORK_INTERFACE,
		seeds: ["28.192.75.206:42424"]
	}, function (err) {
		if (err) {
			console.error(err);
			setTimeout(function () {
				init(callback);
			}, 5000);
			return;
		}
		callback();
	});
}

function seeding(status) {
	if (status !== "online") {
		console.log(status);
		return;
	}
	console.log("== ONLINE ==");
}

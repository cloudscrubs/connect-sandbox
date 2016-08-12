var telehash = require("../index.js").telehash;
var util = require('../lib/iputil');

var localip = util.getLocalIP();

if (localip.length) {
	telehash.init({
		log: console.log,
		mode: telehash.MODE.FULL,
		port: '42424',
		respondToBroadcasts: false, //self seeding hosts should dlisten on a single ip (not 0.0.0.0)
		seeds: [localip[0] + ":42424"], // self seed
	}, function (err) {
		if (!err) {
			telehash.seed(function (status, info) {
				if (status === 'offline' && info === 'snat-detected') {
					console.log("SNAT detected. Exiting...");
					process.exit();
				}
				console.log(status);
			});
		}
	});
}

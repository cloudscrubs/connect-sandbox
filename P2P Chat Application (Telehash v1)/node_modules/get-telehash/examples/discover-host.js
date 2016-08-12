var telehash = require("../index.js").telehash;
var util = require('../lib/iputil');
var NETWORK_INTERFACE = ""; //for example eth0, zt0, or ip-address

telehash.init({
	log: console.error,
	mode: telehash.MODE.FULL,
	interface: NETWORK_INTERFACE,
	respondToBroadcasts: true,
	port: 42424
}, function (err) {

	console.log("listening for broadcasts");
	telehash.broadcast();

});
